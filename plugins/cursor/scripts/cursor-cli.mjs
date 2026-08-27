#!/usr/bin/env node

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_TIMEOUT_MS = 180000;
const DEFAULT_IMPLEMENT_TIMEOUT_MS = 300000;
const SIGKILL_GRACE_MS = 2000;
const MAX_STDERR_TRUNCATE = 2000;
const SOFT_DENY_PATTERN = /blocked|rejected|denied/i;

/** Truncate text embedded into Error messages only (head kept). */
function truncateForEmbed(text) {
  if (!text || text.length <= MAX_STDERR_TRUNCATE) return text || '';
  return text.slice(0, MAX_STDERR_TRUNCATE) + '…(truncated)';
}

/** Partial-success trap (GOAL.md §9.5): agent may write guessed results after shell was blocked. */
const IMPLEMENT_PARTIAL_PATTERN =
  /被拒绝|无法执行|未能实际执行|跳过|blocked|rejected|denied|skipped/i;

function saveResult(payload, resultsDir) {
  fs.mkdirSync(resultsDir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(resultsDir, 0o700);
  } catch {
    // best-effort directory mode
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const filePath = path.join(resultsDir, `${stamp}-${crypto.randomUUID().slice(0, 8)}.md`);
  const text =
    `---\n` +
    `engine: ${payload.engine}\n` +
    `timestamp: ${payload.timestamp || new Date().toISOString()}\n` +
    `session_id: ${payload.session_id || ''}\n` +
    `prompt: ${JSON.stringify(payload.prompt || '')}\n` +
    `---\n\n` +
    '````\n' +
    `${payload.body ?? ''}\n` +
    '````\n';
  const fd = fs.openSync(filePath, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, text);
    try {
      fs.fchmodSync(fd, 0o600);
    } catch {
      // best-effort file mode
    }
  } finally {
    fs.closeSync(fd);
  }
  return filePath;
}

function persistResearchResult(payload, resultsDir) {
  if (!resultsDir) return;
  try {
    const saved = saveResult(payload, resultsDir);
    console.log(`Saved: ${saved}`);
  } catch (err) {
    console.error(`Warning: failed to save research result: ${err.message}`);
  }
}

function parseResearchCliArgs(argv) {
  let resumeId = null;
  const promptParts = [];
  let restIsPrompt = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (restIsPrompt) {
      promptParts.push(arg);
      continue;
    }
    if (arg === '--') {
      restIsPrompt = true;
      continue;
    }
    if (arg === '--resume') {
      const next = argv[i + 1];
      if (next === undefined || next === '--') {
        return { error: 'missing-resume-id' };
      }
      resumeId = next;
      i += 1;
      continue;
    }
    if (arg.startsWith('--resume=')) {
      resumeId = arg.slice('--resume='.length);
      continue;
    }
    restIsPrompt = true;
    promptParts.push(arg);
  }
  return {
    resumeId: resumeId || null,
    prompt: promptParts.join(' ').trim(),
  };
}

/**
 * Execute research prompt via Cursor CLI (agent) in ask mode.
 *
 * Failure modes differ from agy: failed runs produce empty stdout and plain-text
 * stderr (even with --output-format json). Success is exit code 0 AND non-empty
 * stdout. There is no native --timeout; we wrap with setTimeout + kill.
 *
 * @param {string} prompt
 * @param {object} [options]
 * @param {string} [options.agentBin]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ status: string, result?: string, session_id?: string, usage?: object, warnings?: string[], raw: any }>}
 */
