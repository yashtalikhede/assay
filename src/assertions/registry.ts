/** The table of known assertion types. */

import type { AssertionDefinition } from './definition.js';
import { jsonDefinitions } from './json.js';
import { numericDefinitions } from './numeric.js';
import { regexDefinitions } from './regex.js';
import { textDefinitions } from './text.js';

const definitions = new Map<string, AssertionDefinition>(
  [...textDefinitions, ...regexDefinitions, ...jsonDefinitions, ...numericDefinitions].map(
    (definition) => [definition.type, definition],
  ),
);

/** The definition for a type, or undefined when the type is unknown. */
export function definitionFor(type: string): AssertionDefinition | undefined {
  return definitions.get(type);
}

/** Every known assertion type, sorted. */
export function knownTypes(): string[] {
  return [...definitions.keys()].sort();
}
