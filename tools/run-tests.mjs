#!/usr/bin/env node
/**
 * Zero-dependency test runner for Project VEIL unit test suites.
 * Uses esbuild (already bundled with Vite) to run tests/*.test.ts in Node.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

const rootDir = resolve(import.meta.dirname, '..');
const testsDir = join(rootDir, 'tests');

const testFiles = readdirSync(testsDir)
  .filter((name) => name.endsWith('.test.ts'))
  .sort()
  .map((name) => join(testsDir, name));

if (testFiles.length === 0) {
  console.error('No *.test.ts files found in tests/');
  process.exit(1);
}

const workDir = mkdtempSync(join(tmpdir(), 'project-veil-tests-'));
let failures = 0;

try {
  for (const testFile of testFiles) {
    const label = testFile.slice(rootDir.length + 1);
    const outFile = join(workDir, `${label.replace(/[^a-z0-9]/gi, '_')}.mjs`);
    console.log(`\n=== Running ${label} ===`);
    await build({
      entryPoints: [testFile],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: outFile,
      logLevel: 'silent',
    });
    try {
      execFileSync(process.execPath, [outFile], { stdio: 'inherit' });
    } catch {
      failures += 1;
    }
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\nFAILED: ${failures} of ${testFiles.length} test suite(s) failed.`);
  process.exit(1);
}

console.log(`\nOK: All ${testFiles.length} test suite(s) passed.`);
