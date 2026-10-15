import { describe, expect, it } from 'vitest';
import { AssayError, UnknownProviderError } from '../../src/core/errors.js';
import type { Provider, ProviderSpec } from '../../src/core/types.js';
import {
  ProviderRegistry,
  createDefaultRegistry,
  splitProviderId,
} from '../../src/providers/registry.js';

const stub = (spec: ProviderSpec): Provider => ({
  id: spec.id,
  generate: () => Promise.resolve({ text: '', latencyMs: 0 }),
});

describe('splitProviderId', () => {
  it('splits at the first colon only', () => {
    expect(splitProviderId('mock:a:b')).toEqual({ kind: 'mock', model: 'a:b' });
  });

  it('rejects ids without a usable kind and model', () => {
    expect(() => splitProviderId('mock')).toThrow(AssayError);
    expect(() => splitProviderId(':model')).toThrow(AssayError);
    expect(() => splitProviderId('mock:')).toThrow(/expected "kind:model"/);
  });
});

describe('ProviderRegistry', () => {
  it('reports registered kinds through has()', () => {
    const registry = new ProviderRegistry();
    expect(registry.has('stub')).toBe(false);
    registry.register('stub', stub);
    expect(registry.has('stub')).toBe(true);
  });

  it('creates a provider for a registered kind', () => {
    const registry = new ProviderRegistry();
    registry.register('stub', stub);
    expect(registry.create({ id: 'stub:v1' }).id).toBe('stub:v1');
  });

  it('throws UnknownProviderError listing the registered kinds', () => {
    const registry = new ProviderRegistry();
    registry.register('beta', stub);
    registry.register('alpha', stub);
    let caught: unknown;
    try {
      registry.create({ id: 'gamma:v1' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnknownProviderError);
    expect((caught as Error).message).toBe(
      'unknown provider kind "gamma" in "gamma:v1": registered kinds are "alpha", "beta"',
    );
  });

  it('refuses to register the same kind twice', () => {
    const registry = new ProviderRegistry();
    registry.register('stub', stub);
    expect(() => registry.register('stub', stub)).toThrow(AssayError);
    expect(() => registry.register('stub', stub)).toThrow(/already registered/);
  });
});

describe('createDefaultRegistry', () => {
  it('registers the mock kind and nothing else', () => {
    const registry = createDefaultRegistry();
    expect(registry.kinds()).toEqual(['mock']);
  });

  it('creates mock providers by id', () => {
    expect(createDefaultRegistry().create({ id: 'mock:echo' }).id).toBe('mock:echo');
  });
});
