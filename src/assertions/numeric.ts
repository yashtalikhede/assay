/**
 * Budget and size assertions: max-latency, max-cost, max-tokens and length.
 *
 * `max-cost` and `max-tokens` need figures the provider may not report. When
 * the figure is missing they fail by default: a budget guard that passes
 * because it could not measure anything is worse than no guard at all. Set
 * `allowUnknown: true` to opt into the lenient behaviour deliberately.
 */

import { z } from 'zod';
import { check, define, final } from './definition.js';
import type { AssertionDefinition, Outcome } from './definition.js';
import { usd } from './message.js';
import { assertionObject, nonNegativeInteger, nonNegativeNumber } from './schema.js';

const allowUnknownFlag = z.boolean('"allowUnknown" must be a boolean').default(false);

/** The shared outcome when a figure the assertion needs was never measured. */
function unavailable(subject: string, allowUnknown: boolean): Outcome {
  return allowUnknown
    ? final(true, `${subject} unavailable (allowed)`)
    : final(false, `${subject} unavailable`);
}

/** `max-latency`: the call must not have taken longer than `value` ms. */
const maxLatencyDefinition = define({
  type: 'max-latency',
  schema: assertionObject('max-latency', { value: nonNegativeNumber('"value"') }),
  evaluate: (spec, ctx) =>
    check({
      holds: ctx.latencyMs <= spec.value,
      subject: 'latency',
      label: `latency ${ctx.latencyMs}ms <= ${spec.value}ms`,
      verb: `to be at most ${spec.value}ms`,
      found: `found ${ctx.latencyMs}ms`,
    }),
});

/** `max-cost`: the call must not have cost more than `value` dollars. */
const maxCostDefinition = define({
  type: 'max-cost',
  schema: assertionObject('max-cost', {
    value: nonNegativeNumber('"value"'),
    allowUnknown: allowUnknownFlag,
  }),
  evaluate: (spec, ctx) => {
    if (ctx.costUsd === undefined) return unavailable('cost', spec.allowUnknown);
    return check({
      holds: ctx.costUsd <= spec.value,
      subject: 'cost',
      label: `cost ${usd(ctx.costUsd)} <= ${usd(spec.value)}`,
      verb: `to be at most ${usd(spec.value)}`,
      found: `found ${usd(ctx.costUsd)}`,
    });
  },
});

/** `max-tokens`: the completion must not be longer than `value` tokens. */
const maxTokensDefinition = define({
  type: 'max-tokens',
  schema: assertionObject('max-tokens', {
    value: nonNegativeInteger('"value"'),
    allowUnknown: allowUnknownFlag,
  }),
  evaluate: (spec, ctx) => {
    if (ctx.usage === undefined) return unavailable('output tokens', spec.allowUnknown);
    const tokens = ctx.usage.outputTokens;
    return check({
      holds: tokens <= spec.value,
      subject: 'output tokens',
      label: `output tokens ${tokens} <= ${spec.value}`,
      verb: `to be at most ${spec.value}`,
      found: `found ${tokens}`,
    });
  },
});

const lengthSchema = assertionObject('length', {
  min: nonNegativeInteger('"min"').optional(),
  max: nonNegativeInteger('"max"').optional(),
}).superRefine((spec, ctx) => {
  if (spec.min === undefined && spec.max === undefined) {
    ctx.addIssue({ code: 'custom', message: 'set "min", "max" or both' });
    return;
  }
  if (spec.min !== undefined && spec.max !== undefined && spec.min > spec.max) {
    ctx.addIssue({
      code: 'custom',
      message: '"min" must not be greater than "max"',
      path: ['min'],
    });
  }
});

/**
 * `length`: the output length in UTF-16 code units, which is what
 * `String.prototype.length` counts. An emoji outside the basic multilingual
 * plane therefore counts as 2, and a combining sequence counts once per code
 * unit — this measures string size, not grapheme clusters.
 */
const lengthDefinition = define({
  type: 'length',
  schema: lengthSchema,
  evaluate: (spec, ctx) => {
    const length = ctx.output.length;
    const atLeast = spec.min === undefined || length >= spec.min;
    const atMost = spec.max === undefined || length <= spec.max;
    const bounds =
      spec.min !== undefined && spec.max !== undefined
        ? {
            label: `within ${spec.min}..${spec.max}`,
            verb: `to be between ${spec.min} and ${spec.max}`,
          }
        : spec.min !== undefined
          ? { label: `>= ${spec.min}`, verb: `to be at least ${spec.min}` }
          : { label: `<= ${String(spec.max)}`, verb: `to be at most ${String(spec.max)}` };
    return check({
      holds: atLeast && atMost,
      subject: 'output length',
      label: `output length ${length} ${bounds.label}`,
      verb: bounds.verb,
      found: `found ${length}`,
    });
  },
});

/** The budget and size assertion types. */
export const numericDefinitions: readonly AssertionDefinition[] = [
  maxLatencyDefinition,
  maxCostDefinition,
  maxTokensDefinition,
  lengthDefinition,
];
