import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../src/cli-run.js';
import type { CliIo } from '../src/cli-run.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** An io object that collects everything written to it. */
function makeIo(): CliIo & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    cwd: ROOT,
    stdout: {
      write(s: string) {
        out.push(s);
      },
    },
    stderr: {
      write(s: string) {
        err.push(s);
      },
    },
  };
}

describe('assay validate', () => {
  it('summarises the example suite', async () => {
    const io = makeIo();
    expect(await run(['validate', 'examples/basic.yaml'], io)).toBe(0);
    expect(io.out.join('')).toBe('OK basic-demo: 4 tests, 2 prompts, 3 providers, 21 cases\n');
    expect(io.err).toEqual([]);
  });

  it('prints a header and indented issues for an invalid suite', async () => {
    const io = makeIo();
    expect(await run(['validate', 'test/fixtures/invalid.yaml'], io)).toBe(1);
    const lines = io.err.join('').trimEnd().split('\n');
    expect(lines[0]).toBe(`${resolve(ROOT, 'test/fixtures/invalid.yaml')}: 2 validation errors`);
    expect(lines.slice(1)).toEqual([
      '  version: must be 1',
      '  providers: must list at least one provider',
    ]);
    expect(io.out).toEqual([]);
  });

  it('returns 1 for a file that does not exist', async () => {
    const io = makeIo();
    expect(await run(['validate', 'examples/nope.yaml'], io)).toBe(1);
    expect(io.err.join('')).toMatch(/^error: cannot read suite file .*nope\.yaml/);
  });
});

describe('assay plan', () => {
  it('prints one case id per line', async () => {
    const io = makeIo();
    expect(await run(['plan', 'examples/basic.yaml'], io)).toBe(0);
    const lines = io.out.join('').trimEnd().split('\n');
    expect(lines).toHaveLength(21);
    expect(lines[0]).toBe('caching-note::summarize::mock:echo');
    for (const line of lines) expect(line).toMatch(/^[^:]+::[^:]+::[a-z][a-z0-9-]*:\S+$/);
  });

  it('reports suite errors the same way as validate', async () => {
    const io = makeIo();
    expect(await run(['plan', 'test/fixtures/invalid.yaml'], io)).toBe(1);
    expect(io.err.join('')).toMatch(/invalid\.yaml: 2 validation errors\n {2}version: must be 1\n/);
  });
});

describe('assay usage', () => {
  it('prints usage listing both commands for --help', async () => {
    const io = makeIo();
    expect(await run(['--help'], io)).toBe(0);
    const text = io.out.join('');
    expect(text).toMatch(/assay validate <file>/);
    expect(text).toMatch(/assay plan <file>/);
  });

  it('accepts -h as well', async () => {
    const io = makeIo();
    expect(await run(['-h'], io)).toBe(0);
  });

  it('returns 2 and prints usage when no command is given', async () => {
    const io = makeIo();
    expect(await run([], io)).toBe(2);
    expect(io.err.join('')).toMatch(/assay validate <file>/);
    expect(io.out).toEqual([]);
  });

  it('returns 2 for an unknown command', async () => {
    const io = makeIo();
    expect(await run(['frobnicate'], io)).toBe(2);
    expect(io.err.join('')).toMatch(/^error: unknown command "frobnicate"/);
  });

  it('returns 2 when the file argument is missing', async () => {
    const io = makeIo();
    expect(await run(['validate'], io)).toBe(2);
    expect(io.err.join('')).toMatch(/^error: "validate" needs a suite file argument/);
  });

  it('returns 2 for an unknown option', async () => {
    const io = makeIo();
    expect(await run(['--nope'], io)).toBe(2);
    expect(io.err.join('')).toMatch(/^error: /);
  });
});

