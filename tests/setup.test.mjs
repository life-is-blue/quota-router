import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runSetupCheck } from '../plugins/router/scripts/setup.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FAKE_DIR = path.resolve(__dirname, 'fixtures/fake-engines');
const SETUP_SCRIPT = path.resolve(
  __dirname,
  '../plugins/router/scripts/setup.mjs'
);

const FAKE_BINS = {
  agy: path.join(FAKE_DIR, 'agy'),
  cursor: path.join(FAKE_DIR, 'agent'),
  codebuddy: path.join(FAKE_DIR, 'codebuddy'),
  codex: path.join(FAKE_DIR, 'codex'),
};

const SLEEP_BIN = path.join(FAKE_DIR, 'sleep-bin');
const SLEEP_IGNORE_TERM_BIN = path.join(FAKE_DIR, 'sleep-ignore-term');

/** Shared argv log for the whole suite — whitelist guard reads this. */
const ARGV_LOG = path.join(
  os.tmpdir(),
  `quota-setup-codebuddy-argv-${process.pid}.log`
);

function readArgvLog() {
  if (!fs.existsSync(ARGV_LOG)) return [];
  return fs
    .readFileSync(ARGV_LOG, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function runSetupCli() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SETUP_SCRIPT], {
      env: { ...process.env },
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
      resolve({ code, stdout, stderr });
    });
  });
}

before(() => {
  process.env.FAKE_CODEBUDDY_ARGV_LOG = ARGV_LOG;
  try {
    fs.unlinkSync(ARGV_LOG);
  } catch {
    // ok
  }
});

after(() => {
  try {
    fs.unlinkSync(ARGV_LOG);
  } catch {
    // ok
  }
  delete process.env.FAKE_CODEBUDDY_ARGV_LOG;
});

describe('setup readiness check', () => {
  it('1. all four engines installed: versions parsed, cursor logged-in', async () => {
    const rows = await runSetupCheck({
      bins: FAKE_BINS,
      timeoutMs: 5000,
    });

    assert.equal(rows.length, 4);
    const byEngine = Object.fromEntries(rows.map((r) => [r.engine, r]));

    assert.equal(byEngine.agy.installed, true);
    assert.equal(byEngine.agy.version, '9.9.9-fake-agy');
    assert.equal(byEngine.agy.login, 'unknown');

    assert.equal(byEngine.cursor.installed, true);
    assert.equal(byEngine.cursor.version, '2026.08.11-fake');
    assert.equal(byEngine.cursor.login, 'logged-in');

    assert.equal(byEngine.codebuddy.installed, true);
    assert.equal(byEngine.codebuddy.version, '2.137.1-fake');
    assert.equal(byEngine.codebuddy.login, 'unknown');

    assert.equal(byEngine.codex.installed, true);
    assert.equal(byEngine.codex.version, '0.149.0-fake');
    assert.equal(byEngine.codex.login, 'logged-in');
  });

  it('2. ENOENT for one engine → installed:false; others intact; CLI exit 0', async () => {
    const rows = await runSetupCheck({
      bins: {
        ...FAKE_BINS,
        agy: path.join(FAKE_DIR, 'does-not-exist-agy'),
      },
      timeoutMs: 5000,
    });

    const byEngine = Object.fromEntries(rows.map((r) => [r.engine, r]));
    assert.equal(byEngine.agy.installed, false);
    assert.equal(byEngine.agy.version, null);
    assert.match(byEngine.agy.detail, /not installed|not found/i);

    assert.equal(byEngine.cursor.installed, true);
    assert.equal(byEngine.codebuddy.installed, true);
    assert.equal(byEngine.codex.installed, true);

    const cli = await runSetupCli();
    assert.equal(cli.code, 0, 'CLI must always exit 0');
  });

  it('3. version probe timeout → mark failed, no hang, others ok', async () => {
    const started = Date.now();
    const rows = await runSetupCheck({
      bins: {
        ...FAKE_BINS,
        codebuddy: SLEEP_BIN,
      },
      timeoutMs: 500,
    });
    const elapsed = Date.now() - started;

    assert.ok(
      elapsed < 8000,
      `must not hang on timeout (elapsed ${elapsed}ms)`
    );

    const byEngine = Object.fromEntries(rows.map((r) => [r.engine, r]));
    assert.equal(byEngine.codebuddy.installed, false);
    assert.match(byEngine.codebuddy.detail, /timed out/i);

    assert.equal(byEngine.agy.installed, true);
    assert.equal(byEngine.cursor.installed, true);
    assert.equal(byEngine.codex.installed, true);
  });

  it('3b. SIGTERM-ignoring process is killed by SIGKILL escalation', async () => {
    // sleep-ignore-term traps SIGTERM; only the second-stage SIGKILL can
    // stop it. If the SIGKILL timer is ever removed from setup.mjs, this
    // test hangs (and the suite timeout catches it) — proving the
    // escalation chain's second stage actually fires.
    const started = Date.now();
    const rows = await runSetupCheck({
      bins: {
        ...FAKE_BINS,
        codebuddy: SLEEP_IGNORE_TERM_BIN,
      },
      timeoutMs: 500,
    });
    const elapsed = Date.now() - started;

    assert.ok(
      elapsed < 8000,
      `SIGKILL escalation must terminate a SIGTERM-ignoring process (elapsed ${elapsed}ms)`
    );

    const byEngine = Object.fromEntries(rows.map((r) => [r.engine, r]));
    assert.equal(byEngine.codebuddy.installed, false);
    assert.match(byEngine.codebuddy.detail, /timed out/i);
  });

  it('4. whitelist guard: codebuddy argv only ever --version', async () => {
    // Re-drive checks so this test owns a known argv window, then assert
    // every recorded invocation is exactly ["--version"].
    try {
      fs.unlinkSync(ARGV_LOG);
    } catch {
      // ok
    }

    await runSetupCheck({
      bins: FAKE_BINS,
      timeoutMs: 5000,
    });
    await runSetupCheck({
      bins: {
        ...FAKE_BINS,
        agy: path.join(FAKE_DIR, 'missing'),
      },
      timeoutMs: 5000,
    });

    const invocations = readArgvLog();
    assert.ok(
      invocations.length >= 1,
      'codebuddy fake must have recorded at least one invocation'
    );

    for (const argv of invocations) {
      assert.deepEqual(
        argv,
        ['--version'],
        `codebuddy received non-whitelist argv: ${JSON.stringify(argv)}`
      );
    }

    const flat = invocations.flat();
    assert.ok(!flat.includes('status'), 'must never pass status');
    assert.ok(!flat.includes('whoami'), 'must never pass whoami');
  });

  it('5. cursor logged-out → login reflects Not logged in', async () => {
    const prev = process.env.FAKE_CURSOR_LOGIN;
    process.env.FAKE_CURSOR_LOGIN = 'logged-out';
    try {
      const rows = await runSetupCheck({
        bins: FAKE_BINS,
        timeoutMs: 5000,
      });
      const cursor = rows.find((r) => r.engine === 'cursor');
      assert.ok(cursor);
      assert.equal(cursor.installed, true);
      assert.equal(cursor.login, 'logged-out');
    } finally {
      if (prev === undefined) delete process.env.FAKE_CURSOR_LOGIN;
      else process.env.FAKE_CURSOR_LOGIN = prev;
    }
  });
});
