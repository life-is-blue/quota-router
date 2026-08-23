import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJob, writeJob } from '../plugins/agy/scripts/job-store.mjs';

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

  it('5. --background returns immediately (<2s) and spawns worker', async () => {
    const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-bg-test-'));
    try {
      const startTime = Date.now();
      const result = await runCli(['research', '--background', 'explain git rebase'], {
        CLAUDE_PLUGIN_DATA: testDataDir,
        AGY_BIN: FAKE_AGY_BIN,
        FAKE_AGY_SCENARIO: 'SUCCESS',
      });
      const elapsedMs = Date.now() - startTime;

      assert.equal(result.code, 0, 'Exit code should be 0 on background spawn');
      assert.ok(elapsedMs < 2000, `Background launch must return quickly (<2s), took ${elapsedMs}ms`);

      const uuidMatch = result.stdout.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      assert.ok(uuidMatch, 'Output must include a valid job UUID');
      const jobId = uuidMatch[0];

      // Wait for the background worker to finish writing the done record
      process.env.CLAUDE_PLUGIN_DATA = testDataDir;
      let finishedJob = null;
      for (let i = 0; i < 40; i++) {
        const current = readJob(jobId);
        if (current && (current.status === 'done' || current.status === 'error')) {
          finishedJob = current;
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      delete process.env.CLAUDE_PLUGIN_DATA;

      assert.ok(finishedJob, 'Worker must finish and record done status');
      assert.equal(finishedJob.status, 'done');
      assert.match(
        finishedJob.response,
        /Git rebase reapplies commits on top of another base branch/
      );
    } finally {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  it('6. status command displays done job details', async () => {
    const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-status-test-'));
    try {
      process.env.CLAUDE_PLUGIN_DATA = testDataDir;
      const job = {
        id: 'job-status-done-001',
        prompt: 'test status done',
        status: 'done',
        pid: 12345,
        conversationId: 'fake-conv-done',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        response: 'All tasks completed successfully.',
        error: null,
      };
      writeJob(job);
      delete process.env.CLAUDE_PLUGIN_DATA;

      const result = await runCli(['status', 'job-status-done-001'], {
        CLAUDE_PLUGIN_DATA: testDataDir,
      });

      assert.equal(result.code, 0);
      assert.match(result.stdout, /Status: done/);
      assert.match(result.stdout, /All tasks completed successfully\./);
    } finally {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  it('7. status command reports non-existent job ID with error without crashing', async () => {
    const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-status-err-'));
    try {
      const result = await runCli(['status', 'non-existent-id-999'], {
        CLAUDE_PLUGIN_DATA: testDataDir,
      });

      assert.notEqual(result.code, 0, 'Exit code should be non-zero on non-existent job ID');
      assert.match(result.combined, /not found/i);
    } finally {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  it('8. status command detects dead worker process for running job', async () => {
    const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-dead-test-'));
    try {
      process.env.CLAUDE_PLUGIN_DATA = testDataDir;
      const deadPid = 9999999;
      const job = {
        id: 'job-dead-worker-002',
        prompt: 'test dead process',
        status: 'running',
        pid: deadPid,
        conversationId: null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        response: null,
        error: null,
      };
      writeJob(job);
      delete process.env.CLAUDE_PLUGIN_DATA;

      const result = await runCli(['status', 'job-dead-worker-002'], {
        CLAUDE_PLUGIN_DATA: testDataDir,
      });

      assert.equal(result.code, 0);
      assert.match(result.stdout, /进程已消失，状态未知/);

      // Verify list format also shows this annotation
      const listResult = await runCli(['status'], {
        CLAUDE_PLUGIN_DATA: testDataDir,
      });
      assert.equal(listResult.code, 0);
      assert.match(listResult.stdout, /进程已消失，状态未知/);
    } finally {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });
});
