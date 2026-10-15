import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AssayError, SuiteError } from '../../src/core/errors.js';
import { loadSuite, parseSuite } from '../../src/core/suite.js';
import type { Suite } from '../../src/core/types.js';

/** Parse text expected to fail, returning the collected issue lines. */
function issuesOf(yamlText: string, sourceName = 'f.yaml'): string[] {
  try {
    parseSuite(yamlText, sourceName);
  } catch (error) {
    if (error instanceof SuiteError) return error.issues;
    throw error;
  }
  throw new Error('expected parseSuite to throw a SuiteError');
}

const VALID = `version: 1
name: full
description: every field exercised
defaults:
  temperature: 0.5
  maxTokens: 64
  timeoutMs: 1000
  retries: 2
providers:
  - id: mock:echo
  - id: mock:fixed
    config:
      response: hello
prompts:
  - id: greet
    system: be brief
    template: 'Hello {{ who }}'
tests:
  - vars:
      who: world
    assert:
      - type: contains
        value: Hello
  - name: explicit
    prompt: greet
    vars:
      who: 42
    assert:
      - type: regex
        pattern: '\\d+'
      - type: max-latency
        value: 10
`;

describe('parseSuite (valid input)', () => {
  it('round-trips a full suite, defaulting missing test names', () => {
    const expected: Suite = {
      version: 1,
      name: 'full',
      description: 'every field exercised',
      providers: [{ id: 'mock:echo' }, { id: 'mock:fixed', config: { response: 'hello' } }],
      prompts: [{ id: 'greet', system: 'be brief', template: 'Hello {{ who }}' }],
      tests: [
        {
          name: 'test-1',
          vars: { who: 'world' },
          assert: [{ type: 'contains', value: 'Hello', caseSensitive: true, not: false }],
        },
        {
          name: 'explicit',
          prompt: 'greet',
          vars: { who: 42 },
          assert: [
            { type: 'regex', pattern: '\\d+', flags: '', not: false },
            { type: 'max-latency', value: 10, not: false },
          ],
        },
      ],
      defaults: { temperature: 0.5, maxTokens: 64, timeoutMs: 1000, retries: 2 },
    };
    expect(parseSuite(VALID)).toEqual(expected);
  });

  it('defaults vars to an empty object', () => {
    const suite = parseSuite(`version: 1
name: s
providers: [{ id: 'mock:echo' }]
prompts: [{ id: p, template: static }]
tests: [{ assert: [{ type: contains, value: x }] }]
`);
    expect(suite.tests[0]?.vars).toEqual({});
  });

  it('does not mutate the input text', () => {
    const text = VALID;
    const copy = `${VALID}`;
    parseSuite(text);
    expect(text).toBe(copy);
  });
});

