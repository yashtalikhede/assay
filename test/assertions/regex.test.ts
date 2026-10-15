import { describe, expect, it } from 'vitest';
import { assertionTemplates, evaluateAssertion } from '../../src/assertions/index.js';
import type { AssertionSpec } from '../../src/core/types.js';
import { issueOf, makeContext } from './context.js';

/** Evaluate a spec against an output with no variables. */
function evaluate(spec: AssertionSpec, output: string) {
  return evaluateAssertion(spec, makeContext(output));
}

describe('regex', () => {
  const cases: [string, AssertionSpec, string, boolean, string][] = [
    ['matches anywhere', { type: 'regex', pattern: 'ris' }, 'Paris', true, 'matches /ris/'],
    [
      'no match',
      { type: 'regex', pattern: 'Berlin' },
      'Paris',
      false,
      'expected output to match /Berlin/, found "Paris"',
    ],
    [
      'anchors match the whole output',
      { type: 'regex', pattern: '^Paris$' },
      'Paris',
      true,
      'matches /^Paris$/',
    ],
    [
      'anchors fail on extra text',
      { type: 'regex', pattern: '^Paris$' },
      'Paris!',
      false,
      'expected output to match /^Paris$/, found "Paris!"',
    ],
    [
      'the i flag',
      { type: 'regex', pattern: 'paris', flags: 'i' },
      'PARIS',
      true,
      'matches /paris/i',
    ],
    [
      'the m flag',
      { type: 'regex', pattern: '^two$', flags: 'm' },
      'one\ntwo',
      true,
      'matches /^two$/m',
    ],
    ['the s flag', { type: 'regex', pattern: 'a.b', flags: 's' }, 'a\nb', true, 'matches /a.b/s'],
    [
      'without the s flag a dot does not cross a newline',
      { type: 'regex', pattern: '^a.b$' },
      'a\nb',
      false,
      'expected output to match /^a.b$/, found "a\\nb"',
    ],
    [
      'braces are a quantifier, not a template',
      { type: 'regex', pattern: 'a{2,3}' },
      'aaa',
      true,
      'matches /a{2,3}/',
    ],
    [
      'a brace quantifier that does not match',
      { type: 'regex', pattern: '^a{2,3}$' },
      'a',
      false,
      'expected output to match /^a{2,3}$/, found "a"',
    ],
    [
      'inverted and absent',
      { type: 'regex', pattern: 'z', not: true },
      'abc',
      true,
      'NOT matches /z/',
    ],
    [
      'inverted and present',
      { type: 'regex', pattern: 'b', not: true },
      'abc',
      false,
      'expected output NOT to match /b/',
    ],
  ];

  it.each(cases)('%s', (_label, spec, output, passed, message) => {
    expect(evaluate(spec, output)).toEqual({ type: spec.type, passed, message });
  });

  it('does not leak lastIndex state with the g flag', () => {
    const spec: AssertionSpec = { type: 'regex', pattern: 'a', flags: 'g' };
    const ctx = makeContext('aaa');
    const first = evaluateAssertion(spec, ctx);
    const second = evaluateAssertion(spec, ctx);
    expect(first).toEqual(second);
    expect(first.passed).toBe(true);
  });

  it('does not leak lastIndex state with the y flag', () => {
    const spec: AssertionSpec = { type: 'regex', pattern: 'a', flags: 'y' };
    const ctx = makeContext('aa');
    const results = [1, 2, 3].map(() => evaluateAssertion(spec, ctx));
    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toEqual(results[2]);
    expect(results[0]?.passed).toBe(true);
  });

  it('rejects a pattern that does not compile, quoting the engine', () => {
    const issue = issueOf({ type: 'regex', pattern: 'a(' });
    expect(issue).toMatch(/^pattern: /);
    expect(issue).toContain('Invalid regular expression');
  });

  it('rejects an unknown flag', () => {
    expect(issueOf({ type: 'regex', pattern: 'a', flags: 'q' })).toBe(
      'flags: "flags" must be a subset of "dgimsuvy" with no duplicates',
    );
  });

  it('rejects a duplicated flag', () => {
    expect(issueOf({ type: 'regex', pattern: 'a', flags: 'gg' })).toBe(
      'flags: "flags" must be a subset of "dgimsuvy" with no duplicates',
    );
  });

  it('rejects mutually exclusive flags through the engine', () => {
    expect(issueOf({ type: 'regex', pattern: 'a', flags: 'uv' })).toMatch(/^pattern: /);
  });

  it('does not interpolate the pattern', () => {
    expect(assertionTemplates({ type: 'regex', pattern: '{{ city }}' })).toEqual([]);
    expect(evaluate({ type: 'regex', pattern: '{{x}}' }, 'a {{x}} b')).toEqual({
      type: 'regex',
      passed: true,
      message: 'matches /{{x}}/',
    });
  });
});
