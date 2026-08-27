import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCodebuddyResearch } from '../plugins/codebuddy/scripts/codebuddy-cli.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLI_SCRIPT = path.resolve(__dirname, '../plugins/codebuddy/scripts/codebuddy-cli.mjs');
const FAKE_CODEBUDDY_BIN = path.resolve(__dirname, 'fixtures/fake-codebuddy-bin.mjs');

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

describe('codebuddy-cli adapter', () => {
  it('1. SUCCESS: result element NOT at array end is still found (not length-1)', async () => {
    const result = await runCli(['research', 'explain git rebase'], {
      CODEBUDDY_BIN: FAKE_CODEBUDDY_BIN,
      FAKE_CODEBUDDY_SCENARIO: 'SUCCESS_NOT_LAST',
    });

    assert.equal(result.code, 0, 'Exit code should be 0 on SUCCESS');
    assert.match(
      result.stdout,
      /Git rebase reapplies commits on top of another base branch/,
      'Stdout must contain result text even though result element is not last'
    );
  });

  it('2. EXIT0_EMPTY_STDOUT: API failure (exit 0 + empty stdout) must be judged as failure', async () => {
    const result = await runCli(['research', 'unknown model'], {
      CODEBUDDY_BIN: FAKE_CODEBUDDY_BIN,
      FAKE_CODEBUDDY_SCENARIO: 'EMPTY_STDOUT_EXIT0',
    });

    assert.notEqual(result.code, 0, 'Exit code must be non-zero on this failure');
    assert.match(
      result.combined,
      /不是合法 JSON|失败|400/i,
      'Must report failure, not green-light exit 0 with empty stdout'
    );
    assert.doesNotMatch(
      result.combined,
      /^SUCCESS$/m,
      'Must NOT report SUCCESS for exit 0 + empty stdout'
    );
  });

  it('3. OBJECT_NOT_ARRAY: valid JSON object must be judged as failure without crashing', async () => {
    const result = await runCli(['research', 'object shape'], {
      CODEBUDDY_BIN: FAKE_CODEBUDDY_BIN,
      FAKE_CODEBUDDY_SCENARIO: 'OBJECT_NOT_ARRAY',
    });

    assert.notEqual(result.code, 0, 'Exit code must be non-zero for non-array JSON');
    assert.match(
      result.combined,
      /不是 JSON 数组|数组|失败/i,
      'Must report that array contract was violated'
    );
    assert.doesNotMatch(
      result.combined,
      /TypeError|Cannot read properties of undefined/,
      'Must not crash on undefined result access'
    );
  });

  it('4. ARRAY_NO_RESULT: valid array without type:"result" must be judged as failure', async () => {
    const result = await runCli(['research', 'no result element'], {
      CODEBUDDY_BIN: FAKE_CODEBUDDY_BIN,
      FAKE_CODEBUDDY_SCENARIO: 'ARRAY_NO_RESULT',
    });

    assert.notEqual(result.code, 0, 'Exit code must be non-zero when no result element');
    assert.match(
      result.combined,
      /没有 type:"result"|失败/i,
      'Must report missing type:"result" element'
    );
    assert.doesNotMatch(
      result.combined,
      /TypeError|Cannot read properties of undefined/,
      'Must not crash on undefined result access'
    );
  });

  it('5. CHINESE_DENIED: Chinese refusal keyword in result extracts warning', async () => {
    const result = await runCli(['research', 'read a file'], {
      CODEBUDDY_BIN: FAKE_CODEBUDDY_BIN,
      FAKE_CODEBUDDY_SCENARIO: 'CHINESE_DENIED',
    });

    assert.equal(result.code, 0, 'Refusal-in-text style result still succeeds at process level');
    assert.match(result.stdout, /该权限被拒绝/, 'Stdout still contains result text');
    assert.match(
      result.combined,
      /Warning.*不完整|被拒绝/,
      'Must surface warning for Chinese refusal keywords in result'
    );
  });

  it('6. SLEEP: hung process is terminated by setTimeout+kill within expected time', async () => {
    const testTimeoutMs = 500;
    const start = Date.now();
    const result = await runCli(['research', 'hang forever'], {
      CODEBUDDY_BIN: FAKE_CODEBUDDY_BIN,
      FAKE_CODEBUDDY_SCENARIO: 'SLEEP',
      FAKE_CODEBUDDY_SLEEP_MS: '60000',
      CODEBUDDY_TIMEOUT_MS: String(testTimeoutMs),
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

  it('7. HUGE_BAD_JSON: ≥5000-byte bad JSON truncates Error.message (<3000)', async () => {
    const prev = process.env.FAKE_CODEBUDDY_SCENARIO;
    process.env.FAKE_CODEBUDDY_SCENARIO = 'HUGE_BAD_JSON';
    try {
      await assert.rejects(
        () =>
          runCodebuddyResearch('huge bad json', {
            codebuddyBin: FAKE_CODEBUDDY_BIN,
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
      if (prev === undefined) delete process.env.FAKE_CODEBUDDY_SCENARIO;
      else process.env.FAKE_CODEBUDDY_SCENARIO = prev;
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

describe('codebuddy-cli G1 save + G2 resume', () => {
  it('G1.1 success: injects tmpdir, writes 0600 file with frontmatter, fence, and Saved: line', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qr-cb-save-'));
    try {
      const result = await runCli(['research', 'explain git rebase'], {
        CODEBUDDY_BIN: FAKE_CODEBUDDY_BIN,
        FAKE_CODEBUDDY_SCENARIO: 'SUCCESS_NOT_LAST',
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
      assert.match(content, /^---\nengine: codebuddy\n/);
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
    const blocker = path.join(os.tmpdir(), `qr-cb-not-dir-${Date.now()}`);
    fs.writeFileSync(blocker, 'not a directory');
    try {
      const result = await runCli(['research', 'explain git rebase'], {
        CODEBUDDY_BIN: FAKE_CODEBUDDY_BIN,
        FAKE_CODEBUDDY_SCENARIO: 'SUCCESS_NOT_LAST',
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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qr-cb-nosave-'));
    try {
      const result = await runCli(['research', 'explain git rebase'], {
        CODEBUDDY_BIN: FAKE_CODEBUDDY_BIN,
        FAKE_CODEBUDDY_SCENARIO: 'SUCCESS_NOT_LAST',
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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qr-cb-fence-'));
    try {
      const result = await runCli(['research', 'show a snippet'], {
        CODEBUDDY_BIN: FAKE_CODEBUDDY_BIN,
        FAKE_CODEBUDDY_SCENARIO: 'CODE_FENCE',
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

  it('G2.1 argv includes --resume, dontAsk, and --tools', async () => {
    const argvFile = path.join(os.tmpdir(), `qr-cb-argv-${Date.now()}.json`);
    const prev = process.env.FAKE_CODEBUDDY_SCENARIO;
    const prevFile = process.env.FAKE_CODEBUDDY_ARGV_FILE;
    process.env.FAKE_CODEBUDDY_SCENARIO = 'RESUME_ECHO_ID';
    process.env.FAKE_CODEBUDDY_ARGV_FILE = argvFile;
    try {
      await runCodebuddyResearch('topic', {
        codebuddyBin: FAKE_CODEBUDDY_BIN,
        resumeId: 'sess-keep-001',
        timeoutMs: 5000,
      });
      const argv = JSON.parse(fs.readFileSync(argvFile, 'utf8'));
      assert.ok(argv.includes('--resume'));
      assert.equal(argv[argv.indexOf('--resume') + 1], 'sess-keep-001');
      assert.ok(argv.includes('--permission-mode'));
      assert.equal(argv[argv.indexOf('--permission-mode') + 1], 'dontAsk');
      assert.ok(argv.includes('--tools'));
      assert.equal(argv[argv.indexOf('--tools') + 1], 'Read,Glob,Grep');
    } finally {
      if (prev === undefined) delete process.env.FAKE_CODEBUDDY_SCENARIO;
      else process.env.FAKE_CODEBUDDY_SCENARIO = prev;
      if (prevFile === undefined) delete process.env.FAKE_CODEBUDDY_ARGV_FILE;
      else process.env.FAKE_CODEBUDDY_ARGV_FILE = prevFile;
      fs.rmSync(argvFile, { force: true });
    }
  });

  it('G2.2 id mismatch rejects with 上下文未延续', async () => {
    const prev = process.env.FAKE_CODEBUDDY_SCENARIO;
    process.env.FAKE_CODEBUDDY_SCENARIO = 'RESUME_NEW_ID';
    try {
      await assert.rejects(
        () =>
          runCodebuddyResearch('continue', {
            codebuddyBin: FAKE_CODEBUDDY_BIN,
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
      if (prev === undefined) delete process.env.FAKE_CODEBUDDY_SCENARIO;
      else process.env.FAKE_CODEBUDDY_SCENARIO = prev;
    }
  });

  it('G2.3 resume equals/dashdash parse; literal --resume in prompt is not a flag', async () => {
    const argvEquals = path.join(os.tmpdir(), `qr-cb-eq-${Date.now()}.json`);
    const argvDash = path.join(os.tmpdir(), `qr-cb-dash-${Date.now()}.json`);
    const argvLiteral = path.join(os.tmpdir(), `qr-cb-lit-${Date.now()}.json`);
    try {
      const eq = await runCli(['research', '--resume=abc', '好'], {
        CODEBUDDY_BIN: FAKE_CODEBUDDY_BIN,
        FAKE_CODEBUDDY_SCENARIO: 'RESUME_ECHO_ID',
        FAKE_CODEBUDDY_ARGV_FILE: argvEquals,
      });
      assert.equal(eq.code, 0);
      const eqArgv = JSON.parse(fs.readFileSync(argvEquals, 'utf8'));
      assert.equal(eqArgv[eqArgv.indexOf('--resume') + 1], 'abc');
      assert.equal(eqArgv[eqArgv.indexOf('-p') + 1], '好');

      const dash = await runCli(['research', '--resume', 'abc', '--', '带空格', '的prompt'], {
        CODEBUDDY_BIN: FAKE_CODEBUDDY_BIN,
        FAKE_CODEBUDDY_SCENARIO: 'RESUME_ECHO_ID',
        FAKE_CODEBUDDY_ARGV_FILE: argvDash,
      });
      assert.equal(dash.code, 0);
      const dashArgv = JSON.parse(fs.readFileSync(argvDash, 'utf8'));
      assert.equal(dashArgv[dashArgv.indexOf('--resume') + 1], 'abc');
      assert.equal(dashArgv[dashArgv.indexOf('-p') + 1], '带空格 的prompt');

      const lit = await runCli(['research', '请解释', '--resume', '的含义'], {
        CODEBUDDY_BIN: FAKE_CODEBUDDY_BIN,
        FAKE_CODEBUDDY_SCENARIO: 'SUCCESS_NOT_LAST',
        FAKE_CODEBUDDY_ARGV_FILE: argvLiteral,
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

  it('G2.4 empty stdout + No conversation found is a failure', async () => {
    const result = await runCli(['research', '--resume', 'dead-beef-id', 'continue'], {
      CODEBUDDY_BIN: FAKE_CODEBUDDY_BIN,
      FAKE_CODEBUDDY_SCENARIO: 'NO_CONVERSATION',
    });
    assert.notEqual(result.code, 0);
    assert.match(result.combined, /No conversation found/);
    assert.match(result.combined, /不是合法 JSON|失败/i);
  });
});
