#!/usr/bin/env node
import { run } from './cli-run.js';

// Writing to a closed pipe (`assay plan suite.yaml | head`) is not an error.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code !== 'EPIPE') throw error;
});

process.exitCode = await run(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  cwd: process.cwd(),
});
