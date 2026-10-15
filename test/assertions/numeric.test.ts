import { describe, expect, it } from 'vitest';
import { evaluateAssertion } from '../../src/assertions/index.js';
import type { AssertionSpec } from '../../src/core/types.js';
import { issueOf, makeContext } from './context.js';
import type { ContextOverrides } from './context.js';

/** Evaluate a spec against a context built from overrides. */
function evaluate(spec: AssertionSpec, overrides: ContextOverrides, output = 'hello') {
  return evaluateAssertion(spec, makeContext(output, overrides));
}

describe('max-latency', () => {
  const cases: [string, number, boolean, string][] = [
    ['below the limit', 50, true, 'latency 50ms <= 100ms'],
    ['exactly at the limit', 100, true, 'latency 100ms <= 100ms'],
    ['above the limit', 150, false, 'expected latency to be at most 100ms, found 150ms'],
  ];

  it.each(cases)('%s', (_label, latencyMs, passed, message) => {
    expect(evaluate({ type: 'max-latency', value: 100 }, { latencyMs })).toEqual({
      type: 'max-latency',
      passed,
      message,
    });
  });

  it('inverts with not', () => {
    expect(evaluate({ type: 'max-latency', value: 100, not: true }, { latencyMs: 150 })).toEqual({
      type: 'max-latency',
      passed: true,
      message: 'NOT latency 150ms <= 100ms',
    });
    expect(evaluate({ type: 'max-latency', value: 100, not: true }, { latencyMs: 50 })).toEqual({
      type: 'max-latency',
      passed: false,
      message: 'expected latency NOT to be at most 100ms',
    });
  });

  it('rejects a negative limit', () => {
    expect(issueOf({ type: 'max-latency', value: -1 })).toBe('value: "value" must not be negative');
  });

  it('rejects a missing limit', () => {
    expect(issueOf({ type: 'max-latency' })).toBe('value: "value" must be a number');
  });
});

describe('max-cost', () => {
  const cases: [string, number, boolean, string][] = [
    ['below the limit', 0.001, true, 'cost $0.001 <= $0.01'],
    ['exactly at the limit', 0.01, true, 'cost $0.01 <= $0.01'],
    ['above the limit', 0.05, false, 'expected cost to be at most $0.01, found $0.05'],
  ];

  it.each(cases)('%s', (_label, costUsd, passed, message) => {
    expect(evaluate({ type: 'max-cost', value: 0.01 }, { costUsd })).toEqual({
      type: 'max-cost',
      passed,
      message,
    });
  });

  it('fails when the cost was never measured', () => {
    expect(evaluate({ type: 'max-cost', value: 0.01 }, {})).toEqual({
      type: 'max-cost',
      passed: false,
      message: 'cost unavailable',
    });
  });

  it('passes an unmeasured cost only when allowUnknown is set', () => {
    expect(evaluate({ type: 'max-cost', value: 0.01, allowUnknown: true }, {})).toEqual({
      type: 'max-cost',
      passed: true,
      message: 'cost unavailable (allowed)',
    });
  });

  it('does not let not invert an unmeasured cost into a pass', () => {
    expect(evaluate({ type: 'max-cost', value: 0.01, not: true }, {})).toEqual({
      type: 'max-cost',
      passed: false,
      message: 'cost unavailable',
    });
  });

  it('inverts a measured cost with not', () => {
    expect(evaluate({ type: 'max-cost', value: 0.01, not: true }, { costUsd: 0.05 })).toEqual({
      type: 'max-cost',
      passed: true,
      message: 'NOT cost $0.05 <= $0.01',
    });
  });
});

describe('max-tokens', () => {
  const usage = (outputTokens: number) => ({ inputTokens: 0, outputTokens });

  const cases: [string, number, boolean, string][] = [
    ['below the limit', 10, true, 'output tokens 10 <= 50'],
    ['exactly at the limit', 50, true, 'output tokens 50 <= 50'],
    ['above the limit', 80, false, 'expected output tokens to be at most 50, found 80'],
  ];

  it.each(cases)('%s', (_label, outputTokens, passed, message) => {
    expect(evaluate({ type: 'max-tokens', value: 50 }, { usage: usage(outputTokens) })).toEqual({
      type: 'max-tokens',
      passed,
      message,
    });
  });

  it('fails when usage was never reported', () => {
    expect(evaluate({ type: 'max-tokens', value: 50 }, {})).toEqual({
      type: 'max-tokens',
      passed: false,
      message: 'output tokens unavailable',
    });
  });

  it('passes unreported usage only when allowUnknown is set', () => {
    expect(evaluate({ type: 'max-tokens', value: 50, allowUnknown: true }, {})).toEqual({
      type: 'max-tokens',
      passed: true,
      message: 'output tokens unavailable (allowed)',
    });
  });

  it('rejects a fractional limit', () => {
    expect(issueOf({ type: 'max-tokens', value: 1.5 })).toBe('value: "value" must be an integer');
  });
});

describe('length', () => {
  const cases: [string, AssertionSpec, string, boolean, string][] = [
    ['min only, satisfied', { type: 'length', min: 3 }, 'hello', true, 'output length 5 >= 3'],
    [
      'min only, too short',
      { type: 'length', min: 6 },
      'hello',
      false,
      'expected output length to be at least 6, found 5',
    ],
    [
      'min only, at the boundary',
      { type: 'length', min: 5 },
      'hello',
      true,
      'output length 5 >= 5',
    ],
    ['max only, satisfied', { type: 'length', max: 10 }, 'hello', true, 'output length 5 <= 10'],
    [
      'max only, too long',
      { type: 'length', max: 4 },
      'hello',
      false,
      'expected output length to be at most 4, found 5',
    ],
    [
      'max only, at the boundary',
      { type: 'length', max: 5 },
      'hello',
      true,
      'output length 5 <= 5',
    ],
    [
      'both bounds, satisfied',
      { type: 'length', min: 3, max: 10 },
      'hello',
      true,
      'output length 5 within 3..10',
    ],
    [
      'both bounds, too short',
      { type: 'length', min: 6, max: 10 },
      'hello',
      false,
      'expected output length to be between 6 and 10, found 5',
    ],
    ['an empty output with min 0', { type: 'length', min: 0 }, '', true, 'output length 0 >= 0'],
    ['inverted', { type: 'length', max: 4, not: true }, 'hello', true, 'NOT output length 5 <= 4'],
  ];

  it.each(cases)('%s', (_label, spec, output, passed, message) => {
    expect(evaluate(spec, {}, output)).toEqual({ type: spec.type, passed, message });
  });

  it('counts UTF-16 code units, so an astral emoji counts as two', () => {
    expect('😀'.length).toBe(2);
    expect(evaluate({ type: 'length', min: 2, max: 2 }, {}, '😀')).toEqual({
      type: 'length',
      passed: true,
      message: 'output length 2 within 2..2',
    });
  });

  it('rejects a spec with neither bound', () => {
    expect(issueOf({ type: 'length' })).toBe('set "min", "max" or both');
  });

  it('rejects min greater than max', () => {
    expect(issueOf({ type: 'length', min: 10, max: 2 })).toBe(
      'min: "min" must not be greater than "max"',
    );
  });

  it('accepts min equal to max', () => {
    expect(evaluate({ type: 'length', min: 5, max: 5 }, {}, 'hello').passed).toBe(true);
  });

  it('rejects a negative bound', () => {
    expect(issueOf({ type: 'length', min: -1 })).toBe('min: "min" must not be negative');
  });
});
