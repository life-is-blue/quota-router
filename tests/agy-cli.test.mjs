import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLI_SCRIPT = path.resolve(__dirname, '../plugins/agy/scripts/agy-cli.mjs');
const FAKE_AGY_BIN = path.resolve(__dirname, 'fixtures/fake-agy-bin.mjs');

function runCli(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_SCRIPT, ...args], {
      env: {
        ...process.env,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });

    child.on('close', (code) => {
      resolve({
        code,
        stdout,
        stderr,
        combined: `${stdout}\n${stderr}`,
      });
    });
  });
}

describe('agy-cli adapter', () => {
  it('1. SUCCESS scenario returns response cleanly with status SUCCESS', async () => {
    const result = await runCli(['research', 'explain git rebase'], {
      AGY_BIN: FAKE_AGY_BIN,
      FAKE_AGY_SCENARIO: 'SUCCESS',
    });

    assert.equal(result.code, 0, 'Exit code should be 0 on SUCCESS');
    assert.match(
      result.stdout,
      /Git rebase reapplies commits on top of another base branch/,
      'Stdout must contain agy response'
    );
    assert.equal(result.stderr, '', 'Stderr should be empty for normal SUCCESS');
  });

  it('2. ERROR scenario fails with non-zero exit code and reports error', async () => {
    const result = await runCli(['research', 'explain git rebase'], {
      AGY_BIN: FAKE_AGY_BIN,
      FAKE_AGY_SCENARIO: 'ERROR',
    });

    assert.notEqual(result.code, 0, 'Exit code should be non-zero on ERROR');
    assert.match(
      result.combined,
      /invalid model selection|model is not recognized|ERROR/i,
      'Output must contain error description from agy'
    );
  });

  it('3. SOFT_DENY scenario passes warning to user-visible output and finishes successfully', async () => {
    const result = await runCli(['research', 'read something'], {
      AGY_BIN: FAKE_AGY_BIN,
      FAKE_AGY_SCENARIO: 'SOFT_DENY',
    });

    assert.equal(result.code, 0, 'Exit code should be 0 for soft-deny with SUCCESS status');
    assert.match(
      result.stdout,
      /Research completed with read-only fallback/,
      'Stdout must contain response content'
    );
    assert.match(
      result.combined,
      /denied|not allowed/i,
      'User-visible output must retain the soft-deny warning and not swallow it'
    );
  });

  it('4. ENOENT scenario handles missing agy executable gracefully', async () => {
    const nonExistentBin = path.resolve(__dirname, 'fixtures/non-existent-agy-bin-12345');
    const result = await runCli(['research', 'test prompt'], {
      AGY_BIN: nonExistentBin,
    });

    assert.notEqual(result.code, 0, 'Exit code should be non-zero on ENOENT');
    assert.match(
      result.combined,
      /not found|ENOENT/i,
      'Output must clearly report that agy was not found'
    );
  });
});
