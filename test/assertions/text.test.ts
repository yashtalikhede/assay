import { describe, expect, it } from 'vitest';
import { evaluateAssertion } from '../../src/assertions/index.js';
import type { AssertionSpec } from '../../src/core/types.js';
import { issueOf, makeContext } from './context.js';

/** Evaluate a spec against an output with no variables. */
function evaluate(spec: AssertionSpec, output: string) {
  return evaluateAssertion(spec, makeContext(output));
}

describe('equals', () => {
  const cases: [string, AssertionSpec, string, boolean, string][] = [
    ['exact match', { type: 'equals', value: 'hello' }, 'hello', true, 'equals "hello"'],
    [
      'different text',
      { type: 'equals', value: 'hello' },
      'goodbye',
      false,
      'expected output to equal "hello", found "goodbye"',
    ],
    [
      'leading whitespace fails by default',
      { type: 'equals', value: 'hello' },
      '  hello',
      false,
      'expected output to equal "hello", found "  hello"',
    ],
    [
      'trailing newline fails by default',
      { type: 'equals', value: 'hello' },
      'hello\n',
      false,
      'expected output to equal "hello", found "hello\\n"',
    ],
    [
      'case-insensitive',
      { type: 'equals', value: 'HELLO', caseSensitive: false },
      'hello',
      true,
      'equals "HELLO"',
    ],
    [
      'case-sensitive by default',
      { type: 'equals', value: 'HELLO' },
      'hello',
      false,
      'expected output to equal "HELLO", found "hello"',
    ],
    ['trim', { type: 'equals', value: 'hello', trim: true }, '  hello\n', true, 'equals "hello"'],
    ['empty output and empty value', { type: 'equals', value: '' }, '', true, 'equals ""'],
    [
      'inverted and different',
      { type: 'equals', value: 'hello', not: true },
      'goodbye',
      true,
      'NOT equals "hello"',
    ],
    [
      'inverted and equal',
      { type: 'equals', value: 'hello', not: true },
      'hello',
      false,
      'expected output NOT to equal "hello"',
    ],
  ];

  it.each(cases)('%s', (_label, spec, output, passed, message) => {
    expect(evaluate(spec, output)).toEqual({ type: spec.type, passed, message });
  });

  it('rejects a missing value', () => {
    expect(issueOf({ type: 'equals' })).toBe('value: "value" must be a string');
  });
});

describe('contains', () => {
  const cases: [string, AssertionSpec, string, boolean, string][] = [
    ['found', { type: 'contains', value: 'Paris' }, 'Paris is nice', true, 'contains "Paris"'],
    [
      'wrong case fails by default',
      { type: 'contains', value: 'paris' },
      'Paris is nice',
      false,
      'expected output to contain "paris", found "Paris is nice"',
    ],
    [
      'case-insensitive',
      { type: 'contains', value: 'paris', caseSensitive: false },
      'Paris is nice',
      true,
      'contains "paris"',
    ],
    [
      'unicode',
      { type: 'contains', value: 'Zürich' },
      'Zürich ist schön',
      true,
      'contains "Zürich"',
    ],
    [
      'unicode case-insensitive',
      { type: 'contains', value: 'zürich', caseSensitive: false },
      'Zürich ist schön',
      true,
      'contains "zürich"',
    ],
    [
      'the empty value is always contained',
      { type: 'contains', value: '' },
      'x',
      true,
      'contains ""',
    ],
    ['the empty value in empty output', { type: 'contains', value: '' }, '', true, 'contains ""'],
    [
      'output shorter than the value',
      { type: 'contains', value: 'hi there' },
      'hi',
      false,
      'expected output to contain "hi there", found "hi"',
    ],
    [
      'inverted and absent',
      { type: 'contains', value: 'Berlin', not: true },
      'Paris is nice',
      true,
      'NOT contains "Berlin"',
    ],
    [
      'inverted and present',
      { type: 'contains', value: 'Paris', not: true },
      'Paris is nice',
      false,
      'expected output NOT to contain "Paris"',
    ],
  ];

  it.each(cases)('%s', (_label, spec, output, passed, message) => {
    expect(evaluate(spec, output)).toEqual({ type: spec.type, passed, message });
  });
});

