/**
 * The assertion engine. Evaluation never throws: anything unexpected becomes
 * a failed result whose message starts with `assertion error:`, so one broken
 * assertion can never take down a run.
 */

import { render } from '../core/template.js';
import type { AssertionSpec, Scalar } from '../core/types.js';
import type { AssertionDefinition, Outcome } from './definition.js';
import { definitionFor, knownTypes } from './registry.js';
import type { AssertionContext, AssertionResult } from './types.js';

export type { AssertionContext, AssertionResult } from './types.js';

/** Every known assertion type, sorted. */
export function assertionTypes(): string[] {
  return knownTypes();
}

/** Render an issue path as `values[1]`, or an empty string at the root. */
function formatPath(path: ReadonlyArray<PropertyKey>): string {
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') out += `[${segment}]`;
    else if (out === '') out += String(segment);
    else out += `.${String(segment)}`;
  }
  return out;
}

/** The type of a spec as a string, however malformed the spec is. */
function typeOf(spec: AssertionSpec): string {
  return typeof spec.type === 'string' ? spec.type : String(spec.type);
}

/**
 * Validate one assertion against its type's schema, returning the normalized
 * spec with defaults filled in, or a single line describing what is wrong.
 */
export function normalizeAssertion(
  spec: AssertionSpec,
): { ok: true; spec: AssertionSpec } | { ok: false; issue: string } {
  const type = typeOf(spec);
  const definition = definitionFor(type);
  if (definition === undefined) {
    return {
      ok: false,
      issue: `unknown assertion type "${type}" (known: ${knownTypes().join(', ')})`,
    };
  }

  const parsed = definition.schema.safeParse(spec);
  if (!parsed.success) {
    const issue = parsed.error.issues
      .map((problem) => {
        const path = formatPath(problem.path);
        return path === '' ? problem.message : `${path}: ${problem.message}`;
      })
      .join('; ');
    return { ok: false, issue };
  }
  return { ok: true, spec: { ...(parsed.data as Record<string, unknown>) } as AssertionSpec };
}

/**
 * The raw template strings an assertion interpolates, for the static variable
 * check the suite loader performs. Unknown types have none.
 */
export function assertionTemplates(spec: AssertionSpec): string[] {
  const definition = definitionFor(typeOf(spec));
  if (definition === undefined) return [];
  const texts: string[] = [];
  for (const field of definition.stringFields) {
    const value = spec[field];
    if (typeof value === 'string') texts.push(value);
  }
  for (const field of definition.stringArrayFields) {
    const value = spec[field];
    if (!Array.isArray(value)) continue;
    for (const item of value) if (typeof item === 'string') texts.push(item);
  }
  return texts;
}

/** Render the interpolated fields of a spec with the test's variables. */
function interpolate(
  definition: AssertionDefinition,
  spec: AssertionSpec,
  vars: Record<string, Scalar>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...spec };
  for (const field of definition.stringFields) {
    const value = out[field];
    if (typeof value === 'string') out[field] = render(value, vars);
  }
  for (const field of definition.stringArrayFields) {
    const value = out[field];
    if (!Array.isArray(value)) continue;
    out[field] = value.map((item) => (typeof item === 'string' ? render(item, vars) : item));
  }
  return out;
}

/** Phrase an outcome, applying `not` to a comparison but never to a final. */
function phrase(outcome: Outcome, not: boolean): { passed: boolean; message: string } {
  if (outcome.kind === 'final') return { passed: outcome.passed, message: outcome.message };

  const subject = outcome.subject ?? 'output';
  if (!not) {
    if (outcome.holds) return { passed: true, message: outcome.label };
    const found = outcome.found === undefined ? '' : `, ${outcome.found}`;
    return { passed: false, message: `expected ${subject} ${outcome.verb}${found}` };
  }
  if (!outcome.holds) return { passed: true, message: `NOT ${outcome.label}` };
  return { passed: false, message: `expected ${subject} NOT ${outcome.verb}` };
}

/** Build a result, carrying the description through when there is one. */
function makeResult(
  type: string,
  description: unknown,
  passed: boolean,
  message: string,
): AssertionResult {
  const out: AssertionResult = { type, passed, message };
  if (typeof description === 'string') out.description = description;
  return out;
}

/**
 * Evaluate one assertion. Validates the spec first, so a spec that never went
 * through the suite loader still gets defaults and still cannot throw.
 */
export function evaluateAssertion(spec: AssertionSpec, ctx: AssertionContext): AssertionResult {
  const type = typeOf(spec);
  try {
    const definition = definitionFor(type);
    const normalized = normalizeAssertion(spec);
    if (definition === undefined || !normalized.ok) {
      const issue = normalized.ok ? `unknown assertion type "${type}"` : normalized.issue;
      return makeResult(type, spec.description, false, `assertion error: ${issue}`);
    }
    const rendered = interpolate(definition, normalized.spec, ctx.vars);
    const outcome = definition.evaluate(rendered, ctx);
    const { passed, message } = phrase(outcome, rendered.not === true);
    return makeResult(type, normalized.spec.description, passed, message);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return makeResult(type, spec.description, false, `assertion error: ${reason}`);
  }
}

/** Evaluate every assertion in order. Nothing short-circuits. */
export function evaluateAll(specs: AssertionSpec[], ctx: AssertionContext): AssertionResult[] {
  return specs.map((spec) => evaluateAssertion(spec, ctx));
}

/** Count results. An empty list counts as passed, with a total of 0. */
export function summarizeResults(results: AssertionResult[]): {
  passed: boolean;
  total: number;
  failed: number;
} {
  const failed = results.filter((result) => !result.passed).length;
  return { passed: failed === 0, total: results.length, failed };
}
