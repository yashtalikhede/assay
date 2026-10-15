/**
 * The assay template engine: `{{ name }}` placeholders with flat variable
 * lookup. No nesting, no expressions, no filters and no escape syntax.
 */

import { TemplateError } from './errors.js';
import type { Scalar } from './types.js';

/** Variable names accepted inside a `{{ ... }}` placeholder. */
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

const OPEN = '{{';
const CLOSE = '}}';

/** A literal run of text, or a resolved variable reference. */
type Token = { kind: 'text'; value: string } | { kind: 'var'; name: string };

/**
 * Split a template into literal and variable tokens, throwing TemplateError on
 * any malformed placeholder.
 */
function tokenize(template: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < template.length) {
    const open = template.indexOf(OPEN, index);
    if (open === -1) {
      tokens.push({ kind: 'text', value: template.slice(index) });
      break;
    }
    if (open > index) tokens.push({ kind: 'text', value: template.slice(index, open) });

    const close = template.indexOf(CLOSE, open + OPEN.length);
    if (close === -1) {
      throw new TemplateError(
        `unclosed "${OPEN}" at position ${open}: every placeholder must end with "${CLOSE}"`,
      );
    }

    const raw = template.slice(open + OPEN.length, close);
    const name = raw.trim();
    if (name === '') {
      throw new TemplateError(`empty placeholder "${OPEN}${raw}${CLOSE}" at position ${open}`);
    }
    if (!NAME_PATTERN.test(name)) {
      throw new TemplateError(
        `invalid variable name "${name}" at position ${open}: names must match ${String(NAME_PATTERN)}`,
      );
    }

    tokens.push({ kind: 'var', name });
    index = close + CLOSE.length;
  }

  return tokens;
}

/**
 * The unique variable names a template references, in order of first
 * appearance. Throws TemplateError if the template is malformed.
 */
export function variablesOf(template: string): string[] {
  const seen = new Set<string>();
  for (const token of tokenize(template)) {
    if (token.kind === 'var') seen.add(token.name);
  }
  return [...seen];
}

/**
 * Render a template, converting values with String(). Throws TemplateError
 * listing every missing variable, or on a malformed placeholder. Extra
 * variables are ignored.
 */
export function render(template: string, vars: Record<string, Scalar>): string {
  const tokens = tokenize(template);

  const missing = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== 'var') continue;
    if (!Object.hasOwn(vars, token.name) || vars[token.name] === undefined) {
      missing.add(token.name);
    }
  }
  if (missing.size > 0) {
    const names = [...missing].sort();
    throw new TemplateError(`missing template variable(s): ${names.join(', ')}`, names);
  }

  let out = '';
  for (const token of tokens) {
    out += token.kind === 'text' ? token.value : String(vars[token.name]);
  }
  return out;
}
