/**
 * The assay command line, implemented as a pure function over argv and an io
 * object so it can be driven directly from tests.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { evaluateAll, summarizeResults } from './assertions/index.js';
import type { AssertionContext } from './assertions/types.js';
import { AssayError, SuiteError } from './core/errors.js';
import { plan } from './core/plan.js';
import { loadSuite } from './core/suite.js';
import type { Suite, TestSpec } from './core/types.js';

/** The streams and working directory the CLI reads and writes. */
export interface CliIo {
  stdout: { write(s: string): void };
  stderr: { write(s: string): void };
  cwd: string;
}

const USAGE = `assay - test harness for LLM prompts and models

Usage:
  assay validate <file>   validate a suite file and summarise it
  assay plan <file>       print the case ids a suite expands to, one per line
  assay check <file>      evaluate one test's assertions against given output

Options for check:
      --test <name>       the test whose assertions to evaluate (required)
      --output <text>     the output to check
      --output-file <p>   read the output from a file instead of --output
      --latency <ms>      latency to report, for max-latency (default 0)
      --cost <usd>        cost to report, for max-cost
      --tokens <n>        output tokens to report, for max-tokens

Options:
  -h, --help              show this help
`;

/** The command-line flags, as parseArgs hands them over. */
type CliValues = {
  help?: boolean | undefined;
  test?: string | undefined;
  output?: string | undefined;
  'output-file'?: string | undefined;
  latency?: string | undefined;
  cost?: string | undefined;
  tokens?: string | undefined;
};

/** Print a SuiteError as a header line plus indented issue lines. */
function reportSuiteError(error: SuiteError, io: CliIo): void {
  io.stderr.write(`${error.message}\n`);
  for (const issue of error.issues) io.stderr.write(`  ${issue}\n`);
}

/** Print a usage error and the usage text. */
function reportUsage(reason: string, io: CliIo): number {
  io.stderr.write(`error: ${reason}\n\n${USAGE}`);
  return 2;
}

/** `assay validate <file>`: load the suite and summarise its size. */
async function validateCommand(file: string, io: CliIo): Promise<number> {
  const suite = await loadSuite(resolve(io.cwd, file));
  const cases = plan(suite);
  io.stdout.write(
    `OK ${suite.name}: ${suite.tests.length} tests, ${suite.prompts.length} prompts, ` +
      `${suite.providers.length} providers, ${cases.length} cases\n`,
  );
  return 0;
}

/** `assay plan <file>`: print one case id per line. */
async function planCommand(file: string, io: CliIo): Promise<number> {
  const suite = await loadSuite(resolve(io.cwd, file));
  for (const planned of plan(suite)) io.stdout.write(`${planned.caseId}\n`);
  return 0;
}

/** Parse a numeric flag, or say why it cannot be used. */
function readNumberFlag(
  name: string,
  raw: string | undefined,
  integer: boolean,
): { ok: true; value: number | undefined } | { ok: false; reason: string } {
  if (raw === undefined) return { ok: true, value: undefined };
  const value = raw.trim() === '' ? Number.NaN : Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    return { ok: false, reason: `--${name} must be a non-negative number, got "${raw}"` };
  }
  if (integer && !Number.isInteger(value)) {
    return { ok: false, reason: `--${name} must be an integer, got "${raw}"` };
  }
  return { ok: true, value };
}

/** The measurements `check` reports to the assertions. */
interface CheckMeasurements {
  latencyMs: number;
  costUsd?: number;
  outputTokens?: number;
}

/** Validate the numeric flags together, stopping at the first unusable one. */
function readMeasurements(
  values: CliValues,
): { ok: true; measurements: CheckMeasurements } | { ok: false; reason: string } {
  const latency = readNumberFlag('latency', values.latency, false);
  if (!latency.ok) return latency;
  const cost = readNumberFlag('cost', values.cost, false);
  if (!cost.ok) return cost;
  const tokens = readNumberFlag('tokens', values.tokens, true);
  if (!tokens.ok) return tokens;

  const measurements: CheckMeasurements = { latencyMs: latency.value ?? 0 };
  if (cost.value !== undefined) measurements.costUsd = cost.value;
  if (tokens.value !== undefined) measurements.outputTokens = tokens.value;
  return { ok: true, measurements };
}

/** Read the output to check from a file, naming the path when it fails. */
async function readOutputFile(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new AssayError(`cannot read output file "${path}": ${reason}`, { cause: error });
  }
}

