import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  resolveJobsDir,
  writeJob,
  readJob,
  listJobs,
  isProcessAlive,
  formatJobStatus,
  getJobFilePath,
} from '../plugins/agy/scripts/job-store.mjs';

describe('job-store layer', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-test-'));
    process.env.CLAUDE_PLUGIN_DATA = tempDir;
  });

  afterEach(() => {
    delete process.env.CLAUDE_PLUGIN_DATA;
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('1. resolveJobsDir falls back to tmpdir when CLAUDE_PLUGIN_DATA is unset', () => {
    delete process.env.CLAUDE_PLUGIN_DATA;
    const dir = resolveJobsDir();
    assert.match(dir, /quota-router-agy\/jobs/);
    assert.equal(fs.existsSync(dir), true);
  });

  it('2. writeJob and readJob store and retrieve job records with identical fields', () => {
    const job = {
      id: 'job-123-abc',
      prompt: 'Explain memory management in V8',
      status: 'running',
      pid: 12345,
      conversationId: 'conv-999',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      response: null,
      error: null,
    };

    const written = writeJob(job);
    assert.deepEqual(written, job);

    const retrieved = readJob('job-123-abc');
    assert.deepEqual(retrieved, job);
  });

  it('3. readJob on non-existent job ID returns null without throwing', () => {
    const result = readJob('non-existent-job-id');
    assert.equal(result, null);
  });

  it('4. listJobs lists all jobs sorted by startedAt descending', () => {
    const job1 = {
      id: 'job-1',
      prompt: 'Prompt 1',
      status: 'done',
      pid: 101,
      conversationId: null,
      startedAt: '2026-08-24T00:00:00.000Z',
      finishedAt: '2026-08-24T00:00:05.000Z',
      response: 'Done 1',
      error: null,
    };
    const job2 = {
      id: 'job-2',
      prompt: 'Prompt 2',
      status: 'done',
      pid: 102,
      conversationId: null,
      startedAt: '2026-08-24T00:05:00.000Z',
      finishedAt: '2026-08-24T00:05:05.000Z',
      response: 'Done 2',
      error: null,
    };

    writeJob(job1);
    writeJob(job2);

    const jobs = listJobs();
    assert.equal(jobs.length, 2);
    assert.equal(jobs[0].id, 'job-2', 'Newest job should appear first');
    assert.equal(jobs[1].id, 'job-1');
  });

  it('5. isProcessAlive and formatJobStatus identify dead process for running job', () => {
    // PID 9999999 is extraordinarily unlikely to exist
    const deadPid = 9999999;
    assert.equal(isProcessAlive(deadPid), false);

    const deadRunningJob = {
      id: 'job-dead-1',
      prompt: 'Dead worker job',
      status: 'running',
      pid: deadPid,
      conversationId: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      response: null,
      error: null,
    };

    const statusText = formatJobStatus(deadRunningJob);
    assert.match(statusText, /running \(进程已消失，状态未知\)/);
  });

  it('6. writeJob throws error on invalid status', () => {
    const invalidJob = {
      id: 'job-invalid-status',
      prompt: 'test',
      status: 'invalid_status',
    };
    assert.throws(() => writeJob(invalidJob), /Invalid job status/);
  });

  it('7. writeJob throws error when read-back verification fails due to file discrepancy', () => {
    const originalWriteFileSync = fs.writeFileSync;
    try {
      // Simulate silent truncation/corruption during write
      fs.writeFileSync = (filePath, content, encoding) => {
        originalWriteFileSync(filePath, '{"corrupted": true}', encoding);
      };

      const job = {
        id: 'job-corrupt-test',
        prompt: 'test verify',
        status: 'running',
        pid: 1234,
        conversationId: null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        response: null,
        error: null,
      };

      assert.throws(
        () => writeJob(job),
        /writeJob verification failed for job job-corrupt-test/
      );
    } finally {
      fs.writeFileSync = originalWriteFileSync;
    }
  });
});
