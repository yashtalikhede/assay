import { describe, expect, it } from 'vitest';
import { assertionTemplates, evaluateAssertion } from '../../src/assertions/index.js';
import type { AssertionSpec } from '../../src/core/types.js';
import { issueOf, makeContext } from './context.js';

/** Evaluate a spec against an output with no variables. */
function evaluate(spec: AssertionSpec, output: string) {
  return evaluateAssertion(spec, makeContext(output));
}

const FENCED = '```json\n{"city":"Paris"}\n```';
const PLAIN_FENCE = '```\n{"city":"Paris"}\n```';
const TWO_FENCES = '```json\n{"city":"Paris"}\n```\nand also\n```json\n[1,2]\n```';

describe('json-valid', () => {
  const passing: [string, string][] = [
    ['an object', '{"a":1}'],
    ['an array', '[1,2]'],
    ['a number', '42'],
    ['a string', '"text"'],
    ['a boolean', 'true'],
    ['null', 'null'],
  ];

  it.each(passing)('accepts %s', (_label, output) => {
    expect(evaluate({ type: 'json-valid' }, output)).toEqual({
      type: 'json-valid',
      passed: true,
      message: 'valid JSON',
    });
  });

  const failing: [string, string][] = [
    ['prose', 'not json at all'],
    ['a trailing comma in an object', '{"a":1,}'],
    ['a trailing comma in an array', '[1,2,]'],
    ['single quotes', "{'a':1}"],
    ['an empty output', ''],
  ];

  it.each(failing)('rejects %s', (_label, output) => {
    const result = evaluate({ type: 'json-valid' }, output);
    expect(result.passed).toBe(false);
    expect(result.message).toMatch(/^expected output to be valid JSON, parse failed: /);
  });

  it('rejects fenced JSON in strict mode', () => {
    expect(evaluate({ type: 'json-valid' }, FENCED).passed).toBe(false);
  });

  it('accepts a ```json fenced block when lenient', () => {
    expect(evaluate({ type: 'json-valid', lenient: true }, FENCED)).toEqual({
      type: 'json-valid',
      passed: true,
      message: 'valid JSON',
    });
  });

  it('accepts a plain ``` fenced block when lenient', () => {
    expect(evaluate({ type: 'json-valid', lenient: true }, PLAIN_FENCE).passed).toBe(true);
  });

  it('accepts surrounding prose and whitespace when lenient', () => {
    const output = `Here you go:\n\n${FENCED}\n\nHope that helps.`;
    expect(evaluate({ type: 'json-valid', lenient: true }, output).passed).toBe(true);
  });

  it('uses the first of two fenced blocks when lenient', () => {
    // The first block is an object; if the second were used this would still
    // parse, so the assertion below pins which one was taken via json-schema.
    const spec: AssertionSpec = {
      type: 'json-schema',
      lenient: true,
      schema: { type: 'object', required: ['city'] },
    };
    expect(evaluate(spec, TWO_FENCES).passed).toBe(true);
  });

  it('still fails for non-JSON inside a fence when lenient', () => {
    const result = evaluate({ type: 'json-valid', lenient: true }, '```\nnot json\n```');
    expect(result.passed).toBe(false);
    expect(result.message).toMatch(/parse failed: /);
  });

  it('accepts untrimmed JSON when lenient', () => {
    expect(evaluate({ type: 'json-valid', lenient: true }, '  \n{"a":1}\n  ').passed).toBe(true);
  });

  it('inverts with not', () => {
    expect(evaluate({ type: 'json-valid', not: true }, 'not json')).toEqual({
      type: 'json-valid',
      passed: true,
      message: 'NOT valid JSON',
    });
    expect(evaluate({ type: 'json-valid', not: true }, '{"a":1}')).toEqual({
      type: 'json-valid',
      passed: false,
      message: 'expected output NOT to be valid JSON',
    });
  });
});

describe('json-schema', () => {
  const personSchema = {
    type: 'object',
    required: ['name'],
    properties: { name: { type: 'string' }, age: { type: 'number' } },
  };

  it('accepts a document that satisfies the schema', () => {
    expect(
      evaluate({ type: 'json-schema', schema: personSchema }, '{"name":"Ada","age":36}'),
    ).toEqual({ type: 'json-schema', passed: true, message: 'matches the JSON schema' });
  });

  it('reports a type mismatch with its instance path', () => {
    expect(
      evaluate({ type: 'json-schema', schema: personSchema }, '{"name":"Ada","age":"old"}'),
    ).toEqual({
      type: 'json-schema',
      passed: false,
      message: 'expected output to match the JSON schema, errors: /age: must be number',
    });
  });

  it('reports a missing required property at the root path', () => {
    expect(evaluate({ type: 'json-schema', schema: personSchema }, '{"age":36}')).toEqual({
      type: 'json-schema',
      passed: false,
      message:
        "expected output to match the JSON schema, errors: /: must have required property 'name'",
    });
  });

  it('truncates to five errors', () => {
    const schema = {
      type: 'object',
      required: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
    };
    const result = evaluate({ type: 'json-schema', schema }, '{}');
    expect(result.passed).toBe(false);
    expect(result.message.match(/must have required property/g)).toHaveLength(5);
    expect(result.message.split('; ')).toHaveLength(5);
  });

  it('fails with a parse error when the output is not JSON', () => {
    const result = evaluate({ type: 'json-schema', schema: personSchema }, 'Sorry, I cannot.');
    expect(result.passed).toBe(false);
    expect(result.message).toMatch(
      /^expected output to be valid JSON matching the schema, parse failed: /,
    );
  });

  it('unwraps a fenced block when lenient', () => {
    const spec: AssertionSpec = { type: 'json-schema', lenient: true, schema: personSchema };
    expect(evaluate(spec, '```json\n{"name":"Ada"}\n```').passed).toBe(true);
  });

  it('inverts with not', () => {
    expect(
      evaluate({ type: 'json-schema', schema: personSchema, not: true }, '{"age":36}'),
    ).toEqual({ type: 'json-schema', passed: true, message: 'NOT matches the JSON schema' });
  });

  it('rejects a schema Ajv cannot compile', () => {
    const issue = issueOf({ type: 'json-schema', schema: { type: 'nonsense' } });
    expect(issue).toMatch(/^schema: /);
    expect(issue).toContain('schema is invalid');
  });

  it('rejects a schema that is not a mapping', () => {
    expect(issueOf({ type: 'json-schema', schema: 'object' })).toBe(
      'schema: "schema" must be a mapping',
    );
  });

  it('does not interpolate the schema', () => {
    const spec: AssertionSpec = { type: 'json-schema', schema: { const: '{{ city }}' } };
    expect(assertionTemplates(spec)).toEqual([]);
    expect(evaluate(spec, '"{{ city }}"').passed).toBe(true);
  });
});
