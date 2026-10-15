/**
 * The contract between the assertion engine and whatever produced a result:
 * a runner in later phases, or the `assay check` command today.
 */

import type { Scalar } from '../core/types.js';

/** Everything an assertion is allowed to look at. */
export interface AssertionContext {
  output: string;
  latencyMs: number;
  usage?: { inputTokens: number; outputTokens: number };
  costUsd?: number;
  vars: Record<string, Scalar>;
}

/** The outcome of one assertion, ready to print or serialise. */
export interface AssertionResult {
  type: string;
  description?: string;
  passed: boolean;
  message: string;
}
