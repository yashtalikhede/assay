/**
 * The planner: expands a validated suite into the concrete cases a run
 * executes, in a deterministic order so runs can be diffed.
 */

import { AssayError } from './errors.js';
import { render } from './template.js';
import type { PlannedCase, PromptSpec, Suite, TestSpec } from './types.js';

/** The prompts a test applies to: its pinned prompt, or every prompt. */
function promptsFor(suite: Suite, test: TestSpec): PromptSpec[] {
  if (test.prompt === undefined) return suite.prompts;
  const pinned = suite.prompts.filter((prompt) => prompt.id === test.prompt);
  if (pinned.length === 0) {
    throw new AssayError(`test "${test.name}" refers to unknown prompt "${test.prompt}"`);
  }
  return pinned;
}

/**
 * Expand a suite into planned cases: tests in file order, then applicable
 * prompts in file order, then providers in file order.
 */
export function plan(suite: Suite): PlannedCase[] {
  const cases: PlannedCase[] = [];
  const seen = new Set<string>();

  for (const test of suite.tests) {
    for (const prompt of promptsFor(suite, test)) {
      for (const provider of suite.providers) {
        const caseId = `${test.name}::${prompt.id}::${provider.id}`;
        if (seen.has(caseId)) {
          throw new AssayError(`duplicate case id "${caseId}": case ids must be unique`);
        }
        seen.add(caseId);
        cases.push({
          caseId,
          provider,
          prompt,
          test,
          renderedPrompt: render(prompt.template, test.vars),
        });
      }
    }
  }

  return cases;
}
