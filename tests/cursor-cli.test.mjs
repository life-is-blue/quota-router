import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCursorResearch } from '../plugins/cursor/scripts/cursor-cli.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLI_SCRIPT = path.resolve(__dirname, '../plugins/cursor/scripts/cursor-cli.mjs');
const FAKE_CURSOR_BIN = path.resolve(__dirname, 'fixtures/fake-cursor-bin.mjs');

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

describe('cursor-cli adapter', () => {
  it('1. SUCCESS scenario returns result text from JSON result field', async () => {
    const result = await runCli(['research', 'explain git rebase'], {
      CURSOR_AGENT_BIN: FAKE_CURSOR_BIN,
      FAKE_CURSOR_SCENARIO: 'SUCCESS',
    });

    assert.equal(result.code, 0, 'Exit code should be 0 on SUCCESS');
    assert.match(
      result.stdout,
      /Git rebase reapplies commits on top of another base branch/,
      'Stdout must contain agent result text'
    );
  });

  it('2. HARD_FAIL uses empty-stdout branch (not JSON.parse)', async () => {
    const result = await runCli(['research', 'bad request'], {
      CURSOR_AGENT_BIN: FAKE_CURSOR_BIN,
      FAKE_CURSOR_SCENARIO: 'HARD_FAIL',
    });

    assert.notEqual(result.code, 0, 'Exit code should be non-zero on hard fail');
    assert.match(
      result.combined,
      /no stdout|authentication failed|invalid model/i,
      'Must report empty-stdout failure path with stderr content'
    );
    assert.doesNotMatch(
      result.combined,
      /Failed to parse agent JSON/i,
      'Must NOT go through JSON.parse branch when stdout is empty'
    );
  });

  it('3. SLEEP scenario is terminated by setTimeout+kill within expected time', async () => {
    const testTimeoutMs = 500;
    const start = Date.now();
    const result = await runCli(['research', 'hang forever'], {
      CURSOR_AGENT_BIN: FAKE_CURSOR_BIN,
      FAKE_CURSOR_SCENARIO: 'SLEEP',
      FAKE_CURSOR_SLEEP_MS: '60000',
      CURSOR_TIMEOUT_MS: String(testTimeoutMs),
    });
    const elapsed = Date.now() - start;

    assert.notEqual(result.code, 0, 'Timeout must fail with non-zero exit');
    assert.match(result.combined, /timed out/i, 'Must report timeout');
    // Allow generous margin for scheduling; must finish well under the fake sleep.
    assert.ok(
      elapsed < 10000,
      `setTimeout+kill must terminate hung process quickly, took ${elapsed}ms`
    );
    assert.ok(
      elapsed >= testTimeoutMs,
      `Should wait at least timeout (${testTimeoutMs}ms), took ${elapsed}ms`
    );
  });

  it('4. BLOCKED_RESULT extracts warning when result contains blocked keyword', async () => {
    const result = await runCli(['research', 'try write'], {
      CURSOR_AGENT_BIN: FAKE_CURSOR_BIN,
      FAKE_CURSOR_SCENARIO: 'BLOCKED_RESULT',
    });

    assert.equal(result.code, 0, 'Soft-deny style result still succeeds');
    assert.match(result.stdout, /blocked/i, 'Stdout still contains result text');
    assert.match(
      result.combined,
      /Warning.*incomplete|blocked\|rejected\|denied/i,
      'Must surface warning for blocked|rejected|denied in result'
    );
  });

  it('5. HUGE_STDERR: ≥5000-char stderr truncated in Error.message (<3000)', async () => {
    const prev = process.env.FAKE_CURSOR_SCENARIO;
    process.env.FAKE_CURSOR_SCENARIO = 'HUGE_STDERR';
    try {
      await assert.rejects(
        () =>
          runCursorResearch('huge stderr', {
            agentBin: FAKE_CURSOR_BIN,
            timeoutMs: 10000,
          }),
        (err) => {
          assert.ok(
            err.message.length < 3000,
            `Error.message length ${err.message.length} must be < 3000`
          );
          return true;
        }
      );
    } finally {
      if (prev === undefined) delete process.env.FAKE_CURSOR_SCENARIO;
      else process.env.FAKE_CURSOR_SCENARIO = prev;
    }
  });
});
