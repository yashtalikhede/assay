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
