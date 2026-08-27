import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJob, writeJob } from '../plugins/agy/scripts/job-store.mjs';
import { runAgyResearch } from '../plugins/agy/scripts/agy-cli.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLI_SCRIPT = path.resolve(__dirname, '../plugins/agy/scripts/agy-cli.mjs');
const FAKE_AGY_BIN = path.resolve(__dirname, 'fixtures/fake-agy-bin.mjs');

function runCli(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_SCRIPT, ...args], {
      env: {
        ...process.env,
        QUOTA_ROUTER_NO_SAVE: '1',
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

  it('9. HUGE_STDERR: ≥5000-char stderr is truncated in Error.message (<3000)', async () => {
    const prev = process.env.FAKE_AGY_SCENARIO;
    process.env.FAKE_AGY_SCENARIO = 'HUGE_STDERR';
    try {
      await assert.rejects(
        () => runAgyResearch('huge stderr', { agyBin: FAKE_AGY_BIN }),
        (err) => {
          assert.ok(
            err.message.length < 3000,
            `Error.message length ${err.message.length} must be < 3000`
          );
          return true;
        }
      );
    } finally {
      if (prev === undefined) delete process.env.FAKE_AGY_SCENARIO;
      else process.env.FAKE_AGY_SCENARIO = prev;
    }
  });
});

function listSavedMd(dir) {
  return fs.readdirSync(dir).filter((name) => name.endsWith('.md'));
}

function extractFencedBody(content) {
  const start = content.indexOf('````\n');
  const end = content.lastIndexOf('\n````');
  assert.ok(start >= 0 && end > start, 'four-backtick fence must wrap result');
  return content.slice(start + '````\n'.length, end);
}

