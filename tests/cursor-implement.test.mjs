import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  runCursorImplement,
  runCursorResearch,
} from '../plugins/cursor/scripts/cursor-cli.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FAKE_IMPLEMENT_BIN = path.resolve(
  __dirname,
  'fixtures/fake-cursor-implement-bin.mjs'
);
const FAKE_CURSOR_BIN = path.resolve(__dirname, 'fixtures/fake-cursor-bin.mjs');

describe('cursor-implement adapter', () => {
  function withEnv(extra, fn) {
    const prev = {};
    for (const key of Object.keys(extra)) {
      prev[key] = process.env[key];
      if (extra[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = extra[key];
      }
    }
    return Promise.resolve()
      .then(fn)
      .finally(() => {
        for (const key of Object.keys(extra)) {
          if (prev[key] === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = prev[key];
          }
        }
      });
  }

  it('1. SUCCESS: normal envelope resolves with empty warnings', async () => {
    await withEnv({ FAKE_CURSOR_IMPLEMENT_SCENARIO: 'SUCCESS' }, async () => {
      const result = await runCursorImplement('update add to three params', {
        agentBin: FAKE_IMPLEMENT_BIN,
        timeoutMs: 5000,
      });
      assert.equal(result.status, 'SUCCESS');
      assert.match(result.result, /three parameters|add\(a, b, c/i);
      assert.ok(Array.isArray(result.warnings));
      assert.equal(result.warnings.length, 0, 'warnings must be empty on clean success');
      assert.ok(result.session_id);
      assert.ok(result.usage);
      assert.ok(result.raw);
    });
  });

  it('2. HARD_FAIL: Workspace Trust reject → reject with stderr content', async () => {
    await withEnv({ FAKE_CURSOR_IMPLEMENT_SCENARIO: 'HARD_FAIL' }, async () => {
      await assert.rejects(
        () =>
          runCursorImplement('write something', {
            agentBin: FAKE_IMPLEMENT_BIN,
            timeoutMs: 5000,
          }),
        (err) => {
          assert.match(String(err.message), /Workspace Trust Required|no stdout/i);
          assert.match(String(err.message), /--trust|--yolo|-f/i);
          return true;
        }
      );
    });
  });

  it('3. PARTIAL_SUCCESS: 未能实际执行 → resolve with non-empty warnings, result kept', async () => {
    await withEnv(
      { FAKE_CURSOR_IMPLEMENT_SCENARIO: 'PARTIAL_SUCCESS' },
      async () => {
        const result = await runCursorImplement(
          'run node -e and append output',
          {
            agentBin: FAKE_IMPLEMENT_BIN,
            timeoutMs: 5000,
          }
        );
        assert.equal(result.status, 'SUCCESS', 'partial success must not reject');
        assert.match(result.result, /未能实际执行/);
        assert.ok(
          result.warnings.length > 0,
          'warnings must be non-empty for partial success trap'
        );
        assert.match(result.warnings.join('\n'), /partial success|未能实际执行|被拒绝/i);
      }
    );
  });

  it('4. ARGS: must include --trust; must NOT include --mode/--force/--yolo/-y', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-implement-argv-'));
    const argvFile = path.join(tmpDir, 'argv.json');
    try {
      await withEnv(
        {
          FAKE_CURSOR_IMPLEMENT_SCENARIO: 'SUCCESS',
          FAKE_CURSOR_ARGV_FILE: argvFile,
        },
        async () => {
          await runCursorImplement('noop edit', {
            agentBin: FAKE_IMPLEMENT_BIN,
            timeoutMs: 5000,
          });
        }
      );
      const argv = JSON.parse(fs.readFileSync(argvFile, 'utf8'));
      assert.ok(argv.includes('--trust'), `argv must include --trust: ${JSON.stringify(argv)}`);
      assert.ok(!argv.includes('--mode'), `argv must not include --mode: ${JSON.stringify(argv)}`);
      assert.ok(!argv.includes('ask'), `argv must not include ask mode: ${JSON.stringify(argv)}`);
      assert.ok(!argv.includes('--force'), `argv must not include --force: ${JSON.stringify(argv)}`);
      assert.ok(!argv.includes('--yolo'), `argv must not include --yolo: ${JSON.stringify(argv)}`);
      assert.ok(!argv.includes('-y'), `argv must not include -y: ${JSON.stringify(argv)}`);
      assert.ok(!argv.includes('-f'), `argv must not include -f: ${JSON.stringify(argv)}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('5. TIMEOUT: sleep 60s with 500ms timeout is killed within 10s', async () => {
    await withEnv(
      {
        FAKE_CURSOR_IMPLEMENT_SCENARIO: 'SLEEP',
        FAKE_CURSOR_SLEEP_MS: '60000',
      },
      async () => {
        const start = Date.now();
        await assert.rejects(
          () =>
            runCursorImplement('hang', {
              agentBin: FAKE_IMPLEMENT_BIN,
              timeoutMs: 500,
            }),
          /timed out/i
        );
        const elapsed = Date.now() - start;
        assert.ok(elapsed < 10000, `must kill within 10s, took ${elapsed}ms`);
        assert.ok(elapsed >= 500, `must wait at least timeout, took ${elapsed}ms`);
      }
    );
  });

  it('6. RESEARCH regression: runCursorResearch still works (ask mode path intact)', async () => {
    await withEnv({ FAKE_CURSOR_SCENARIO: 'SUCCESS' }, async () => {
      delete process.env.FAKE_CURSOR_IMPLEMENT_SCENARIO;
      const result = await runCursorResearch('explain git rebase', {
        agentBin: FAKE_CURSOR_BIN,
        timeoutMs: 5000,
      });
      assert.equal(result.status, 'SUCCESS');
      assert.match(
        result.result,
        /Git rebase reapplies commits on top of another base branch/
      );
      assert.equal(result.warnings.length, 0);
    });
  });
});
