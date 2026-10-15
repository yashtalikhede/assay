/**
 * Deterministic mock providers. The model half of the id selects the
 * behaviour: `mock:echo`, `mock:fixed`, `mock:script` and `mock:fail`.
 *
 * Nothing here uses Math.random or Date.now; performance.now() is used only to
 * measure the latency reported back in the result.
 */

import { AssayError, ProviderError } from '../core/errors.js';
import type { GenerateRequest, GenerateResult, Provider, ProviderSpec } from '../core/types.js';

/** The registry kind these providers are registered under. */
export const MOCK_KIND = 'mock';

/** Characters per estimated token, used for the deterministic usage figures. */
const CHARS_PER_TOKEN = 4;

/** Shared, optional config understood by the echo, fixed and script mocks. */
interface CommonConfig {
  latencyMs: number;
  inputCostPer1k?: number;
  outputCostPer1k?: number;
}

/** Read a config key, requiring a number of at least `min` when present. */
function optionalNumber(
  config: Record<string, unknown>,
  key: string,
  id: string,
  min: number,
): number | undefined {
  const value = config[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
    throw new AssayError(`provider "${id}": config.${key} must be a number >= ${min}`);
  }
  return value;
}

/** Validate the config shared by the latency- and cost-aware mocks. */
function readCommonConfig(spec: ProviderSpec): CommonConfig {
  const config = spec.config ?? {};
  const out: CommonConfig = { latencyMs: optionalNumber(config, 'latencyMs', spec.id, 0) ?? 0 };
  const inputCostPer1k = optionalNumber(config, 'inputCostPer1k', spec.id, 0);
  const outputCostPer1k = optionalNumber(config, 'outputCostPer1k', spec.id, 0);
  if (inputCostPer1k !== undefined) out.inputCostPer1k = inputCostPer1k;
  if (outputCostPer1k !== undefined) out.outputCostPer1k = outputCostPer1k;
  return out;
}

/** Estimate tokens for a piece of text as ceil(characters / 4). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Wait `ms`, rejecting with the signal's reason if it aborts first. */
function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(signal?.reason);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Build the result for a mock that produced `text`, timing the whole call. */
function finish(
  req: GenerateRequest,
  text: string,
  config: CommonConfig,
  startedAt: number,
): GenerateResult {
  const inputTokens = estimateTokens(req.prompt + (req.system ?? ''));
  const outputTokens = estimateTokens(text);
  const result: GenerateResult = {
    text,
    latencyMs: performance.now() - startedAt,
    usage: { inputTokens, outputTokens },
  };
  if (config.inputCostPer1k !== undefined && config.outputCostPer1k !== undefined) {
    result.costUsd =
      (inputTokens / 1000) * config.inputCostPer1k + (outputTokens / 1000) * config.outputCostPer1k;
  }
  return result;
}

/** A mock whose reply is computed from the request and the call index. */
type Replier = (req: GenerateRequest, callIndex: number) => string;

/** Build a provider that waits, then replies, then reports its own latency. */
function makeRepliedProvider(spec: ProviderSpec, reply: Replier): Provider {
  const config = readCommonConfig(spec);
  let calls = 0;

  return {
    id: spec.id,
    async generate(req: GenerateRequest): Promise<GenerateResult> {
      const startedAt = performance.now();
      if (req.signal?.aborted === true) throw req.signal.reason;
      if (config.latencyMs > 0) await wait(config.latencyMs, req.signal);
      const text = reply(req, calls);
      calls += 1;
      return finish(req, text, config, startedAt);
    },
  };
}

/** `mock:fixed` config: the single response it always returns. */
function readFixedResponse(spec: ProviderSpec): string {
  const value = (spec.config ?? {})['response'];
  if (typeof value !== 'string') {
    throw new AssayError(`provider "${spec.id}": config.response must be a string`);
  }
  return value;
}

/** `mock:script` config: the responses it cycles through. */
function readScriptResponses(spec: ProviderSpec): string[] {
  const value = (spec.config ?? {})['responses'];
  if (!Array.isArray(value) || value.length === 0 || value.some((v) => typeof v !== 'string')) {
    throw new AssayError(
      `provider "${spec.id}": config.responses must be a non-empty array of strings`,
    );
  }
  return [...(value as string[])];
}

/** Build the always-failing `mock:fail` provider. */
function makeFailingProvider(spec: ProviderSpec): Provider {
  const config = spec.config ?? {};
  const message = config['message'] ?? 'mock failure';
  if (typeof message !== 'string') {
    throw new AssayError(`provider "${spec.id}": config.message must be a string`);
  }
  const retryable = config['retryable'] ?? false;
  if (typeof retryable !== 'boolean') {
    throw new AssayError(`provider "${spec.id}": config.retryable must be a boolean`);
  }
  const status = optionalNumber(config, 'status', spec.id, 0);

  return {
    id: spec.id,
    generate(): Promise<GenerateResult> {
      return Promise.reject(
        new ProviderError(message, status === undefined ? { retryable } : { retryable, status }),
      );
    },
  };
}

/**
 * Create a mock provider from its spec. The model half of `spec.id` picks the
 * behaviour; config is validated here so bad suites fail before any run.
 */
export function createMockProvider(spec: ProviderSpec): Provider {
  const colon = spec.id.indexOf(':');
  const model = colon === -1 ? '' : spec.id.slice(colon + 1);

  switch (model) {
    case 'echo':
      return makeRepliedProvider(spec, (req) => req.prompt);
    case 'fixed': {
      const response = readFixedResponse(spec);
      return makeRepliedProvider(spec, () => response);
    }
    case 'script': {
      const responses = readScriptResponses(spec);
      return makeRepliedProvider(spec, (_req, callIndex) => {
        const text = responses[callIndex % responses.length];
        return text ?? '';
      });
    }
    case 'fail':
      return makeFailingProvider(spec);
    default:
      throw new AssayError(
        `unknown mock model "${model}" in "${spec.id}": expected one of "echo", "fixed", "script", "fail"`,
      );
  }
}
