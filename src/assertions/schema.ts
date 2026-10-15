/** Helpers for building the strict per-type assertion schemas. */

import { z } from 'zod';

/** The optional fields every assertion type accepts. */
const universalShape = {
  description: z.string('"description" must be a string').optional(),
  not: z.boolean('"not" must be a boolean').default(false),
};

/**
 * A strict schema for one assertion type: its own fields plus `type`,
 * `description` and `not`. Unknown keys are errors, so typos are caught.
 */
export function assertionObject<Shape extends z.ZodRawShape>(
  type: string,
  shape: Shape,
): z.ZodObject<Shape & typeof universalShape & { type: z.ZodLiteral<string> }> {
  return z.strictObject({
    type: z.literal(type),
    ...universalShape,
    ...shape,
  }) as z.ZodObject<Shape & typeof universalShape & { type: z.ZodLiteral<string> }>;
}

/** A non-negative finite number, for latency and cost limits. */
export function nonNegativeNumber(label: string): z.ZodNumber {
  return z.number(`${label} must be a number`).min(0, `${label} must not be negative`);
}

/** A non-negative integer, for token and length limits. */
export function nonNegativeInteger(label: string): z.ZodNumber {
  return z
    .number(`${label} must be a number`)
    .int(`${label} must be an integer`)
    .min(0, `${label} must not be negative`);
}

/** The `caseSensitive` flag shared by the text assertions. */
export function caseSensitiveFlag(): z.ZodDefault<z.ZodBoolean> {
  return z.boolean('"caseSensitive" must be a boolean').default(true);
}