describe('assay check', () => {
  const SUITE = 'test/fixtures/check-suite.yaml';

  it('prints a line per assertion and returns 0 when all pass', async () => {
    const io = makeIo();
    const code = await run(
      ['check', SUITE, '--test', 'interpolated', '--output', 'Paris is lovely'],
      io,
    );
    expect(code).toBe(0);
    expect(io.out.join('')).toBe(
      'PASS (names the city) contains "Paris"\nPASS NOT contains "Berlin"\n2/2 assertions passed\n',
    );
    expect(io.err).toEqual([]);
  });

  it('returns 1 and names the failures on a mixed run', async () => {
    const io = makeIo();
    const code = await run(
      ['check', SUITE, '--test', 'interpolated', '--output', 'Berlin is lovely'],
      io,
    );
    expect(code).toBe(1);
    expect(io.out.join('')).toBe(
      'FAIL (names the city) expected output to contain "Paris", found "Berlin is lovely"\n' +
        'FAIL expected output NOT to contain "Berlin"\n' +
        '0/2 assertions passed\n',
    );
  });

  it('defaults latency to 0 and leaves cost and tokens unmeasured', async () => {
    const io = makeIo();
    const code = await run(['check', SUITE, '--test', 'budgets', '--output', 'x'], io);
    expect(code).toBe(1);
    expect(io.out.join('')).toBe(
      'PASS latency 0ms <= 100ms\nFAIL cost unavailable\nFAIL output tokens unavailable\n' +
        '1/3 assertions passed\n',
    );
  });

  it('passes the measurements from the flags to the assertions', async () => {
    const io = makeIo();
    const code = await run(
      [
        'check',
        SUITE,
        '--test',
        'budgets',
        '--output',
        'x',
        '--latency',
        '42',
        '--cost',
        '0.002',
        '--tokens',
        '7',
      ],
      io,
    );
    expect(code).toBe(0);
    expect(io.out.join('')).toBe(
      'PASS latency 42ms <= 100ms\nPASS cost $0.002 <= $0.01\nPASS output tokens 7 <= 50\n' +
        '3/3 assertions passed\n',
    );
  });

  it('reads the output from a file', async () => {
    const io = makeIo();
    const code = await run(
      ['check', SUITE, '--test', 'interpolated', '--output-file', 'test/fixtures/output.txt'],
      io,
    );
    expect(code).toBe(0);
    expect(io.out.join('')).toMatch(/^PASS \(names the city\) contains "Paris"\n/);
  });

  it('returns 1 when the output file does not exist', async () => {
    const io = makeIo();
    const code = await run(
      ['check', SUITE, '--test', 'interpolated', '--output-file', 'test/fixtures/nope.txt'],
      io,
    );
    expect(code).toBe(1);
    expect(io.err.join('')).toMatch(/^error: cannot read output file .*nope\.txt/);
  });

  it('returns 1 and lists the test names when the test is unknown', async () => {
    const io = makeIo();
    const code = await run(['check', SUITE, '--test', 'nope', '--output', 'x'], io);
    expect(code).toBe(1);
    expect(io.err.join('')).toBe(
      'error: no test named "nope" in suite "check-fixture"; tests are: interpolated, budgets\n',
    );
  });

  it('returns 2 when both output flags are given', async () => {
    const io = makeIo();
    const code = await run(
      ['check', SUITE, '--test', 'interpolated', '--output', 'x', '--output-file', 'y'],
      io,
    );
    expect(code).toBe(2);
    expect(io.err.join('')).toMatch(
      /^error: "check" needs exactly one of --output or --output-file/,
    );
  });

  it('returns 2 when neither output flag is given', async () => {
    const io = makeIo();
    const code = await run(['check', SUITE, '--test', 'interpolated'], io);
    expect(code).toBe(2);
    expect(io.err.join('')).toMatch(
      /^error: "check" needs exactly one of --output or --output-file/,
    );
  });

  it('returns 2 when --test is missing', async () => {
    const io = makeIo();
    const code = await run(['check', SUITE, '--output', 'x'], io);
    expect(code).toBe(2);
    expect(io.err.join('')).toMatch(/^error: "check" needs --test <name>/);
  });

  it('returns 2 when the file argument is missing', async () => {
    const io = makeIo();
    expect(await run(['check'], io)).toBe(2);
    expect(io.err.join('')).toMatch(/^error: "check" needs a suite file argument/);
  });

  const badNumbers: [string, string, string][] = [
    ['--latency', 'abc', '--latency must be a non-negative number, got "abc"'],
    ['--latency=-1', '', '--latency must be a non-negative number, got "-1"'],
    ['--cost', 'free', '--cost must be a non-negative number, got "free"'],
    ['--tokens', '1.5', '--tokens must be an integer, got "1.5"'],
    ['--tokens=', '', '--tokens must be a non-negative number, got ""'],
  ];

  it.each(badNumbers)('returns 2 for %s %s', async (flag, value, reason) => {
    const io = makeIo();
    // An empty value means the flag already carries its argument as --flag=value,
    // which is how a negative number has to be passed to parseArgs.
    const args = value === '' ? [flag] : [flag, value];
    const code = await run(['check', SUITE, '--test', 'budgets', '--output', 'x', ...args], io);
    expect(code).toBe(2);
    expect(io.err.join('')).toContain(`error: ${reason}`);
  });

  it('reports suite errors the same way as validate', async () => {
    const io = makeIo();
    const code = await run(
      ['check', 'test/fixtures/invalid.yaml', '--test', 't', '--output', 'x'],
      io,
    );
    expect(code).toBe(1);
    expect(io.err.join('')).toMatch(/invalid\.yaml: 2 validation errors\n/);
  });

  it('is listed in the help text', async () => {
    const io = makeIo();
    expect(await run(['--help'], io)).toBe(0);
    expect(io.out.join('')).toMatch(/assay check <file>/);
    expect(io.out.join('')).toMatch(/--output-file/);
  });
});
