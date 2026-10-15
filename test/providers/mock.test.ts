import { describe, expect, it } from 'vitest';
import { AssayError, ProviderError } from '../../src/core/errors.js';
import { createMockProvider, estimateTokens } from '../../src/providers/mock.js';

describe('estimateTokens', () => {
  it('counts one token per four characters, rounded up', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abc')).toBe(1);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});

describe('mock:echo', () => {
  it('returns the prompt unchanged', async () => {
    const provider = createMockProvider({ id: 'mock:echo' });
    const result = await provider.generate({ prompt: 'say this back' });
    expect(result.text).toBe('say this back');
  });

  it('reports deterministic usage including the system message', async () => {
    const provider = createMockProvider({ id: 'mock:echo' });
    const result = await provider.generate({ prompt: 'abcdefgh', system: 'xyz' });
    // input: 8 + 3 = 11 characters -> 3 tokens; output: 8 characters -> 2 tokens.
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 2 });
    expect(result.costUsd).toBeUndefined();
  });

  it('measures its own latency', async () => {
    const provider = createMockProvider({ id: 'mock:echo' });
    const result = await provider.generate({ prompt: 'x' });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe('mock:fixed', () => {
  it('always returns the configured response', async () => {
    const provider = createMockProvider({ id: 'mock:fixed', config: { response: 'always' } });
    expect((await provider.generate({ prompt: 'a' })).text).toBe('always');
    expect((await provider.generate({ prompt: 'b' })).text).toBe('always');
  });

  it('rejects a missing or non-string response at creation', () => {
    expect(() => createMockProvider({ id: 'mock:fixed' })).toThrow(AssayError);
    expect(() => createMockProvider({ id: 'mock:fixed' })).toThrow(
      'provider "mock:fixed": config.response must be a string',
    );
    expect(() => createMockProvider({ id: 'mock:fixed', config: { response: 7 } })).toThrow(
      AssayError,
    );
  });

  it('computes cost from the per-1k prices and the token estimate', async () => {
    const provider = createMockProvider({
      id: 'mock:fixed',
      config: { response: '0123456789', inputCostPer1k: 3, outputCostPer1k: 15 },
    });
    const result = await provider.generate({ prompt: 'x'.repeat(40) });
    // input 40 chars -> 10 tokens; output 10 chars -> 3 tokens.
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 3 });
    expect(result.costUsd).toBeCloseTo((10 / 1000) * 3 + (3 / 1000) * 15, 10);
  });

  it('omits cost when only one price is configured', async () => {
    const provider = createMockProvider({
      id: 'mock:fixed',
      config: { response: 'hi', inputCostPer1k: 3 },
    });
    expect((await provider.generate({ prompt: 'x' })).costUsd).toBeUndefined();
  });
});

describe('mock:script', () => {
  it('cycles through the configured responses', async () => {
    const provider = createMockProvider({
      id: 'mock:script',
      config: { responses: ['one', 'two'] },
    });
    const texts: string[] = [];
    for (let i = 0; i < 5; i += 1) texts.push((await provider.generate({ prompt: 'p' })).text);
    expect(texts).toEqual(['one', 'two', 'one', 'two', 'one']);
  });

  it('keeps the call counter per provider instance', async () => {
    const spec = { id: 'mock:script', config: { responses: ['one', 'two'] } };
    const first = createMockProvider(spec);
    const second = createMockProvider(spec);
    await first.generate({ prompt: 'p' });
    expect((await first.generate({ prompt: 'p' })).text).toBe('two');
    expect((await second.generate({ prompt: 'p' })).text).toBe('one');
  });

  it('rejects an empty or non-string responses list at creation', () => {
    expect(() => createMockProvider({ id: 'mock:script', config: { responses: [] } })).toThrow(
      'provider "mock:script": config.responses must be a non-empty array of strings',
    );
    expect(() => createMockProvider({ id: 'mock:script' })).toThrow(AssayError);
    expect(() =>
      createMockProvider({ id: 'mock:script', config: { responses: ['ok', 3] } }),
    ).toThrow(AssayError);
  });
});

describe('mock:fail', () => {
  it('throws a non-retryable ProviderError by default', async () => {
    const provider = createMockProvider({ id: 'mock:fail' });
    let caught: unknown;
    try {
      await provider.generate({ prompt: 'p' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProviderError);
    const error = caught as ProviderError;
    expect(error.message).toBe('mock failure');
    expect(error.retryable).toBe(false);
    expect(error.status).toBeUndefined();
  });

  it('propagates the configured message, retryable flag and status', async () => {
    const provider = createMockProvider({
      id: 'mock:fail',
      config: { message: 'rate limited', retryable: true, status: 429 },
    });
    await expect(provider.generate({ prompt: 'p' })).rejects.toMatchObject({
      message: 'rate limited',
      retryable: true,
      status: 429,
    });
  });

  it('rejects a non-boolean retryable at creation', () => {
    expect(() => createMockProvider({ id: 'mock:fail', config: { retryable: 'yes' } })).toThrow(
      AssayError,
    );
  });
});

describe('mock latency and cancellation', () => {
  it('waits at least the configured latency', async () => {
    const provider = createMockProvider({ id: 'mock:echo', config: { latencyMs: 20 } });
    const startedAt = performance.now();
    const result = await provider.generate({ prompt: 'p' });
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(15);
    expect(result.latencyMs).toBeGreaterThanOrEqual(15);
  });

  it('rejects immediately with the reason of an already-aborted signal', async () => {
    const provider = createMockProvider({ id: 'mock:echo', config: { latencyMs: 20 } });
    const controller = new AbortController();
    const reason = new Error('caller gave up');
    controller.abort(reason);
    await expect(provider.generate({ prompt: 'p', signal: controller.signal })).rejects.toBe(
      reason,
    );
  });

  it('rejects with the signal reason when aborted mid-wait', async () => {
    const provider = createMockProvider({ id: 'mock:echo', config: { latencyMs: 1000 } });
    const controller = new AbortController();
    const reason = new Error('too slow');
    const pending = provider.generate({ prompt: 'p', signal: controller.signal });
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it('rejects a negative latency at creation', () => {
    expect(() => createMockProvider({ id: 'mock:echo', config: { latencyMs: -1 } })).toThrow(
      'provider "mock:echo": config.latencyMs must be a number >= 0',
    );
  });
});

describe('unknown mock models', () => {
  it('throws an AssayError naming the valid models', () => {
    expect(() => createMockProvider({ id: 'mock:magic' })).toThrow(AssayError);
    expect(() => createMockProvider({ id: 'mock:magic' })).toThrow(
      /unknown mock model "magic".*"echo", "fixed", "script", "fail"/,
    );
  });
});
