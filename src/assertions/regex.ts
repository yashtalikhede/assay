/**
 * The `regex` assertion. The pattern is never interpolated: regular
 * expressions legitimately contain braces, so `a{2,3}` must stay a quantifier
 * rather than becoming a template placeholder.
 */

import { z } from 'zod';
import { check, define } from './definition.js';
import type { AssertionDefinition } from './definition.js';
import { quote } from './message.js';
import { assertionObject } from './schema.js';

/** The flags a pattern may carry, matching what RegExp accepts. */
const ALLOWED_FLAGS = 'dgimsuvy';

/** Whether a flags string uses only allowed flags, each at most once. */
function flagsAreWellFormed(flags: string): boolean {
  if (new Set(flags).size !== flags.length) return false;
  return [...flags].every((flag) => ALLOWED_FLAGS.includes(flag));
}

const regexSchema = assertionObject('regex', {
  pattern: z.string('"pattern" must be a string'),
  flags: z
    .string('"flags" must be a string')
    .refine(flagsAreWellFormed, `"flags" must be a subset of "${ALLOWED_FLAGS}" with no duplicates`)
    .default(''),
}).superRefine((spec, ctx) => {
  // Skip the compile when the flags are already known bad, so that a typo in
  // `flags` produces one clear issue instead of a cascade.
  if (!flagsAreWellFormed(spec.flags)) return;
  try {
    new RegExp(spec.pattern, spec.flags);
  } catch (error) {
    ctx.addIssue({
      code: 'custom',
      message: error instanceof Error ? error.message : String(error),
      path: ['pattern'],
    });
  }
});

/**
 * `regex`: the pattern must match somewhere in the output. A fresh RegExp is
 * built for every evaluation, so the `g` and `y` flags can never carry
 * `lastIndex` state from one case into the next.
 */
const regexDefinition = define({
  type: 'regex',
  schema: regexSchema,
  evaluate: (spec, ctx) => {
    const expression = new RegExp(spec.pattern, spec.flags);
    const shown = `/${spec.pattern}/${spec.flags}`;
    return check({
      holds: expression.test(ctx.output),
      label: `matches ${shown}`,
      verb: `to match ${shown}`,
      found: `found ${quote(ctx.output)}`,
    });
  },
});

/** The regex assertion type. */
export const regexDefinitions: readonly AssertionDefinition[] = [regexDefinition];