describe('starts-with and ends-with', () => {
  const cases: [string, AssertionSpec, string, boolean, string][] = [
    ['starts', { type: 'starts-with', value: 'Par' }, 'Paris', true, 'starts with "Par"'],
    [
      'does not start',
      { type: 'starts-with', value: 'ris' },
      'Paris',
      false,
      'expected output to start with "ris", found "Paris"',
    ],
    [
      'starts, case-insensitive',
      { type: 'starts-with', value: 'par', caseSensitive: false },
      'Paris',
      true,
      'starts with "par"',
    ],
    [
      'starts, wrong case',
      { type: 'starts-with', value: 'par' },
      'Paris',
      false,
      'expected output to start with "par", found "Paris"',
    ],
    ['ends', { type: 'ends-with', value: 'ris' }, 'Paris', true, 'ends with "ris"'],
    [
      'does not end',
      { type: 'ends-with', value: 'Par' },
      'Paris',
      false,
      'expected output to end with "Par", found "Paris"',
    ],
    [
      'ends, case-insensitive',
      { type: 'ends-with', value: 'RIS', caseSensitive: false },
      'Paris',
      true,
      'ends with "RIS"',
    ],
    [
      'ends with unicode',
      { type: 'ends-with', value: 'schön' },
      'Zürich ist schön',
      true,
      'ends with "schön"',
    ],
    [
      'output shorter than the value',
      { type: 'starts-with', value: 'hi there' },
      'hi',
      false,
      'expected output to start with "hi there", found "hi"',
    ],
    [
      'the empty value always starts',
      { type: 'starts-with', value: '' },
      'x',
      true,
      'starts with ""',
    ],
    ['the empty value always ends', { type: 'ends-with', value: '' }, 'x', true, 'ends with ""'],
    [
      'inverted',
      { type: 'ends-with', value: 'Par', not: true },
      'Paris',
      true,
      'NOT ends with "Par"',
    ],
  ];

  it.each(cases)('%s', (_label, spec, output, passed, message) => {
    expect(evaluate(spec, output)).toEqual({ type: spec.type, passed, message });
  });
});

describe('contains-all and contains-any', () => {
  const cases: [string, AssertionSpec, string, boolean, string][] = [
    [
      'all present',
      { type: 'contains-all', values: ['a', 'b'] },
      'a and b',
      true,
      'contains all 2 values',
    ],
    [
      'names the missing values',
      { type: 'contains-all', values: ['a', 'z', 'y'] },
      'a and b',
      false,
      'expected output to contain every value, missing "z", "y"',
    ],
    [
      'all present, case-insensitive',
      { type: 'contains-all', values: ['A', 'B'], caseSensitive: false },
      'a and b',
      true,
      'contains all 2 values',
    ],
    [
      'all present, wrong case',
      { type: 'contains-all', values: ['A', 'B'] },
      'a and b',
      false,
      'expected output to contain every value, missing "A", "B"',
    ],
    [
      'inverted, one missing',
      { type: 'contains-all', values: ['a', 'z'], not: true },
      'a and b',
      true,
      'NOT contains all 2 values',
    ],
    [
      'one present',
      { type: 'contains-any', values: ['x', 'b'] },
      'a and b',
      true,
      'contains one of 2 values',
    ],
    [
      'none present',
      { type: 'contains-any', values: ['x', 'y'] },
      'a and b',
      false,
      'expected output to contain at least one value, found none of "x", "y"',
    ],
    [
      'one present, case-insensitive',
      { type: 'contains-any', values: ['B'], caseSensitive: false },
      'a and b',
      true,
      'contains one of 1 values',
    ],
    [
      'inverted, none present',
      { type: 'contains-any', values: ['x'], not: true },
      'a and b',
      true,
      'NOT contains one of 1 values',
    ],
  ];

  it.each(cases)('%s', (_label, spec, output, passed, message) => {
    expect(evaluate(spec, output)).toEqual({ type: spec.type, passed, message });
  });

  it('rejects an empty values list', () => {
    expect(issueOf({ type: 'contains-all', values: [] })).toBe(
      'values: "values" must contain at least one value',
    );
  });

  it('rejects a non-string value', () => {
    expect(issueOf({ type: 'contains-any', values: ['ok', 3] })).toBe(
      'values[1]: each value must be a string',
    );
  });
});
