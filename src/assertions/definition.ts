/**
 * How an assertion type is described internally: a strict schema, the fields
 * that take `{{ var }}` interpolation, and an evaluator that reports an
 * outcome rather than a finished message.
 *
 * Evaluators describe their check in the positive and let the engine phrase
 * the message, so that `not: true` reads correctly everywhere without each
 * type having to write four variants of its own message.
 */

import type { z } from 'zod';
import type { AssertionContext } from './types.js';

/** A comparison that either holds or does not, phrased by the engine. */
export interface CheckOutcome {
  kind: 'check';
  /** Whether the check held, before `not` is applied. */
  holds: boolean;
  /** Short positive statement, e.g. `contains "paris"`. */
  label: string;
  /** Verb phrase completing "expected <subject> ...", e.g. `to contain "x"`. */
  verb: string;
  /** What the check is about. Defaults to `output`. */
  subject?: string;
  /** What was actually seen, e.g. `found "berlin"`. */
  found?: string;
}

/**
 * A result the engine must not rephrase or invert, used when the assertion
 * could not be evaluated at all (for example a cost that was never measured).
 */
export interface FinalOutcome {
  kind: 'final';
  passed: boolean;
  message: string;
}

/** What an evaluator returns. */
export type Outcome = CheckOutcome | FinalOutcome;

/** Build a CheckOutcome. */
export function check(outcome: Omit<CheckOutcome, 'kind'>): CheckOutcome {
  return { kind: 'check', ...outcome };
}

/** Build a FinalOutcome, which `not` never inverts. */
export function final(passed: boolean, message: string): FinalOutcome {
  return { kind: 'final', passed, message };
}

/** One assertion type, with its schema erased so the registry stays uniform. */
export interface AssertionDefinition {
  readonly type: string;
  readonly schema: z.ZodType;
  /** Fields holding a single template string. */
  readonly stringFields: readonly string[];
  /** Fields holding an array of template strings. */
  readonly stringArrayFields: readonly string[];
  evaluate(spec: Record<string, unknown>, ctx: AssertionContext): Outcome;
}

/** Declare an assertion type, keeping its evaluator typed by its schema. */
export function define<S extends z.ZodType>(config: {
  type: string;
  schema: S;
  stringFields?: readonly string[];
  stringArrayFields?: readonly string[];
  evaluate: (spec: z.output<S>, ctx: AssertionContext) => Outcome;
}): AssertionDefinition {
  return {
    type: config.type,
    schema: config.schema,
    stringFields: config.stringFields ?? [],
    stringArrayFields: config.stringArrayFields ?? [],
    // Safe: the engine only ever evaluates a spec this schema produced.
    evaluate: (spec, ctx) => config.evaluate(spec as z.output<S>, ctx),
  };
}
