/**
 * The assay command line, implemented as a pure function over argv and an io
 * object so it can be driven directly from tests.
 */

import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { AssayError, SuiteError } from './core/errors.js';
import { plan } from './core/plan.js';
import { loadSuite } from './core/suite.js';

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

Options:
  -h, --help              show this help
`;

/** Print a SuiteError as a header line plus indented issue lines. */
function reportSuiteError(error: SuiteError, io: CliIo): void {
  io.stderr.write(`${error.message}\n`);
  for (const issue of error.issues) io.stderr.write(`  ${issue}\n`);
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

/**
 * Run the CLI. Never throws: returns 0 on success, 1 on a suite or runtime
 * error and 2 on a usage error.
 */
export async function run(argv: string[], io: CliIo): Promise<number> {
  let positionals: string[];
  let help: boolean;
  try {
    const parsed = parseArgs({
      args: argv,
      options: { help: { type: 'boolean', short: 'h' } },
      allowPositionals: true,
      strict: true,
    });
    positionals = parsed.positionals;
    help = parsed.values.help === true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    io.stderr.write(`error: ${reason}\n\n${USAGE}`);
    return 2;
  }

  if (help) {
    io.stdout.write(USAGE);
    return 0;
  }

  const command = positionals[0];
  if (command === undefined) {
    io.stderr.write(USAGE);
    return 2;
  }

  if (command !== 'validate' && command !== 'plan') {
    io.stderr.write(`error: unknown command "${command}"\n\n${USAGE}`);
    return 2;
  }

  const file = positionals[1];
  if (file === undefined) {
    io.stderr.write(`error: "${command}" needs a suite file argument\n\n${USAGE}`);
    return 2;
  }

  try {
    return command === 'validate' ? await validateCommand(file, io) : await planCommand(file, io);
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
