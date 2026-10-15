import { describe, expect, it } from 'vitest';
import {
  assertionTemplates,
  assertionTypes,
  evaluateAll,
  evaluateAssertion,
  normalizeAssertion,
  summarizeResults,
} from '../../src/assertions/index.js';
import type { AssertionSpec } from '../../src/core/types.js';
import { issueOf, makeContext, normalized } from './context.js';

const ALL_TYPES = [
  'contains',
  'contains-all',
  'contains-any',
  'ends-with',
  'equals',
  'json-schema',
  'json-valid',
  'length',
  'max-cost',
  'max-latency',
  'max-tokens',
  'regex',
  'starts-with',
];

describe('assertionTypes', () => {
  it('lists every known type, sorted', () => {
    expect(assertionTypes()).toEqual(ALL_TYPES);
  });

  it('returns a fresh array each call', () => {
    expect(assertionTypes()).not.toBe(assertionTypes());
  });
});

describe('normalizeAssertion', () => {
  it('fills in the defaults for a type', () => {
    expect(normalized({ type: 'contains', value: 'x' })).toEqual({
      type: 'contains',
      value: 'x',
      caseSensitive: true,
      not: false,
    });
  });

  it('keeps an explicit description and not', () => {
    expect(normalized({ type: 'json-valid', description: 'parses', not: true })).toEqual({
      type: 'json-valid',
      description: 'parses',
      lenient: false,
      not: true,
    });
  });

  it('does not mutate the spec it was given', () => {
    const spec: AssertionSpec = { type: 'contains', value: 'x' };
    normalizeAssertion(spec);
    expect(spec).toEqual({ type: 'contains', value: 'x' });
  });

  it('names the known types when the type is unknown', () => {
    expect(issueOf({ type: 'icontains', value: 'x' })).toBe(
      `unknown assertion type "icontains" (known: ${ALL_TYPES.join(', ')})`,
    );
  });

  it('rejects an unknown key, naming it', () => {
    expect(issueOf({ type: 'contains', value: 'x', valu: 'y' })).toBe('Unrecognized key: "valu"');
  });

  it('rejects a non-boolean not', () => {
    expect(issueOf({ type: 'contains', value: 'x', not: 'yes' })).toBe(
      'not: "not" must be a boolean',
    );
  });

  it('joins several problems into one line', () => {
    const issue = issueOf({ type: 'contains', value: 3, caseSensitive: 'yes' });
    expect(issue).toContain('value: "value" must be a string');
    expect(issue).toContain('caseSensitive: "caseSensitive" must be a boolean');
    expect(issue).toContain('; ');
  });
});

describe('assertionTemplates', () => {
  it('returns the template strings of the interpolated fields', () => {
    expect(assertionTemplates({ type: 'contains', value: '{{ a }}' })).toEqual(['{{ a }}']);
    expect(assertionTemplates({ type: 'contains-all', values: ['{{ a }}', 'b'] })).toEqual([
      '{{ a }}',
      'b',
    ]);
  });

  it('returns nothing for a type with no interpolated fields', () => {
    expect(assertionTemplates({ type: 'max-latency', value: 1 })).toEqual([]);
  });

  it('returns nothing for an unknown type', () => {
    expect(assertionTemplates({ type: 'nope', value: '{{ a }}' })).toEqual([]);
  });
});

describe('descriptions', () => {
  it('carries the description into the result', () => {
    const result = evaluateAssertion(
      { type: 'contains', value: 'x', description: 'mentions x' },
      makeContext('x'),
    );
    expect(result).toEqual({
      type: 'contains',
      description: 'mentions x',
      passed: true,
      message: 'contains "x"',
    });
  });

  it('omits the description when there is none', () => {
    expect(
      evaluateAssertion({ type: 'contains', value: 'x' }, makeContext('x')),
    ).not.toHaveProperty('description');
  });

  it('carries the description onto a failure too', () => {
    const result = evaluateAssertion(
      { type: 'contains', value: 'z', description: 'mentions z' },
      makeContext('x'),
    );
    expect(result.description).toBe('mentions z');
    expect(result.passed).toBe(false);
  });
});

describe('quoted output in messages', () => {
  it('truncates to 120 characters with an ellipsis', () => {
    const output = 'a'.repeat(200);
    const message = evaluateAssertion(
      { type: 'contains', value: 'z' },
      makeContext(output),
    ).message;
    expect(message).toBe(`expected output to contain "z", found "${'a'.repeat(120)}…"`);
  });

  it('does not add an ellipsis at exactly 120 characters', () => {
    const output = 'a'.repeat(120);
    const message = evaluateAssertion(
      { type: 'contains', value: 'z' },
      makeContext(output),
    ).message;
    expect(message).toBe(`expected output to contain "z", found "${output}"`);
  });

  it('shows newlines as escapes', () => {
    const message = evaluateAssertion(
      { type: 'contains', value: 'z' },
      makeContext('one\ntwo\r\nthree'),
    ).message;
    expect(message).toBe('expected output to contain "z", found "one\\ntwo\\r\\nthree"');
    expect(message).not.toContain('\n');
  });
});

