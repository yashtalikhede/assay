/** Helpers shared by the assertion tests. */

import { normalizeAssertion } from '../../src/assertions/index.js';
import type { AssertionContext } from '../../src/assertions/types.js';
import type { AssertionSpec, Scalar } from '../../src/core/types.js';

/** The parts of a context a test may want to override. */
export interface ContextOverrides {
  latencyMs?: number;
  vars?: Record<string, Scalar>;
  usage?: { inputTokens: number; outputTokens: number };
  costUsd?: number;
}

/** Build an AssertionContext, defaulting everything not given. */
export function makeContext(output: string, overrides: ContextOverrides = {}): AssertionContext {
  const ctx: AssertionContext = {
    output,
    latencyMs: overrides.latencyMs ?? 0,
    vars: overrides.vars ?? {},
  };
  if (overrides.usage !== undefined) ctx.usage = overrides.usage;
  if (overrides.costUsd !== undefined) ctx.costUsd = overrides.costUsd;
  return ctx;
}

/** Normalize a spec expected to be rejected, returning the issue line. */
export function issueOf(spec: AssertionSpec): string {
  const result = normalizeAssertion(spec);
  if (result.ok) throw new Error(`expected normalizeAssertion to reject ${JSON.stringify(spec)}`);
  return result.issue;
}

/** Normalize a spec expected to be accepted, returning the normalized spec. */
export function normalized(spec: AssertionSpec): AssertionSpec {
  const result = normalizeAssertion(spec);
  if (!result.ok) throw new Error(`expected normalizeAssertion to accept: ${result.issue}`);
  return result.spec;
}