export function runCursorResearch(prompt, options = {}) {
  const agentBin = options.agentBin || process.env.CURSOR_AGENT_BIN || 'agent';
  const timeoutMs = Number(
    options.timeoutMs ?? process.env.CURSOR_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS
  );

  const args = ['-p', prompt, '--mode', 'ask', '--output-format', 'json'];
  if (options.resumeId) {
    args.push('--resume', options.resumeId);
  }

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(agentBin, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      return reject(err);
    }

    let stdoutData = '';
    let stderrData = '';
    let timedOut = false;
    let killTimer = null;

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
        // process may already be gone
      }
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // process may already be gone
        }
      }, SIGKILL_GRACE_MS);
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      if (err.code === 'ENOENT') {
        const enoentErr = new Error(
          `Cursor CLI ('${agentBin}') not found. Please verify that 'agent' is installed and in your PATH.`
        );
        enoentErr.code = 'ENOENT';
        return reject(enoentErr);
      }
      return reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);

      const trimmedStdout = stdoutData.trim();
      const trimmedStderr = stderrData.trim();
      const stderrForEmbed = truncateForEmbed(trimmedStderr);

      if (timedOut) {
        return reject(
          new Error(
            `Cursor CLI timed out after ${timeoutMs}ms (process killed). stderr: ${stderrForEmbed || '(empty)'}`
          )
        );
      }

      // Hard failure gate: exit 0 AND non-empty stdout. Do NOT assume failure has JSON.
      if (code !== 0 || !trimmedStdout) {
        return reject(
          new Error(
            `agent exited with code ${code} and produced ${trimmedStdout ? 'stdout but non-zero exit' : 'no stdout'}. stderr: ${stderrForEmbed || '(empty)'}`
          )
        );
      }

      let parsed;
      try {
        parsed = JSON.parse(trimmedStdout);
      } catch (parseErr) {
        return reject(
          new Error(
            `Failed to parse agent JSON output: ${parseErr.message}\nRaw output: ${truncateForEmbed(trimmedStdout)}\nstderr: ${stderrForEmbed}`
          )
        );
      }

      const resultText = parsed.result || '';
      const warnings = [];

      // Soft-deny signals are mixed into natural-language result text (no clean stderr keywords).
      if (SOFT_DENY_PATTERN.test(resultText)) {
        warnings.push(
          'Warning (possible incomplete research): result text matched blocked|rejected|denied — response may be incomplete.'
        );
      }

      if (options.resumeId) {
        const returnedId = parsed.session_id;
        if (returnedId !== options.resumeId) {
          return reject(
            new Error(
              `上下文未延续（resume 失败）：引擎返回了新会话 ${returnedId}，这可能是一次全新回答`
            )
          );
        }
      }

      return resolve({
        status: 'SUCCESS',
        result: resultText,
        session_id: parsed.session_id,
        usage: parsed.usage,
        warnings,
        raw: parsed,
      });
    });
  });
}

/**
 * Execute an implement (write) prompt via Cursor CLI (agent).
 *
 * Differs from research in two args only: no `--mode ask`, adds `--trust`.
 * Does NOT pass `--force` / `--yolo` / `-y` (minimal permission gate).
 *
 * Partial-success trap: when shell is blocked under `--trust`, agent may still
 * edit files with guessed content, exit 0, is_error:false. Keyword scan on
 * `result` surfaces warnings; does NOT reject — file may still be correct.
 *
 * @param {string} prompt
 * @param {object} [options]
 * @param {string} [options.agentBin]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ status: string, result?: string, session_id?: string, usage?: object, warnings?: string[], raw: any }>}
 */