describe('parseSuite (structural rules)', () => {
  const base = (over: (text: string) => string) =>
    over(`version: 1
name: s
providers:
  - id: mock:echo
prompts:
  - id: p
    template: 'hi {{ name }}'
tests:
  - name: t
    vars:
      name: x
    assert:
      - type: contains
        value: x
`);

  it('rejects a version other than 1', () => {
    expect(issuesOf(base((t) => t.replace('version: 1', 'version: 2')))).toEqual([
      'version: must be 1',
    ]);
  });

  it('rejects an empty providers list', () => {
    expect(
      issuesOf(base((t) => t.replace('providers:\n  - id: mock:echo', 'providers: []'))),
    ).toEqual(['providers: must list at least one provider']);
  });

  it('rejects a provider id that is not kind:model', () => {
    expect(issuesOf(base((t) => t.replace('mock:echo', 'Mock Echo')))).toEqual([
      'providers[0].id: must look like "kind:model", e.g. "mock:echo"',
    ]);
  });

  it('rejects a prompt id with unsafe characters', () => {
    expect(issuesOf(base((t) => t.replace('  - id: p', '  - id: "bad id"')))).toEqual([
      'prompts[0].id: must contain only letters, digits, "_" and "-"',
    ]);
  });

  it('rejects an unknown top-level key', () => {
    expect(issuesOf(base((t) => `${t}banana: 1\n`))).toEqual([
      '(root): Unrecognized key: "banana"',
    ]);
  });

  it('rejects a typo inside a test', () => {
    const issues = issuesOf(base((t) => t.replace('    assert:', '    assrt:')));
    expect(issues).toContain('tests[0]: Unrecognized key: "assrt"');
  });

  it('rejects an empty assert array', () => {
    const issues = issuesOf(
      base((t) =>
        t.replace('    assert:\n      - type: contains\n        value: x\n', '    assert: []\n'),
      ),
    );
    expect(issues).toEqual(['tests[0].assert: must contain at least one assertion']);
  });

  it('rejects an assertion without a type', () => {
    expect(
      issuesOf(
        base((t) => t.replace('      - type: contains\n        value: x', '      - value: x')),
      ),
    ).toEqual(['tests[0].assert[0].type: "type" must be a non-empty string']);
  });

  it('rejects vars that are not a mapping', () => {
    const issues = issuesOf(
      base((t) => t.replace('    vars:\n      name: x\n', '    vars: oops\n')),
    );
    expect(issues).toContain('tests[0].vars: must be a mapping of variable names to scalars');
  });

  it('rejects defaults outside their allowed ranges', () => {
    const issues = issuesOf(
      base(
        (t) => `${t}defaults:
  temperature: 3
  maxTokens: 0
  timeoutMs: -1
  retries: 42
`,
      ),
    );
    expect(issues).toEqual([
      'defaults.temperature: must be between 0 and 2',
      'defaults.maxTokens: must be a positive integer',
      'defaults.timeoutMs: must be a positive integer',
      'defaults.retries: must be between 0 and 10',
    ]);
  });

  it('reports every problem in one pass', () => {
    const issues = issuesOf(`version: 2
name: ''
providers: []
prompts: []
tests: []
`);
    expect(issues).toEqual([
      'version: must be 1',
      'name: must be a non-empty string',
      'providers: must list at least one provider',
      'prompts: must list at least one prompt',
      'tests: must list at least one test',
    ]);
    expect(
      issuesOf(`version: 2
name: ''
providers: []
prompts: []
tests: []
`).length,
    ).toBe(5);
  });

  it('puts the source name and the problem count in the header', () => {
    try {
      parseSuite('version: 2\nname: s\nproviders: []\nprompts: []\ntests: []\n', 'mysuite.yaml');
    } catch (error) {
      expect((error as SuiteError).message).toBe('mysuite.yaml: 4 validation errors');
      return;
    }
    throw new Error('expected a SuiteError');
  });
});

describe('parseSuite (cross-field rules)', () => {
  it('rejects duplicate provider ids', () => {
    expect(
      issuesOf(`version: 1
name: s
providers:
  - id: mock:echo
  - id: mock:echo
prompts: [{ id: p, template: hi }]
tests: [{ name: t, assert: [{ type: contains, value: x }] }]
`),
    ).toEqual(['providers[1]: duplicate provider id "mock:echo"']);
  });

  it('rejects duplicate prompt ids', () => {
    expect(
      issuesOf(`version: 1
name: s
providers: [{ id: 'mock:echo' }]
prompts:
  - id: p
    template: hi
  - id: p
    template: yo
tests: [{ name: t, assert: [{ type: contains, value: x }] }]
`),
    ).toEqual(['prompts[1]: duplicate prompt id "p"']);
  });

  it('rejects duplicate explicit test names', () => {
    expect(
      issuesOf(`version: 1
name: s
providers: [{ id: 'mock:echo' }]
prompts: [{ id: p, template: hi }]
tests:
  - name: t
    assert: [{ type: contains, value: x }]
  - name: t
    assert: [{ type: contains, value: x }]
`),
    ).toEqual(['tests[1]: duplicate test name "t"']);
  });

  it('rejects a defaulted name that collides with an explicit one', () => {
    expect(
      issuesOf(`version: 1
name: s
providers: [{ id: 'mock:echo' }]
prompts: [{ id: p, template: hi }]
tests:
  - assert: [{ type: contains, value: x }]
  - name: test-1
    assert: [{ type: contains, value: x }]
`),
    ).toEqual(['tests[1]: duplicate test name "test-1"']);
  });

  it('rejects a test pinned to a prompt that does not exist', () => {
    expect(
      issuesOf(`version: 1
name: s
providers: [{ id: 'mock:echo' }]
prompts: [{ id: p, template: hi }]
tests:
  - name: t
    prompt: nope
    assert: [{ type: contains, value: x }]
`),
    ).toEqual(['tests[0] "t": no prompt with id "nope"']);
  });

  it('reports a variable missing for the prompt a test is pinned to', () => {
    expect(
      issuesOf(`version: 1
name: s
providers: [{ id: 'mock:echo' }]
prompts: [{ id: p, template: 'hi {{ name }}' }]
tests:
  - name: t
    prompt: p
    assert: [{ type: contains, value: x }]
`),
    ).toEqual(['tests[0] "t" prompt "p": missing variable "name"']);
  });

  it('reports only the prompt that lacks a var when a test applies to all', () => {
    expect(
      issuesOf(`version: 1
name: s
providers: [{ id: 'mock:echo' }]
prompts:
  - id: a
    template: 'x {{ one }}'
  - id: b
    template: 'y {{ two }}'
tests:
  - name: t
    vars: { one: 1 }
    assert: [{ type: contains, value: x }]
`),
    ).toEqual(['tests[0] "t" prompt "b": missing variable "two"']);
  });

  it('reports a malformed prompt template as a suite issue', () => {
    const issues = issuesOf(`version: 1
name: s
providers: [{ id: 'mock:echo' }]
prompts: [{ id: p, template: 'hi {{ name' }]
tests: [{ name: t, assert: [{ type: contains, value: x }] }]
`);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/^prompts\[0\] "p": unclosed "\{\{"/);
  });
});

