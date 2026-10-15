/**
 * Suite file loading: YAML parsing, strict schema validation that collects
 * every problem at once, and cross-field checks.
 */

import { readFile } from 'node:fs/promises';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import { AssayError, SuiteError, TemplateError } from './errors.js';
import { variablesOf } from './template.js';
import type {
  AssertionSpec,
  PromptSpec,
  ProviderSpec,
  Suite,
  SuiteDefaults,
  TestSpec,
} from './types.js';

/** Provider ids look like `kind:model`, e.g. `anthropic:claude-opus-5`. */
const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]*:[^\s]+$/;

/** Prompt ids are safe identifiers, so they can appear in case ids and paths. */
const PROMPT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

const scalarSchema = z.union(
  [z.string(), z.number(), z.boolean()],
  'must be a string, number or boolean',
);

/** Assertions keep arbitrary extra keys; only `type` is checked in phase A1. */
const assertionSchema = z.looseObject({
  type: z.string('"type" must be a non-empty string').min(1, '"type" must be a non-empty string'),
});

const providerSchema = z.strictObject({
  id: z
    .string('"id" must be a non-empty string')
    .min(1, '"id" must be a non-empty string')
    .regex(PROVIDER_ID_PATTERN, 'must look like "kind:model", e.g. "mock:echo"'),
  config: z.record(z.string(), z.unknown()).optional(),
});

const promptSchema = z.strictObject({
  id: z
    .string('"id" must be a non-empty string')
    .min(1, '"id" must be a non-empty string')
    .regex(PROMPT_ID_PATTERN, 'must contain only letters, digits, "_" and "-"'),
  template: z.string('"template" must be a string'),
  system: z.string('"system" must be a string').optional(),
});

const testSchema = z.strictObject({
  name: z
    .string('"name" must be a non-empty string')
    .min(1, 'must be a non-empty string')
    .optional(),
  prompt: z
    .string('"prompt" must be a non-empty string')
    .min(1, 'must be a non-empty string')
    .optional(),
  vars: z
    .record(z.string(), scalarSchema, 'must be a mapping of variable names to scalars')
    .default({}),
  assert: z
    .array(assertionSchema, 'must be an array of assertions')
    .min(1, 'must contain at least one assertion'),
});

const defaultsSchema = z.strictObject({
  temperature: z
    .number('must be a number')
    .min(0, 'must be between 0 and 2')
    .max(2, 'must be between 0 and 2')
    .optional(),
  maxTokens: z
    .number('must be a number')
    .int('must be an integer')
    .positive('must be a positive integer')
    .optional(),
  timeoutMs: z
    .number('must be a number')
    .int('must be an integer')
    .positive('must be a positive integer')
    .optional(),
  retries: z
    .number('must be a number')
    .int('must be an integer')
    .min(0, 'must be between 0 and 10')
    .max(10, 'must be between 0 and 10')
    .optional(),
});

/** The strict zod schema for a whole suite file. */
const suiteSchema = z.strictObject({
  version: z.literal(1, 'must be 1'),
  name: z.string('"name" must be a non-empty string').min(1, 'must be a non-empty string'),
  description: z.string('"description" must be a string').optional(),
  providers: z
    .array(providerSchema, 'must be an array of providers')
    .min(1, 'must list at least one provider'),
  prompts: z
    .array(promptSchema, 'must be an array of prompts')
    .min(1, 'must list at least one prompt'),
  tests: z.array(testSchema, 'must be an array of tests').min(1, 'must list at least one test'),
  defaults: defaultsSchema.optional(),
});

/** Render a zod issue path as `tests[2].vars`, or `(root)` when empty. */
function formatPath(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) return '(root)';
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') out += `[${segment}]`;
    else if (out === '') out += String(segment);
    else out += `.${String(segment)}`;
  }
  return out;
}

