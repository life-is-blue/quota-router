#!/usr/bin/env node

/**
 * /quota:setup — readiness check for agy / cursor / codebuddy / codex.
 *
 * Diagnosis only: never burns tokens. Probe command whitelist is hardcoded;
 * engines that cannot be probed for login are reported as `unknown`.
 * The CLI always exits 0.
 */

import { spawn } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_TIMEOUT_MS = 10000;
const SIGKILL_GRACE_MS = 2000;

/** Hardcoded probe whitelist — do not add off-list commands. */
const ENGINE_SPECS = [
  {
    engine: 'agy',
    defaultBin: 'agy',
    versionArgs: ['--version'],
    loginProbe: null, // no safe probe → always unknown
    installHint: 'Install Antigravity CLI (`agy`) and ensure it is on PATH.',
  },
  {
    engine: 'cursor',
    defaultBin: 'agent',
    versionArgs: ['--version'],
    loginProbe: {
      args: ['status'],
      loggedInPattern: /Logged in/i,
      loggedOutPattern: /Not logged in/i,
    },
    installHint:
      'Install Cursor CLI (`agent`) — see https://cursor.com/docs/cli — and run `agent login`.',
  },
  {
    engine: 'codebuddy',
    defaultBin: 'codebuddy',
    // CRITICAL: only --version is safe. status/whoami/bare args burn LLM tokens.
    versionArgs: ['--version'],
    loginProbe: null,
    installHint: 'Install codebuddy CLI and ensure it is on PATH.',
  },
  {
    engine: 'codex',
    defaultBin: 'codex',
    versionArgs: ['--version'],
    // Empirically reliable (2026-08-24): `codex login status` → "Logged in using ChatGPT", exit 0, no side effects.
    loginProbe: {
      args: ['login', 'status'],
      loggedInPattern: /Logged in/i,
      loggedOutPattern: /Not logged in|Logged out|not logged in/i,
    },
    installHint: 'Install Codex CLI (`npm i -g @openai/codex`) and run `codex login`.',
  },
];

/**
 * Spawn a command, capture stdout+stderr, enforce timeout with SIGTERM→SIGKILL.
 * @returns {Promise<{ ok: true, output: string } | { ok: false, reason: 'ENOENT'|'timeout'|'error', message?: string }>}
 */
function runProbe(bin, args, timeoutMs) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        return resolve({ ok: false, reason: 'ENOENT' });
      }
      return resolve({
        ok: false,
        reason: 'error',
        message: err?.message || String(err),
      });
    }

    let stdoutData = '';
    let stderrData = '';
    let timedOut = false;
    let killTimer = null;
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdoutData += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderrData += chunk;
    });

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {
        // already gone
      }
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // already gone
        }
      }, SIGKILL_GRACE_MS);
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      if (err.code === 'ENOENT') {
        return finish({ ok: false, reason: 'ENOENT' });
      }
      return finish({
        ok: false,
        reason: 'error',
        message: err.message,
      });
    });

    child.on('close', () => {
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);

      if (timedOut) {
        return finish({ ok: false, reason: 'timeout' });
      }

      // Exit code is NOT authoritative (agy/agent errors can exit 0).
      // Presence of spawnable binary + output content is the gate.
      const output = `${stdoutData}${stderrData}`.trim();
      return finish({ ok: true, output });
    });
  });
}

/** Extract a version-like token from CLI --version output. */
function parseVersion(output) {
  if (!output) return null;
  // Prefer dotted numeric tokens (e.g. 1.1.19, 0.149.0, 2026.08.11-e8db854).
  const match = output.match(/(\d+\.\d+[\w.-]*)/);
  return match ? match[1] : output.split(/\s+/)[0] || null;
}

function interpretLogin(output, loginProbe) {
  if (!loginProbe) return 'unknown';
  if (!output) return 'unknown';
  // Check logged-out FIRST: "Not logged in" also contains the substring "logged in".
  if (loginProbe.loggedOutPattern && loginProbe.loggedOutPattern.test(output)) {
    return 'logged-out';
  }
  if (loginProbe.loggedInPattern.test(output)) return 'logged-in';
  // Output present but unrecognized → do not guess.
  return 'unknown';
}

