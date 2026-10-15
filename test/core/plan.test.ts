import { describe, expect, it } from 'vitest';
import { AssayError } from '../../src/core/errors.js';
import { plan } from '../../src/core/plan.js';
import { parseSuite } from '../../src/core/suite.js';
import type { Suite } from '../../src/core/types.js';

const MATRIX = `version: 1
name: matrix
providers:
  - id: mock:echo
  - id: mock:fail
prompts:
  - id: alpha
    template: 'A {{ v }}'
  - id: beta
    template: 'B {{ v }}'
tests:
  - name: both
    vars: { v: 1 }
    assert: [{ type: contains }]
  - name: pinned
    prompt: beta
    vars: { v: 2 }
    assert: [{ type: contains }]
`;

describe('plan', () => {
  it('orders cases by test, then prompt, then provider', () => {
    const cases = plan(parseSuite(MATRIX));
    expect(cases.map((planned) => planned.caseId)).toEqual([
      'both::alpha::mock:echo',
      'both::alpha::mock:fail',
      'both::beta::mock:echo',
      'both::beta::mock:fail',
      'pinned::beta::mock:echo',
      'pinned::beta::mock:fail',
    ]);
  });

  it('only produces cases for the prompt a test is pinned to', () => {
    const cases = plan(parseSuite(MATRIX)).filter((planned) => planned.test.name === 'pinned');
    expect(cases).toHaveLength(2);
    expect(new Set(cases.map((planned) => planned.prompt.id))).toEqual(new Set(['beta']));
  });

  it('counts tests x applicable prompts x providers', () => {
    // "both" applies to 2 prompts, "pinned" to 1; 2 providers each.
    expect(plan(parseSuite(MATRIX))).toHaveLength((2 + 1) * 2);
  });

  it('renders the prompt with the test vars', () => {
    const cases = plan(parseSuite(MATRIX));
    expect(cases[0]?.renderedPrompt).toBe('A 1');
    expect(cases[4]?.renderedPrompt).toBe('B 2');
  });

  it('carries the provider, prompt and test through to the case', () => {
    const first = plan(parseSuite(MATRIX))[0];
    expect(first?.provider.id).toBe('mock:echo');
    expect(first?.prompt.id).toBe('alpha');
    expect(first?.test.name).toBe('both');
  });

  it('throws when a test pins a prompt that does not exist', () => {
    const suite: Suite = {
      version: 1,
      name: 'broken',
      providers: [{ id: 'mock:echo' }],
      prompts: [{ id: 'alpha', template: 'A' }],
      tests: [{ name: 't', prompt: 'missing', vars: {}, assert: [{ type: 'contains' }] }],
    };
    expect(() => plan(suite)).toThrow(AssayError);
  });

  it('throws when two cases would share an id', () => {
    const suite: Suite = {
      version: 1,
      name: 'dupes',
      providers: [{ id: 'mock:echo' }, { id: 'mock:echo' }],
      prompts: [{ id: 'alpha', template: 'A' }],
      tests: [{ name: 't', vars: {}, assert: [{ type: 'contains' }] }],
    };
    expect(() => plan(suite)).toThrow(/duplicate case id/);
  });
});