/** Build the issue lines for a failed zod parse, path first then message. */
function issueLines(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${formatPath(issue.path)}: ${issue.message}`);
}

/** Report duplicate values in a list as issue lines. */
function duplicateIssues(
  values: readonly string[],
  describe: (value: string, index: number) => string,
): string[] {
  const seen = new Map<string, number>();
  const issues: string[] = [];
  values.forEach((value, index) => {
    const first = seen.get(value);
    if (first === undefined) seen.set(value, index);
    else issues.push(describe(value, index));
  });
  return issues;
}

/** Copy only the defined optional keys, so exactOptionalPropertyTypes holds. */
function buildDefaults(input: z.output<typeof defaultsSchema>): SuiteDefaults {
  const out: SuiteDefaults = {};
  if (input.temperature !== undefined) out.temperature = input.temperature;
  if (input.maxTokens !== undefined) out.maxTokens = input.maxTokens;
  if (input.timeoutMs !== undefined) out.timeoutMs = input.timeoutMs;
  if (input.retries !== undefined) out.retries = input.retries;
  return out;
}

/** Turn a validated provider entry into a ProviderSpec. */
function buildProvider(input: z.output<typeof providerSchema>): ProviderSpec {
  const out: ProviderSpec = { id: input.id };
  if (input.config !== undefined) out.config = { ...input.config };
  return out;
}

/** Turn a validated prompt entry into a PromptSpec. */
function buildPrompt(input: z.output<typeof promptSchema>): PromptSpec {
  const out: PromptSpec = { id: input.id, template: input.template };
  if (input.system !== undefined) out.system = input.system;
  return out;
}

/** Turn a validated test entry into a TestSpec, defaulting the name. */
function buildTest(input: z.output<typeof testSchema>, index: number): TestSpec {
  const out: TestSpec = {
    name: input.name ?? `test-${index + 1}`,
    vars: { ...input.vars },
    assert: input.assert.map((assertion) => ({ ...assertion }) as AssertionSpec),
  };
  if (input.prompt !== undefined) out.prompt = input.prompt;
  return out;
}

/** Assemble a Suite from the validated schema output. */
function buildSuite(input: z.output<typeof suiteSchema>): Suite {
  const out: Suite = {
    version: 1,
    name: input.name,
    providers: input.providers.map(buildProvider),
    prompts: input.prompts.map(buildPrompt),
    tests: input.tests.map(buildTest),
  };
  if (input.description !== undefined) out.description = input.description;
  if (input.defaults !== undefined) out.defaults = buildDefaults(input.defaults);
  return out;
}

/** The prompts a test applies to: its pinned prompt, or all of them. */
function applicablePrompts(suite: Suite, test: TestSpec): PromptSpec[] {
  if (test.prompt === undefined) return [...suite.prompts];
  return suite.prompts.filter((prompt) => prompt.id === test.prompt);
}

/** Checks that need the whole suite: uniqueness, references and variables. */
function crossFieldIssues(suite: Suite): string[] {
  const issues: string[] = [];

  issues.push(
    ...duplicateIssues(
      suite.providers.map((provider) => provider.id),
      (id, index) => `providers[${index}]: duplicate provider id "${id}"`,
    ),
  );
  issues.push(
    ...duplicateIssues(
      suite.prompts.map((prompt) => prompt.id),
      (id, index) => `prompts[${index}]: duplicate prompt id "${id}"`,
    ),
  );
  issues.push(
    ...duplicateIssues(
      suite.tests.map((test) => test.name),
      (name, index) => `tests[${index}]: duplicate test name "${name}"`,
    ),
  );

  const promptIds = new Set(suite.prompts.map((prompt) => prompt.id));
  const promptVariables = new Map<string, string[]>();
  suite.prompts.forEach((prompt, index) => {
    try {
      promptVariables.set(prompt.id, variablesOf(prompt.template));
    } catch (error) {
      if (!(error instanceof TemplateError)) throw error;
      issues.push(`prompts[${index}] "${prompt.id}": ${error.message}`);
    }
  });

  suite.tests.forEach((test, index) => {
    if (test.prompt !== undefined && !promptIds.has(test.prompt)) {
      issues.push(`tests[${index}] "${test.name}": no prompt with id "${test.prompt}"`);
      return;
    }
    for (const prompt of applicablePrompts(suite, test)) {
      for (const variable of promptVariables.get(prompt.id) ?? []) {
        if (!Object.hasOwn(test.vars, variable)) {
          issues.push(
            `tests[${index}] "${test.name}" prompt "${prompt.id}": missing variable "${variable}"`,
          );
        }
      }
    }
  });

  return issues;
}

/** Parse YAML into a plain value, reporting every syntax error found. */
function parseYaml(yamlText: string, sourceName: string): unknown {
  const doc = parseDocument(yamlText, { prettyErrors: true });
  if (doc.errors.length > 0) {
    const issues = doc.errors.map((error) => {
      const pos = error.linePos?.[0];
      const where = pos === undefined ? '' : `line ${pos.line}, column ${pos.col}: `;
      const message = error.message.split(/ at line \d+, column \d+/)[0] ?? error.message;
      return `${where}${message}`;
    });
    throw new SuiteError(`${sourceName}: YAML syntax error`, issues);
  }
  return doc.toJS({ maxAliasCount: 100 });
}

/**
 * Validate YAML suite text. Throws SuiteError whose `issues` list every
 * problem found. The input string is never mutated.
 */
export function parseSuite(yamlText: string, sourceName = '<input>'): Suite {
  const raw = parseYaml(yamlText, sourceName);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SuiteError(`${sourceName}: 1 validation error`, [
      '(root): expected a YAML mapping at the top level',
    ]);
  }

  const parsed = suiteSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = issueLines(parsed.error);
    throw new SuiteError(formatHeader(sourceName, issues.length), issues);
  }

  const suite = buildSuite(parsed.data);
  const issues = crossFieldIssues(suite);
  if (issues.length > 0) {
    throw new SuiteError(formatHeader(sourceName, issues.length), issues);
  }
  return suite;
}

/** The single header line that precedes the issue list. */
function formatHeader(sourceName: string, count: number): string {
  return `${sourceName}: ${count} validation error${count === 1 ? '' : 's'}`;
}

/**
 * Read and validate a suite file. A missing or unreadable file throws an
 * AssayError naming the path.
 */
export async function loadSuite(path: string): Promise<Suite> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new AssayError(`cannot read suite file "${path}": ${reason}`, { cause: error });
  }
  return parseSuite(text, path);
}
