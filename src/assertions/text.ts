/**
 * Text assertions: equals, contains, contains-all, contains-any, starts-with
 * and ends-with. Their comparison values support `{{ var }}` interpolation.
 */

import { z } from 'zod';
import { check, define } from './definition.js';
import type { AssertionDefinition } from './definition.js';
import { quote } from './message.js';
import { assertionObject, caseSensitiveFlag } from './schema.js';

/** Lower-case both sides when the comparison is case-insensitive. */
function fold(text: string, caseSensitive: boolean): string {
  return caseSensitive ? text : text.toLowerCase();
}

const valueField = z.string('"value" must be a string');
const valuesField = z
  .array(z.string('each value must be a string'), '"values" must be an array of strings')
  .min(1, '"values" must contain at least one value');

/** `equals`: the whole output must equal the value. */
const equalsDefinition = define({
  type: 'equals',
  schema: assertionObject('equals', {
    value: valueField,
    caseSensitive: caseSensitiveFlag(),
    trim: z.boolean('"trim" must be a boolean').default(false),
  }),
  stringFields: ['value'],
  evaluate: (spec, ctx) => {
    const output = spec.trim ? ctx.output.trim() : ctx.output;
    const value = spec.trim ? spec.value.trim() : spec.value;
    return check({
      holds: fold(output, spec.caseSensitive) === fold(value, spec.caseSensitive),
      label: `equals ${quote(value)}`,
      verb: `to equal ${quote(value)}`,
      found: `found ${quote(ctx.output)}`,
    });
  },
});

/** `contains`: the value must appear somewhere in the output. */
const containsDefinition = define({
  type: 'contains',
  schema: assertionObject('contains', {
    value: valueField,
    caseSensitive: caseSensitiveFlag(),
  }),
  stringFields: ['value'],
  evaluate: (spec, ctx) =>
    check({
      holds: fold(ctx.output, spec.caseSensitive).includes(fold(spec.value, spec.caseSensitive)),
      label: `contains ${quote(spec.value)}`,
      verb: `to contain ${quote(spec.value)}`,
      found: `found ${quote(ctx.output)}`,
    }),
});

/** `contains-all`: every value must appear; the message names the missing. */
const containsAllDefinition = define({
  type: 'contains-all',
  schema: assertionObject('contains-all', {
    values: valuesField,
    caseSensitive: caseSensitiveFlag(),
  }),
  stringArrayFields: ['values'],
  evaluate: (spec, ctx) => {
    const haystack = fold(ctx.output, spec.caseSensitive);
    const missing = spec.values.filter(
      (value) => !haystack.includes(fold(value, spec.caseSensitive)),
    );
    return check({
      holds: missing.length === 0,
      label: `contains all ${spec.values.length} values`,
      verb: 'to contain every value',
      found: `missing ${missing.map(quote).join(', ')}`,
    });
  },
});

/** `contains-any`: at least one value must appear. */
const containsAnyDefinition = define({
  type: 'contains-any',
  schema: assertionObject('contains-any', {
    values: valuesField,
    caseSensitive: caseSensitiveFlag(),
  }),
  stringArrayFields: ['values'],
  evaluate: (spec, ctx) => {
    const haystack = fold(ctx.output, spec.caseSensitive);
    return check({
      holds: spec.values.some((value) => haystack.includes(fold(value, spec.caseSensitive))),
      label: `contains one of ${spec.values.length} values`,
      verb: 'to contain at least one value',
      found: `found none of ${spec.values.map(quote).join(', ')}`,
    });
  },
});

/** `starts-with`: the output must begin with the value. */
const startsWithDefinition = define({
  type: 'starts-with',
  schema: assertionObject('starts-with', {
    value: valueField,
    caseSensitive: caseSensitiveFlag(),
  }),
  stringFields: ['value'],
  evaluate: (spec, ctx) =>
    check({
      holds: fold(ctx.output, spec.caseSensitive).startsWith(fold(spec.value, spec.caseSensitive)),
      label: `starts with ${quote(spec.value)}`,
      verb: `to start with ${quote(spec.value)}`,
      found: `found ${quote(ctx.output)}`,
    }),
});

/** `ends-with`: the output must finish with the value. */
const endsWithDefinition = define({
  type: 'ends-with',
  schema: assertionObject('ends-with', {
    value: valueField,
    caseSensitive: caseSensitiveFlag(),
  }),
  stringFields: ['value'],
  evaluate: (spec, ctx) =>
    check({
      holds: fold(ctx.output, spec.caseSensitive).endsWith(fold(spec.value, spec.caseSensitive)),
      label: `ends with ${quote(spec.value)}`,
      verb: `to end with ${quote(spec.value)}`,
      found: `found ${quote(ctx.output)}`,
    }),
});

/** Every text assertion type. */
export const textDefinitions: readonly AssertionDefinition[] = [
  equalsDefinition,
  containsDefinition,
  containsAllDefinition,
  containsAnyDefinition,
  startsWithDefinition,
  endsWithDefinition,
];