/** Build the context the assertions see from the measurements and the test. */
function buildContext(
  output: string,
  measurements: CheckMeasurements,
  vars: AssertionContext['vars'],
): AssertionContext {
  const ctx: AssertionContext = { output, latencyMs: measurements.latencyMs, vars };
  if (measurements.costUsd !== undefined) ctx.costUsd = measurements.costUsd;
  if (measurements.outputTokens !== undefined) {
    ctx.usage = { inputTokens: 0, outputTokens: measurements.outputTokens };
  }
  return ctx;
}

/** Evaluate a test's assertions and print a line for each. */
function reportAssertions(test: TestSpec, ctx: AssertionContext, io: CliIo): number {
  const results = evaluateAll(test.assert, ctx);
  for (const result of results) {
    const label = result.description === undefined ? '' : `(${result.description}) `;
    io.stdout.write(`${result.passed ? 'PASS' : 'FAIL'} ${label}${result.message}\n`);
  }

  const summary = summarizeResults(results);
  io.stdout.write(`${summary.total - summary.failed}/${summary.total} assertions passed\n`);
  return summary.passed ? 0 : 1;
}

/** Find a test by name, listing the names that exist when it is missing. */
function findTest(suite: Suite, testName: string): TestSpec {
  const test = suite.tests.find((candidate) => candidate.name === testName);
  if (test === undefined) {
    const names = suite.tests.map((candidate) => candidate.name).join(', ');
    throw new AssayError(
      `no test named "${testName}" in suite "${suite.name}"; tests are: ${names}`,
    );
  }
  return test;
}

/**
 * `assay check <file> --test <name> --output <text>`: try a test's assertions
 * against output you supply, without calling a model.
 */
async function checkCommand(file: string, values: CliValues, io: CliIo): Promise<number> {
  const testName = values.test;
  if (testName === undefined) return reportUsage('"check" needs --test <name>', io);

  const inline = values.output;
  const fromFile = values['output-file'];
  if ((inline === undefined) === (fromFile === undefined)) {
    return reportUsage('"check" needs exactly one of --output or --output-file', io);
  }

  const measurements = readMeasurements(values);
  if (!measurements.ok) return reportUsage(measurements.reason, io);

  const output =
    inline !== undefined ? inline : await readOutputFile(resolve(io.cwd, fromFile as string));
  const test = findTest(await loadSuite(resolve(io.cwd, file)), testName);
  return reportAssertions(test, buildContext(output, measurements.measurements, test.vars), io);
}

/** The commands `run` dispatches to, each taking a suite file. */
const COMMANDS = ['validate', 'plan', 'check'] as const;

/** Whether a word is one of the known commands. */
function isCommand(word: string): word is (typeof COMMANDS)[number] {
  return (COMMANDS as readonly string[]).includes(word);
}

/**
 * Run the CLI. Never throws: returns 0 on success, 1 on a suite or runtime
 * error and 2 on a usage error.
 */
export async function run(argv: string[], io: CliIo): Promise<number> {
  let positionals: string[];
  let values: CliValues;
  try {
    const parsed = parseArgs({
      args: argv,
      options: {
        help: { type: 'boolean', short: 'h' },
        test: { type: 'string' },
        output: { type: 'string' },
        'output-file': { type: 'string' },
        latency: { type: 'string' },
        cost: { type: 'string' },
        tokens: { type: 'string' },
      },
      allowPositionals: true,
      strict: true,
    });
    positionals = parsed.positionals;
    values = parsed.values;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return reportUsage(reason, io);
  }

  if (values.help === true) {
    io.stdout.write(USAGE);
    return 0;
  }

  const command = positionals[0];
  if (command === undefined) {
    io.stderr.write(USAGE);
    return 2;
  }
  if (!isCommand(command)) return reportUsage(`unknown command "${command}"`, io);

  const file = positionals[1];
  if (file === undefined) return reportUsage(`"${command}" needs a suite file argument`, io);

  try {
    if (command === 'validate') return await validateCommand(file, io);
    if (command === 'plan') return await planCommand(file, io);
    return await checkCommand(file, values, io);
  } catch (error) {
    if (error instanceof SuiteError) {
      reportSuiteError(error, io);
      return 1;
    }
    if (error instanceof AssayError) {
      io.stderr.write(`error: ${error.message}\n`);
      return 1;
    }
    const reason = error instanceof Error ? error.message : String(error);
    io.stderr.write(`internal error: ${reason}\n`);
    return 1;
  }
}