/**
 * Run readiness checks for all four engines.
 *
 * @param {object} [options]
 * @param {object} [options.bins] map engine → binary path (keys: agy, cursor, codebuddy, codex)
 * @param {number} [options.timeoutMs] per-probe timeout (default 10000)
 * @returns {Promise<Array<{engine: string, installed: boolean, version: string|null, login: string, detail: string}>>}
 */
export async function runSetupCheck(options = {}) {
  const bins = options.bins || {};
  const timeoutMs = Number(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const checks = ENGINE_SPECS.map(async (spec) => {
    const bin = bins[spec.engine] || spec.defaultBin;

    const versionResult = await runProbe(bin, spec.versionArgs, timeoutMs);

    if (!versionResult.ok) {
      if (versionResult.reason === 'ENOENT') {
        return {
          engine: spec.engine,
          installed: false,
          version: null,
          login: 'unknown',
          detail: `not installed (${bin} not found). ${spec.installHint}`,
        };
      }
      if (versionResult.reason === 'timeout') {
        return {
          engine: spec.engine,
          installed: false,
          version: null,
          login: 'unknown',
          detail: `version probe timed out after ${timeoutMs}ms`,
        };
      }
      return {
        engine: spec.engine,
        installed: false,
        version: null,
        login: 'unknown',
        detail: `version probe failed: ${versionResult.message || versionResult.reason}`,
      };
    }

    // Spawned OK. Treat non-empty version-like output as installed.
    const version = parseVersion(versionResult.output);
    if (!versionResult.output) {
      return {
        engine: spec.engine,
        installed: false,
        version: null,
        login: 'unknown',
        detail: 'version probe produced empty output',
      };
    }

    let login = 'unknown';
    let detail = `version ${version}`;

    if (spec.loginProbe) {
      const loginResult = await runProbe(bin, spec.loginProbe.args, timeoutMs);
      if (!loginResult.ok) {
        if (loginResult.reason === 'timeout') {
          detail = `version ${version}; login probe timed out`;
        } else if (loginResult.reason === 'ENOENT') {
          // Binary vanished between probes — still report version path result.
          detail = `version ${version}; login probe ENOENT`;
        } else {
          detail = `version ${version}; login probe failed`;
        }
        login = 'unknown';
      } else {
        login = interpretLogin(loginResult.output, spec.loginProbe);
        if (login === 'logged-in') {
          detail = `version ${version}; ${loginResult.output.split('\n')[0]}`;
        } else if (login === 'logged-out') {
          detail = `version ${version}; not logged in`;
        } else {
          detail = `version ${version}; login status unrecognized`;
        }
      }
    } else {
      detail = `version ${version}; login not probeable (unknown)`;
    }

    return {
      engine: spec.engine,
      installed: true,
      version,
      login,
      detail,
    };
  });

  return Promise.all(checks);
}

function formatMarkdownTable(rows) {
  const lines = [
    '# Quota Router Setup',
    '',
    'Readiness check for local engines. Diagnosis only — unavailable engines are reported, not blocked.',
    '',
    '| Engine | Installed | Version | Login | Detail / Install hint |',
    '| --- | --- | --- | --- | --- |',
  ];

  for (const row of rows) {
    const installed = row.installed ? 'yes' : 'no';
    const version = row.version || '—';
    const login = row.login;
    const detail = (row.detail || '').replace(/\|/g, '\\|');
    lines.push(
      `| ${row.engine} | ${installed} | ${version} | ${login} | ${detail} |`
    );
  }

  lines.push('');
  lines.push(
    '_Note: agy/codebuddy login cannot be probed without side effects; reported as `unknown`._'
  );
  return lines.join('\n');
}

async function main() {
  try {
    const rows = await runSetupCheck();
    process.stdout.write(formatMarkdownTable(rows) + '\n');
  } catch (err) {
    // Still exit 0: diagnosis must never gate the user.
    process.stdout.write(
      `# Quota Router Setup\n\nCheck failed unexpectedly: ${err?.message || err}\n`
    );
  }
  process.exit(0);
}

const isDirectRun =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  main();
}