describe('parseSuite (YAML level)', () => {
  it('reports the line and column of a syntax error', () => {
    const issues = issuesOf('version: 1\nname: s\n  bad: [1,\n');
    expect(issues[0]).toMatch(/^line 2, column 7: /);
  });

  it('rejects a top-level value that is not a mapping', () => {
    expect(issuesOf('just a string')).toEqual(['(root): expected a YAML mapping at the top level']);
  });
});

describe('loadSuite', () => {
  it('reads and validates a suite from disk', async () => {
    const suite = await loadSuite(join(process.cwd(), 'test', 'fixtures', 'valid.yaml'));
    expect(suite.name).toBe('fixture-suite');
    expect(suite.tests).toHaveLength(1);
  });

  it('throws an AssayError naming a path that does not exist', async () => {
    const path = join(process.cwd(), 'test', 'fixtures', 'does-not-exist.yaml');
    await expect(loadSuite(path)).rejects.toThrow(AssayError);
    await expect(loadSuite(path)).rejects.toThrow(/does-not-exist\.yaml/);
  });
});

describe('parseSuite (assertion validation)', () => {
  /** A suite with one test whose single assertion is the given YAML block. */
  const withAssertion = (block: string, vars = '      name: x\n') => `version: 1
name: s
providers:
  - id: mock:echo
prompts:
  - id: p
    template: 'hi {{ name }}'
tests:
  - name: t
    vars:
${vars}    assert:
${block}`;

  it('normalizes assertions in the loaded suite, filling in defaults', () => {
    const suite = parseSuite(withAssertion('      - type: contains\n        value: hi\n'));
    expect(suite.tests[0]?.assert).toEqual([
      { type: 'contains', value: 'hi', caseSensitive: true, not: false },
    ]);
  });

  it('names the known types for an unknown assertion type', () => {
    expect(issuesOf(withAssertion('      - type: foo\n'))).toEqual([
      'tests[0].assert[0]: unknown assertion type "foo" (known: contains, contains-all, ' +
        'contains-any, ends-with, equals, json-schema, json-valid, length, max-cost, ' +
        'max-latency, max-tokens, regex, starts-with)',
    ]);
  });

  it('reports an unknown key inside an assertion with its type', () => {
    expect(
      issuesOf(withAssertion('      - type: contains\n        value: hi\n        valu: hi\n')),
    ).toEqual(['tests[0].assert[0] (contains): Unrecognized key: "valu"']);
  });

  it('reports a field of the wrong type with its type', () => {
    expect(issuesOf(withAssertion('      - type: contains\n        value: 3\n'))).toEqual([
      'tests[0].assert[0] (contains): value: "value" must be a string',
    ]);
  });

  it('reports a regex that does not compile, quoting the engine', () => {
    const issues = issuesOf(withAssertion("      - type: regex\n        pattern: 'a('\n"));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/^tests\[0\]\.assert\[0\] \(regex\): pattern: /);
    expect(issues[0]).toContain('Invalid regular expression');
  });

  it('reports invalid regex flags', () => {
    expect(
      issuesOf(withAssertion("      - type: regex\n        pattern: a\n        flags: 'qq'\n")),
    ).toEqual([
      'tests[0].assert[0] (regex): flags: "flags" must be a subset of "dgimsuvy" with no duplicates',
    ]);
  });

  it('reports a JSON schema Ajv cannot compile', () => {
    const issues = issuesOf(
      withAssertion('      - type: json-schema\n        schema:\n          type: nonsense\n'),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/^tests\[0\]\.assert\[0\] \(json-schema\): schema: /);
    expect(issues[0]).toContain('schema is invalid');
  });

  it('reports a length assertion with no bounds', () => {
    expect(issuesOf(withAssertion('      - type: length\n'))).toEqual([
      'tests[0].assert[0] (length): set "min", "max" or both',
    ]);
  });

  it('reports a length assertion whose min exceeds its max', () => {
    expect(
      issuesOf(withAssertion('      - type: length\n        min: 10\n        max: 2\n')),
    ).toEqual(['tests[0].assert[0] (length): min: "min" must not be greater than "max"']);
  });

  it('reports a variable an assertion needs but the test does not supply', () => {
    expect(
      issuesOf(withAssertion("      - type: contains\n        value: '{{ city }}'\n")),
    ).toEqual(['tests[0] "t" assert[0]: missing variable "city"']);
  });

  it('reports every missing variable of every value', () => {
    expect(
      issuesOf(
        withAssertion("      - type: contains-all\n        values: ['{{ a }}', '{{ b }}']\n"),
      ),
    ).toEqual([
      'tests[0] "t" assert[0]: missing variable "a"',
      'tests[0] "t" assert[0]: missing variable "b"',
    ]);
  });

  it('accepts a variable an assertion needs when the test supplies it', () => {
    const suite = parseSuite(
      withAssertion("      - type: contains\n        value: '{{ name }}'\n"),
    );
    expect(suite.tests[0]?.assert[0]?.value).toBe('{{ name }}');
  });

  it('reports a malformed template inside an assertion value', () => {
    const issues = issuesOf(withAssertion("      - type: equals\n        value: 'hi {{ name'\n"));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/^tests\[0\] "t" assert\[0\]: unclosed "\{\{"/);
  });

  it('does not require variables for a regex pattern or a schema', () => {
    const suite = parseSuite(
      withAssertion(
        "      - type: regex\n        pattern: '{{ nope }}'\n" +
          '      - type: json-schema\n        schema:\n          const: "{{ nope }}"\n',
      ),
    );
    expect(suite.tests[0]?.assert).toHaveLength(2);
  });

  it('reports assertion problems across several tests at once', () => {
    const issues = issuesOf(`version: 1
name: s
providers:
  - id: mock:echo
prompts:
  - id: p
    template: hi
tests:
  - name: one
    assert:
      - type: foo
      - type: contains
        value: '{{ city }}'
  - name: two
    assert:
      - type: length
      - type: max-latency
        value: -5
`);
    expect(issues).toEqual([
      'tests[0].assert[0]: unknown assertion type "foo" (known: contains, contains-all, ' +
        'contains-any, ends-with, equals, json-schema, json-valid, length, max-cost, ' +
        'max-latency, max-tokens, regex, starts-with)',
      'tests[0] "one" assert[1]: missing variable "city"',
      'tests[1].assert[0] (length): set "min", "max" or both',
      'tests[1].assert[1] (max-latency): value: "value" must not be negative',
    ]);
  });

  it('reports structural problems before per-type ones', () => {
    // `tests` is not an array, so no assertion is reached at all.
    expect(
      issuesOf(`version: 1
name: s
providers:
  - id: mock:echo
prompts:
  - id: p
    template: hi
tests: nope
`),
    ).toEqual(['tests: must be an array of tests']);
  });
});