describe('evaluateAll', () => {
  const specs: AssertionSpec[] = [
    { type: 'contains', value: 'a' },
    { type: 'contains', value: 'zzz' },
    { type: 'length', min: 1 },
  ];

  it('evaluates every assertion and preserves order', () => {
    const results = evaluateAll(specs, makeContext('abc'));
    expect(results.map((result) => result.passed)).toEqual([true, false, true]);
    expect(results.map((result) => result.type)).toEqual(['contains', 'contains', 'length']);
  });

  it('does not short-circuit on a broken assertion in the middle', () => {
    const results = evaluateAll(
      [specs[0] as AssertionSpec, { type: 'nope' }, specs[2] as AssertionSpec],
      makeContext('abc'),
    );
    expect(results).toHaveLength(3);
    expect(results.map((result) => result.passed)).toEqual([true, false, true]);
  });

  it('returns an empty list for no assertions', () => {
    expect(evaluateAll([], makeContext('abc'))).toEqual([]);
  });
});

describe('summarizeResults', () => {
  const pass = { type: 'contains', passed: true, message: 'ok' };
  const fail = { type: 'contains', passed: false, message: 'no' };

  it('treats an empty list as passed with a total of 0', () => {
    expect(summarizeResults([])).toEqual({ passed: true, total: 0, failed: 0 });
  });

  it('passes when everything passed', () => {
    expect(summarizeResults([pass, pass])).toEqual({ passed: true, total: 2, failed: 0 });
  });

  it('fails when anything failed', () => {
    expect(summarizeResults([pass, fail, pass])).toEqual({ passed: false, total: 3, failed: 1 });
  });
});

describe('evaluateAssertion never throws', () => {
  it('fails cleanly for an unknown type', () => {
    const result = evaluateAssertion({ type: 'nope' }, makeContext('x'));
    expect(result.passed).toBe(false);
    expect(result.message).toBe(
      `assertion error: unknown assertion type "nope" (known: ${ALL_TYPES.join(', ')})`,
    );
  });

  it('fails cleanly for a regex that bypassed validation', () => {
    const result = evaluateAssertion({ type: 'regex', pattern: 'a(' }, makeContext('x'));
    expect(result.passed).toBe(false);
    expect(result.message).toMatch(/^assertion error: pattern: /);
    expect(result.message).toContain('Invalid regular expression');
  });

  it('fails cleanly for a schema that bypassed validation', () => {
    const result = evaluateAssertion(
      { type: 'json-schema', schema: { type: 'nonsense' } },
      makeContext('{}'),
    );
    expect(result.passed).toBe(false);
    expect(result.message).toMatch(/^assertion error: schema: /);
  });

  it('fails cleanly for a spec whose fields are the wrong type', () => {
    const result = evaluateAssertion({ type: 'length', min: 'two' }, makeContext('x'));
    expect(result.passed).toBe(false);
    expect(result.message).toMatch(/^assertion error: /);
  });

  it('fails cleanly for a variable that is missing at evaluation time', () => {
    const result = evaluateAssertion({ type: 'contains', value: '{{ city }}' }, makeContext('x'));
    expect(result).toEqual({
      type: 'contains',
      passed: false,
      message: 'assertion error: missing template variable(s): city',
    });
  });

  it('fails cleanly for a malformed template that bypassed validation', () => {
    const result = evaluateAssertion({ type: 'contains', value: '{{ oops' }, makeContext('x'));
    expect(result.passed).toBe(false);
    expect(result.message).toMatch(/^assertion error: unclosed "\{\{"/);
  });
});

describe('variable interpolation', () => {
  const vars = { city: 'Paris', n: 42, flag: true };

  it('renders the value of equals', () => {
    expect(
      evaluateAssertion({ type: 'equals', value: '{{ city }}' }, makeContext('Paris', { vars })),
    ).toEqual({ type: 'equals', passed: true, message: 'equals "Paris"' });
  });

  it('renders the value of contains, starts-with and ends-with', () => {
    const ctx = makeContext('Paris is lovely', { vars });
    expect(evaluateAssertion({ type: 'contains', value: '{{ city }}' }, ctx).message).toBe(
      'contains "Paris"',
    );
    expect(evaluateAssertion({ type: 'starts-with', value: '{{ city }}' }, ctx).message).toBe(
      'starts with "Paris"',
    );
    expect(evaluateAssertion({ type: 'ends-with', value: '{{ city }}' }, ctx).passed).toBe(false);
  });

  it('renders every item of contains-all and contains-any', () => {
    const ctx = makeContext('Paris and 42', { vars });
    expect(
      evaluateAssertion({ type: 'contains-all', values: ['{{ city }}', '{{ n }}'] }, ctx).passed,
    ).toBe(true);
    expect(
      evaluateAssertion({ type: 'contains-any', values: ['{{ city }}', 'Berlin'] }, ctx).passed,
    ).toBe(true);
  });

  it('stringifies numeric and boolean variables', () => {
    const ctx = makeContext('answer 42 is true', { vars });
    expect(evaluateAssertion({ type: 'contains', value: '{{ n }}' }, ctx).message).toBe(
      'contains "42"',
    );
    expect(evaluateAssertion({ type: 'contains', value: '{{ flag }}' }, ctx).message).toBe(
      'contains "true"',
    );
  });

  it('names the missing values after rendering them', () => {
    const ctx = makeContext('nothing here', { vars });
    expect(evaluateAssertion({ type: 'contains-all', values: ['{{ city }}'] }, ctx).message).toBe(
      'expected output to contain every value, missing "Paris"',
    );
  });

  it('ignores variables a value does not reference', () => {
    expect(
      evaluateAssertion({ type: 'contains', value: 'Paris' }, makeContext('Paris', { vars }))
        .passed,
    ).toBe(true);
  });
});