export function runCursorImplement(prompt, options = {}) {
  const agentBin = options.agentBin || process.env.CURSOR_AGENT_BIN || 'agent';
  const timeoutMs = Number(
    options.timeoutMs ??
      process.env.CURSOR_TIMEOUT_MS ??
      DEFAULT_IMPLEMENT_TIMEOUT_MS
  );

  // Write path: drop --mode ask, add --trust only (no --force/--yolo/-y).
  const args = ['-p', prompt, '--trust', '--output-format', 'json'];

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(agentBin, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      return reject(err);
    }

    let stdoutData = '';
    let stderrData = '';
    let timedOut = false;
    let killTimer = null;

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
        // process may already be gone
      }
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // process may already be gone
        }
      }, SIGKILL_GRACE_MS);
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      if (err.code === 'ENOENT') {
        const enoentErr = new Error(
          `Cursor CLI ('${agentBin}') not found. Please verify that 'agent' is installed and in your PATH.`
        );
        enoentErr.code = 'ENOENT';
        return reject(enoentErr);
      }
      return reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);

      const trimmedStdout = stdoutData.trim();
      const trimmedStderr = stderrData.trim();
      const stderrForEmbed = truncateForEmbed(trimmedStderr);

      if (timedOut) {
        return reject(
          new Error(
            `Cursor CLI timed out after ${timeoutMs}ms (process killed). stderr: ${stderrForEmbed || '(empty)'}`
          )
        );
      }

      // Same hard-failure gate as research: exit 0 AND non-empty stdout.
      if (code !== 0 || !trimmedStdout) {
        return reject(
          new Error(
            `agent exited with code ${code} and produced ${trimmedStdout ? 'stdout but non-zero exit' : 'no stdout'}. stderr: ${stderrForEmbed || '(empty)'}`
          )
        );
      }

      let parsed;
      try {
        parsed = JSON.parse(trimmedStdout);
      } catch (parseErr) {
        return reject(
          new Error(
            `Failed to parse agent JSON output: ${parseErr.message}\nRaw output: ${truncateForEmbed(trimmedStdout)}\nstderr: ${stderrForEmbed}`
          )
        );
      }

      const resultText = parsed.result || '';
      const warnings = [];

      // Partial-success: do not reject — surface warning so user re-verifies.
      if (IMPLEMENT_PARTIAL_PATTERN.test(resultText)) {
        warnings.push(
          'Warning (possible partial success): result text matched 被拒绝|无法执行|未能实际执行|跳过|blocked|rejected|denied|skipped — agent may have written guessed content without running verification. Confirm with your own tests.'
        );
      }

      return resolve({
        status: 'SUCCESS',
        result: resultText,
        session_id: parsed.session_id,
        usage: parsed.usage,
        warnings,
        raw: parsed,
      });
    });
  });
}

/**
 * CLI entry point
 */
export async function main(argv = process.argv.slice(2)) {
  const args = [...argv];
  let command = 'research';

  if (args[0] === 'research' || args[0] === 'implement') {
    command = args.shift();
  }

  if (command === 'implement') {
    const prompt = args.join(' ').trim();
    if (!prompt) {
      console.error('Usage: cursor-cli.mjs research [--resume <id>] <prompt> | cursor-cli.mjs implement <prompt>');
      process.exit(1);
    }
    try {
      const result = await runCursorImplement(prompt);
      if (result.warnings && result.warnings.length > 0) {
        for (const warning of result.warnings) {
          console.error(warning);
        }
      }
      if (result.result) {
        console.log(result.result);
      }
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  const parsedArgs = parseResearchCliArgs(args);
  if (parsedArgs.error === 'missing-resume-id') {
    console.error('Usage: cursor-cli.mjs research [--resume <id>] <prompt> | cursor-cli.mjs implement <prompt>');
    process.exit(1);
  }
  const { resumeId } = parsedArgs;
  const prompt = parsedArgs.prompt;
  if (!prompt) {
    console.error('Usage: cursor-cli.mjs research [--resume <id>] <prompt> | cursor-cli.mjs implement <prompt>');
    process.exit(1);
  }

  const resultsDir =
    process.env.QUOTA_ROUTER_NO_SAVE === '1'
      ? null
      : process.env.QUOTA_ROUTER_RESULTS_DIR ||
        path.join(os.homedir(), '.claude', 'quota-router', 'results');

  try {
    const result = await runCursorResearch(prompt, { resumeId: resumeId || undefined });
    if (result.warnings && result.warnings.length > 0) {
      for (const warning of result.warnings) {
        console.error(warning);
      }
    }
    if (result.result) {
      console.log(result.result);
    }
    persistResearchResult(
      {
        engine: 'cursor',
        session_id: result.session_id,
        prompt,
        body: result.result || '',
      },
      resultsDir
    );
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  main();
}