describe('agy-cli G1 save + G2 resume', () => {
  it('G1.1 success: injects tmpdir, writes 0600 file with frontmatter, fence, and Saved: line', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qr-agy-save-'));
    try {
      const result = await runCli(['research', 'explain git rebase'], {
        AGY_BIN: FAKE_AGY_BIN,
        FAKE_AGY_SCENARIO: 'SUCCESS',
        QUOTA_ROUTER_RESULTS_DIR: dir,
        QUOTA_ROUTER_NO_SAVE: '0',
      });
      assert.equal(result.code, 0);
      assert.match(result.stdout, /Git rebase reapplies commits/);
      assert.match(result.stdout, /^Saved: /m);
      const files = listSavedMd(dir);
      assert.equal(files.length, 1);
      assert.match(files[0], /^\d{8}T\d{6}Z-[0-9a-f]{8}\.md$/);
      const filePath = path.join(dir, files[0]);
      assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
      assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
      const content = fs.readFileSync(filePath, 'utf8');
      assert.match(content, /^---\nengine: agy\n/);
      assert.match(content, /^timestamp: /m);
      assert.match(content, /^session_id: fake-conv-success-001$/m);
      assert.match(content, /^prompt: /m);
      assert.equal(
        extractFencedBody(content),
        'Git rebase reapplies commits on top of another base branch.'
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('G1.2 save failure: result still printed, stderr warning, exit 0', async () => {
    const blocker = path.join(os.tmpdir(), `qr-agy-not-dir-${Date.now()}`);
    fs.writeFileSync(blocker, 'not a directory');
    try {
      const result = await runCli(['research', 'explain git rebase'], {
        AGY_BIN: FAKE_AGY_BIN,
        FAKE_AGY_SCENARIO: 'SUCCESS',
        QUOTA_ROUTER_RESULTS_DIR: blocker,
        QUOTA_ROUTER_NO_SAVE: '0',
      });
      assert.equal(result.code, 0, 'save failure must not fail the research');
      assert.match(result.stdout, /Git rebase reapplies commits/);
      assert.doesNotMatch(result.stdout, /^Saved: /m);
      assert.match(result.stderr, /Warning: failed to save research result/i);
    } finally {
      fs.unlinkSync(blocker);
    }
  });

  it('G1.3 QUOTA_ROUTER_NO_SAVE=1 writes no files', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qr-agy-nosave-'));
    try {
      const result = await runCli(['research', 'explain git rebase'], {
        AGY_BIN: FAKE_AGY_BIN,
        FAKE_AGY_SCENARIO: 'SUCCESS',
        QUOTA_ROUTER_RESULTS_DIR: dir,
        QUOTA_ROUTER_NO_SAVE: '1',
      });
      assert.equal(result.code, 0);
      assert.match(result.stdout, /Git rebase reapplies commits/);
      assert.doesNotMatch(result.stdout, /^Saved: /m);
      assert.equal(listSavedMd(dir).length, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('G1.4 fence collision: result with triple backticks still round-trips', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qr-agy-fence-'));
    try {
      const result = await runCli(['research', 'show a snippet'], {
        AGY_BIN: FAKE_AGY_BIN,
        FAKE_AGY_SCENARIO: 'CODE_FENCE',
        QUOTA_ROUTER_RESULTS_DIR: dir,
        QUOTA_ROUTER_NO_SAVE: '0',
      });
      assert.equal(result.code, 0);
      const files = listSavedMd(dir);
      assert.equal(files.length, 1);
      const content = fs.readFileSync(path.join(dir, files[0]), 'utf8');
      assert.equal(
        extractFencedBody(content),
        'Example with fence:\n```js\nconst x = 1;\n```\nend.'
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('G2.1 argv includes --conversation and native timeout flags', async () => {
    const argvFile = path.join(os.tmpdir(), `qr-agy-argv-${Date.now()}.json`);
    const prev = process.env.FAKE_AGY_SCENARIO;
    const prevFile = process.env.FAKE_AGY_ARGV_FILE;
    process.env.FAKE_AGY_SCENARIO = 'RESUME_ECHO_ID';
    process.env.FAKE_AGY_ARGV_FILE = argvFile;
    try {
      await runAgyResearch('topic', {
        agyBin: FAKE_AGY_BIN,
        resumeId: 'conv-keep-001',
      });
      const argv = JSON.parse(fs.readFileSync(argvFile, 'utf8'));
      assert.ok(argv.includes('--conversation'));
      assert.equal(argv[argv.indexOf('--conversation') + 1], 'conv-keep-001');
      assert.ok(argv.includes('--output-format'));
      assert.ok(argv.includes('--print-timeout'));
      assert.ok(argv.includes('-p'));
    } finally {
      if (prev === undefined) delete process.env.FAKE_AGY_SCENARIO;
      else process.env.FAKE_AGY_SCENARIO = prev;
      if (prevFile === undefined) delete process.env.FAKE_AGY_ARGV_FILE;
      else process.env.FAKE_AGY_ARGV_FILE = prevFile;
      fs.rmSync(argvFile, { force: true });
    }
  });

  it('G2.2 id mismatch rejects with 上下文未延续', async () => {
    const prev = process.env.FAKE_AGY_SCENARIO;
    process.env.FAKE_AGY_SCENARIO = 'RESUME_NEW_ID';
    try {
      await assert.rejects(
        () =>
          runAgyResearch('continue', {
            agyBin: FAKE_AGY_BIN,
            resumeId: 'requested-session-id',
          }),
        (err) => {
          assert.match(err.message, /上下文未延续/);
          assert.match(err.message, /silent-new-session-999/);
          return true;
        }
      );
    } finally {
      if (prev === undefined) delete process.env.FAKE_AGY_SCENARIO;
      else process.env.FAKE_AGY_SCENARIO = prev;
    }
  });

  it('G2.3 resume equals/dashdash parse; literal --resume in prompt is not a flag', async () => {
    const argvEquals = path.join(os.tmpdir(), `qr-agy-eq-${Date.now()}.json`);
    const argvDash = path.join(os.tmpdir(), `qr-agy-dash-${Date.now()}.json`);
    const argvLiteral = path.join(os.tmpdir(), `qr-agy-lit-${Date.now()}.json`);
    try {
      const eq = await runCli(['research', '--resume=abc', '好'], {
        AGY_BIN: FAKE_AGY_BIN,
        FAKE_AGY_SCENARIO: 'RESUME_ECHO_ID',
        FAKE_AGY_ARGV_FILE: argvEquals,
      });
      assert.equal(eq.code, 0);
      const eqArgv = JSON.parse(fs.readFileSync(argvEquals, 'utf8'));
      assert.equal(eqArgv[eqArgv.indexOf('--conversation') + 1], 'abc');
      assert.equal(eqArgv[eqArgv.indexOf('-p') + 1], '好');

      const dash = await runCli(['research', '--resume', 'abc', '--', '带空格', '的prompt'], {
        AGY_BIN: FAKE_AGY_BIN,
        FAKE_AGY_SCENARIO: 'RESUME_ECHO_ID',
        FAKE_AGY_ARGV_FILE: argvDash,
      });
      assert.equal(dash.code, 0);
      const dashArgv = JSON.parse(fs.readFileSync(argvDash, 'utf8'));
      assert.equal(dashArgv[dashArgv.indexOf('--conversation') + 1], 'abc');
      assert.equal(dashArgv[dashArgv.indexOf('-p') + 1], '带空格 的prompt');

      const lit = await runCli(['research', '请解释', '--resume', '的含义'], {
        AGY_BIN: FAKE_AGY_BIN,
        FAKE_AGY_SCENARIO: 'SUCCESS',
        FAKE_AGY_ARGV_FILE: argvLiteral,
      });
      assert.equal(lit.code, 0);
      const litArgv = JSON.parse(fs.readFileSync(argvLiteral, 'utf8'));
      assert.ok(!litArgv.includes('--conversation'));
      assert.equal(litArgv[litArgv.indexOf('-p') + 1], '请解释 --resume 的含义');
    } finally {
      fs.rmSync(argvEquals, { force: true });
      fs.rmSync(argvDash, { force: true });
      fs.rmSync(argvLiteral, { force: true });
    }
  });

  it('G1.5 unicode prompt is stored in frontmatter', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qr-agy-uni-'));
    try {
      const result = await runCli(['research', '什么是 rebase'], {
        AGY_BIN: FAKE_AGY_BIN,
        FAKE_AGY_SCENARIO: 'SUCCESS',
        QUOTA_ROUTER_RESULTS_DIR: dir,
        QUOTA_ROUTER_NO_SAVE: '0',
      });
      assert.equal(result.code, 0);
      const files = listSavedMd(dir);
      const content = fs.readFileSync(path.join(dir, files[0]), 'utf8');
      assert.match(content, /什么是 rebase/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
