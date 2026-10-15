import { describe, expect, it } from 'vitest';
import { evaluateAssertion } from '../../src/assertions/index.js';
import { makeContext } from './context.js';

/**
 * mulberry32: a tiny seeded PRNG, so this test explores a lot of inputs and
 * still fails identically on every machine and every run.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The characters random strings are built from. */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz ';

/** A character that never appears in a generated string. */
const ABSENT = '#';

const SAMPLES = 500;

describe('text assertions over random strings', () => {
  const random = mulberry32(0x5eed);

  /** A random string of 0..39 characters drawn from the alphabet. */
  function randomString(): string {
    const length = Math.floor(random() * 40);
    let out = '';
    for (let i = 0; i < length; i += 1) {
      out += ALPHABET[Math.floor(random() * ALPHABET.length)];
    }
    return out;
  }

  it(`holds the contains, equals and length invariants over ${SAMPLES} strings`, () => {
    expect(ALPHABET).not.toContain(ABSENT);

    for (let sample = 0; sample < SAMPLES; sample += 1) {
      const text = randomString();
      const start = Math.floor(random() * (text.length + 1));
      const end = start + Math.floor(random() * (text.length - start + 1));
      const substring = text.slice(start, end);

      const ctx = makeContext(text);

      const contained = evaluateAssertion({ type: 'contains', value: substring }, ctx);
      expect(
        contained.passed,
        `contains ${JSON.stringify(substring)} of ${JSON.stringify(text)}`,
      ).toBe(true);

      const absent = evaluateAssertion({ type: 'contains', value: substring + ABSENT }, ctx);
      expect(absent.passed, `contains ${JSON.stringify(substring + ABSENT)}`).toBe(false);

      const same = evaluateAssertion({ type: 'equals', value: text }, ctx);
      expect(same.passed, `equals itself: ${JSON.stringify(text)}`).toBe(true);

      const sized = evaluateAssertion({ type: 'length', min: text.length, max: text.length }, ctx);
      expect(sized.passed, `length of ${JSON.stringify(text)}`).toBe(true);
    }
  });

  it('is reproducible from the same seed', () => {
    const first = mulberry32(1);
    const second = mulberry32(1);
    expect([first(), first(), first()]).toEqual([second(), second(), second()]);
  });
});
