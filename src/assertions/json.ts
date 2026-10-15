/**
 * The `json-valid` and `json-schema` assertions. Models like to wrap JSON in
 * a markdown fence, so both accept a `lenient` mode that unwraps the first
 * fenced block before parsing.
 */

import { Ajv } from 'ajv';
import type { ValidateFunction } from 'ajv';
import { z } from 'zod';
import { check, define } from './definition.js';
import type { AssertionDefinition } from './definition.js';
import { assertionObject } from './schema.js';

/** At most this many schema errors appear in a message. */
const MAX_REPORTED_ERRORS = 5;

/** The first markdown fenced block, with an optional language tag. */
const FENCE_PATTERN = /```[A-Za-z0-9_-]*\r?\n?([\s\S]*?)```/;

/**
 * Ajv with strict mode off, because suites carry hand-written schemas that
 * need not satisfy Ajv's own style rules, and allErrors on so a message can
 * name more than the first problem.
 */
const ajv = new Ajv({ strict: false, allErrors: true });

/** Compiled validators, keyed by the schema object the suite holds. */
const validatorCache = new WeakMap<object, ValidateFunction>();

/** Compile a schema, reusing the validator for a schema already seen. */
function validatorFor(schema: object): ValidateFunction {
  const cached = validatorCache.get(schema);
  if (cached !== undefined) return cached;
  const validate = ajv.compile(schema);
  validatorCache.set(schema, validate);
  return validate;
}

/**
 * The text to parse: the output as given, or, in lenient mode, the contents of
 * the first markdown fenced block, falling back to the trimmed output.
 */
function jsonText(output: string, lenient: boolean): string {
  if (!lenient) return output;
  const trimmed = output.trim();
  return FENCE_PATTERN.exec(trimmed)?.[1] ?? trimmed;
}

/** Parse JSON without throwing. */
function parseJson(text: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Format Ajv errors as `<instancePath or />: <message>`, at most five. */
function formatErrors(errors: ValidateFunction['errors']): string {
  return (errors ?? [])
    .slice(0, MAX_REPORTED_ERRORS)
    .map(
      (error) =>
        `${error.instancePath === '' ? '/' : error.instancePath}: ${error.message ?? 'is invalid'}`,
    )
    .join('; ');
}

const lenientFlag = z.boolean('"lenient" must be a boolean').default(false);

/** `json-valid`: the output must parse as JSON. */
const jsonValidDefinition = define({
  type: 'json-valid',
  schema: assertionObject('json-valid', { lenient: lenientFlag }),
  evaluate: (spec, ctx) => {
    const parsed = parseJson(jsonText(ctx.output, spec.lenient));
    return check({
      holds: parsed.ok,
      label: 'valid JSON',
      verb: 'to be valid JSON',
      ...(parsed.ok ? {} : { found: `parse failed: ${parsed.reason}` }),
    });
  },
});

/** `json-schema`: the output must parse as JSON and satisfy the schema. */
const jsonSchemaDefinition = define({
  type: 'json-schema',
  schema: assertionObject('json-schema', {
    schema: z.record(z.string(), z.unknown(), '"schema" must be a mapping'),
    lenient: lenientFlag,
  }).superRefine((spec, ctx) => {
    try {
      validatorFor(spec.schema);
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : String(error),
        path: ['schema'],
      });
    }
  }),
  evaluate: (spec, ctx) => {
    const parsed = parseJson(jsonText(ctx.output, spec.lenient));
    if (!parsed.ok) {
      return check({
        holds: false,
        label: 'matches the JSON schema',
        verb: 'to be valid JSON matching the schema',
        found: `parse failed: ${parsed.reason}`,
      });
    }
    const validate = validatorFor(spec.schema);
    const holds = validate(parsed.value) === true;
    return check({
      holds,
      label: 'matches the JSON schema',
      verb: 'to match the JSON schema',
      ...(holds ? {} : { found: `errors: ${formatErrors(validate.errors)}` }),
    });
  },
});

/** The JSON assertion types. */
export const jsonDefinitions: readonly AssertionDefinition[] = [
  jsonValidDefinition,
  jsonSchemaDefinition,
];
