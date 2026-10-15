/**
 * The provider registry: maps the `kind` half of a provider id to a factory.
 */

import { AssayError, UnknownProviderError } from '../core/errors.js';
import type { Provider, ProviderFactory, ProviderSpec } from '../core/types.js';
import { MOCK_KIND, createMockProvider } from './mock.js';

/** Split a provider id at its first colon into kind and model. */
export function splitProviderId(id: string): { kind: string; model: string } {
  const colon = id.indexOf(':');
  if (colon <= 0 || colon === id.length - 1) {
    throw new AssayError(`invalid provider id "${id}": expected "kind:model"`);
  }
  return { kind: id.slice(0, colon), model: id.slice(colon + 1) };
}

/** Holds the known provider kinds and builds providers from specs. */
export class ProviderRegistry {
  readonly #factories = new Map<string, ProviderFactory>();

  /** Register a factory for a kind. Registering a kind twice is an error. */
  register(kind: string, factory: ProviderFactory): void {
    if (this.#factories.has(kind)) {
      throw new AssayError(`provider kind "${kind}" is already registered`);
    }
    this.#factories.set(kind, factory);
  }

  /** Whether a kind has been registered. */
  has(kind: string): boolean {
    return this.#factories.has(kind);
  }

  /** The registered kinds, sorted. */
  kinds(): string[] {
    return [...this.#factories.keys()].sort();
  }

  /** Build a provider from its spec, throwing if the kind is unknown. */
  create(spec: ProviderSpec): Provider {
    const { kind } = splitProviderId(spec.id);
    const factory = this.#factories.get(kind);
    if (factory === undefined) {
      throw new UnknownProviderError(
        `unknown provider kind "${kind}" in "${spec.id}": registered kinds are ${this.kinds()
          .map((registered) => `"${registered}"`)
          .join(', ')}`,
      );
    }
    return factory(spec);
  }
}

/**
 * A registry with the providers available in phase A1: the mock kind only.
 * Real providers arrive in phase A4.
 */
export function createDefaultRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(MOCK_KIND, createMockProvider);
  return registry;
}
