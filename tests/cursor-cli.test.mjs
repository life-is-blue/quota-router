import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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

function listSavedMd(dir) {
  return fs.readdirSync(dir).filter((name) => name.endsWith('.md'));
}

function extractFencedBody(content) {
  const start = content.indexOf('````\n');
  const end = content.lastIndexOf('\n````');
  assert.ok(start >= 0 && end > start, 'four-backtick fence must wrap result');
  return content.slice(start + '````\n'.length, end);
}

describe('cursor-cli G1 save + G2 resume', () => {
  it('G1.1 success: injects tmpdir, writes 0600 file with frontmatter, fence, and Saved: line', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qr-cursor-save-'));
    try {
      const result = await runCli(['research', 'explain git rebase'], {
        CURSOR_AGENT_BIN: FAKE_CURSOR_BIN,
        FAKE_CURSOR_SCENARIO: 'SUCCESS',
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
      assert.match(content, /^---\nengine: cursor\n/);
      assert.match(content, /^timestamp: /m);
      assert.match(content, /^session_id: fake-session-success-001$/m);
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
    const blocker = path.join(os.tmpdir(), `qr-cursor-not-dir-${Date.now()}`);
    fs.writeFileSync(blocker, 'not a directory');
    try {
      const result = await runCli(['research', 'explain git rebase'], {
        CURSOR_AGENT_BIN: FAKE_CURSOR_BIN,
        FAKE_CURSOR_SCENARIO: 'SUCCESS',
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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qr-cursor-nosave-'));
    try {
      const result = await runCli(['research', 'explain git rebase'], {
        CURSOR_AGENT_BIN: FAKE_CURSOR_BIN,
        FAKE_CURSOR_SCENARIO: 'SUCCESS',
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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qr-cursor-fence-'));
    try {
      const result = await runCli(['research', 'show a snippet'], {
        CURSOR_AGENT_BIN: FAKE_CURSOR_BIN,
        FAKE_CURSOR_SCENARIO: 'CODE_FENCE',
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

  it('G2.1 argv includes --resume and --mode ask', async () => {
    const argvFile = path.join(os.tmpdir(), `qr-cursor-argv-${Date.now()}.json`);
    const prev = process.env.FAKE_CURSOR_SCENARIO;
    const prevFile = process.env.FAKE_CURSOR_ARGV_FILE;
    process.env.FAKE_CURSOR_SCENARIO = 'RESUME_ECHO_ID';
    process.env.FAKE_CURSOR_ARGV_FILE = argvFile;
    try {
      await runCursorResearch('topic', {
        agentBin: FAKE_CURSOR_BIN,
        resumeId: 'sess-keep-001',
        timeoutMs: 5000,
      });
      const argv = JSON.parse(fs.readFileSync(argvFile, 'utf8'));
      assert.ok(argv.includes('--resume'));
      assert.equal(argv[argv.indexOf('--resume') + 1], 'sess-keep-001');
      assert.ok(argv.includes('--mode'));
      assert.equal(argv[argv.indexOf('--mode') + 1], 'ask');
      assert.ok(argv.includes('--output-format'));
    } finally {
      if (prev === undefined) delete process.env.FAKE_CURSOR_SCENARIO;
      else process.env.FAKE_CURSOR_SCENARIO = prev;
      if (prevFile === undefined) delete process.env.FAKE_CURSOR_ARGV_FILE;
      else process.env.FAKE_CURSOR_ARGV_FILE = prevFile;
      fs.rmSync(argvFile, { force: true });
    }
  });

  it('G2.2 id mismatch rejects with 上下文未延续', async () => {
    const prev = process.env.FAKE_CURSOR_SCENARIO;
    process.env.FAKE_CURSOR_SCENARIO = 'RESUME_NEW_ID';
    try {
      await assert.rejects(
        () =>
          runCursorResearch('continue', {
            agentBin: FAKE_CURSOR_BIN,
            resumeId: 'requested-session-id',
            timeoutMs: 5000,
          }),
        (err) => {
          assert.match(err.message, /上下文未延续/);
          assert.match(err.message, /silent-new-session-999/);
          return true;
        }
      );
    } finally {
      if (prev === undefined) delete process.env.FAKE_CURSOR_SCENARIO;
      else process.env.FAKE_CURSOR_SCENARIO = prev;
    }
  });

  it('G2.3 resume equals/dashdash parse; literal --resume in prompt is not a flag', async () => {
    const argvEquals = path.join(os.tmpdir(), `qr-cursor-eq-${Date.now()}.json`);
    const argvDash = path.join(os.tmpdir(), `qr-cursor-dash-${Date.now()}.json`);
    const argvLiteral = path.join(os.tmpdir(), `qr-cursor-lit-${Date.now()}.json`);
    try {
      const eq = await runCli(['research', '--resume=abc', '好'], {
        CURSOR_AGENT_BIN: FAKE_CURSOR_BIN,
        FAKE_CURSOR_SCENARIO: 'RESUME_ECHO_ID',
        FAKE_CURSOR_ARGV_FILE: argvEquals,
      });
      assert.equal(eq.code, 0);
      const eqArgv = JSON.parse(fs.readFileSync(argvEquals, 'utf8'));
      assert.equal(eqArgv[eqArgv.indexOf('--resume') + 1], 'abc');
      assert.equal(eqArgv[eqArgv.indexOf('-p') + 1], '好');

      const dash = await runCli(['research', '--resume', 'abc', '--', '带空格', '的prompt'], {
        CURSOR_AGENT_BIN: FAKE_CURSOR_BIN,
        FAKE_CURSOR_SCENARIO: 'RESUME_ECHO_ID',
        FAKE_CURSOR_ARGV_FILE: argvDash,
      });
      assert.equal(dash.code, 0);
      const dashArgv = JSON.parse(fs.readFileSync(argvDash, 'utf8'));
      assert.equal(dashArgv[dashArgv.indexOf('--resume') + 1], 'abc');
      assert.equal(dashArgv[dashArgv.indexOf('-p') + 1], '带空格 的prompt');

      const lit = await runCli(['research', '请解释', '--resume', '的含义'], {
        CURSOR_AGENT_BIN: FAKE_CURSOR_BIN,
        FAKE_CURSOR_SCENARIO: 'SUCCESS',
        FAKE_CURSOR_ARGV_FILE: argvLiteral,
      });
      assert.equal(lit.code, 0);
      const litArgv = JSON.parse(fs.readFileSync(argvLiteral, 'utf8'));
      assert.ok(!litArgv.includes('--resume'));
      assert.equal(litArgv[litArgv.indexOf('-p') + 1], '请解释 --resume 的含义');
    } finally {
      fs.rmSync(argvEquals, { force: true });
      fs.rmSync(argvDash, { force: true });
      fs.rmSync(argvLiteral, { force: true });
    }
  });

  it('G2.4 QUOTA_RESUME_ID env channel (slash-command structured entry)', async () => {
    const argvFile = path.join(os.tmpdir(), `qr-cursor-envch-${Date.now()}.json`);
    try {
      const result = await runCli(['research', 'follow up question'], {
        CURSOR_AGENT_BIN: FAKE_CURSOR_BIN,
        FAKE_CURSOR_SCENARIO: 'RESUME_ECHO_ID',
        FAKE_CURSOR_ARGV_FILE: argvFile,
        QUOTA_RESUME_ID: 'env-channel-id-42',
      });
      assert.equal(result.code, 0);
      const argv = JSON.parse(fs.readFileSync(argvFile, 'utf8'));
      assert.equal(argv[argv.indexOf('--resume') + 1], 'env-channel-id-42');
      assert.equal(argv[argv.indexOf('-p') + 1], 'follow up question');
      // Security flags must still ride along on the resumed call.
      assert.ok(argv.includes('--mode') && argv[argv.indexOf('--mode') + 1] === 'ask');
    } finally {
      fs.rmSync(argvFile, { force: true });
    }
  });

  it('G1.5 unicode prompt is stored in frontmatter', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qr-cursor-uni-'));
    try {
      const result = await runCli(['research', '什么是 rebase'], {
        CURSOR_AGENT_BIN: FAKE_CURSOR_BIN,
        FAKE_CURSOR_SCENARIO: 'SUCCESS',
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
