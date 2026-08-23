#!/usr/bin/env node

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  resolveJobsDir,
  getJobFilePath,
  readJob,
  writeJob,
  listJobs,
  isProcessAlive,
  formatJobStatus,
} from './job-store.mjs';

const MAX_STDERR_TRUNCATE = 2000;

/** Truncate text embedded into Error/warning messages only (head kept). */
function truncateForEmbed(text) {
  if (!text || text.length <= MAX_STDERR_TRUNCATE) return text || '';
  return text.slice(0, MAX_STDERR_TRUNCATE) + '…(truncated)';
}

export {
  resolveJobsDir,
  getJobFilePath,
  readJob,
  writeJob,
  listJobs,
  isProcessAlive,
  formatJobStatus,
};

/**
 * Execute research prompt via agy headless CLI.
 *
 * @param {string} prompt
 * @param {object} [options]
 * @param {string} [options.agyBin]
 * @param {string} [options.timeout]
 * @returns {Promise<{ status: string, response?: string, error?: string, warnings?: string[], raw: any }>}
 */
export function runAgyResearch(prompt, options = {}) {
  const agyBin = options.agyBin || process.env.AGY_BIN || 'agy';
  const timeout = options.timeout || process.env.AGY_TIMEOUT || '3m';

  const args = [
    '-p',
    prompt,
    '--output-format',
    'json',
    '--print-timeout',
    timeout,
  ];

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(agyBin, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      return reject(err);
    }

    let stdoutData = '';
    let stderrData = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk) => {
      stdoutData += chunk;
    });

    child.stderr.on('data', (chunk) => {
      stderrData += chunk;
    });

    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        const enoentErr = new Error(
          `Antigravity CLI ('${agyBin}') not found. Please verify that 'agy' is installed and in your PATH.`
        );
        enoentErr.code = 'ENOENT';
        return reject(enoentErr);
      }
      return reject(err);
    });

    child.on('close', (code) => {
      const trimmedStdout = stdoutData.trim();
      // Keep full stderr for soft-deny scan; truncate only when embedding into messages.
      const trimmedStderr = stderrData.trim();
      const stderrForEmbed = truncateForEmbed(trimmedStderr);

      if (!trimmedStdout) {
        return reject(
          new Error(
            `agy exited with code ${code} and produced no stdout. stderr: ${stderrForEmbed || '(empty)'}`
          )
        );
      }

      let parsed;
      try {
        parsed = JSON.parse(trimmedStdout);
      } catch (parseErr) {
        return reject(
          new Error(
            `Failed to parse agy JSON output: ${parseErr.message}\nRaw output: ${truncateForEmbed(trimmedStdout)}\nstderr: ${stderrForEmbed}`
          )
        );
      }

      const warnings = [];
      const softDenyPattern = /denied|not allowed/i;
      // Scan full stderr first; embed truncated copy only.
      if (softDenyPattern.test(trimmedStderr)) {
        warnings.push(`Warning (soft-deny detected in stderr): ${stderrForEmbed}`);
      }

      // Check status field as single source of truth for success/failure
      if (parsed.status !== 'SUCCESS') {
        const errorDetail =
          parsed.error ||
          stderrForEmbed ||
          `agy run ended with status '${parsed.status}' (exit code ${code})`;
        const runErr = new Error(errorDetail);
        runErr.status = parsed.status;
        runErr.raw = parsed;
        runErr.warnings = warnings;
        return reject(runErr);
      }

      return resolve({
        status: parsed.status,
        response: parsed.response || '',
        conversation_id: parsed.conversation_id,
        duration_seconds: parsed.duration_seconds,
        num_turns: parsed.num_turns,
        usage: parsed.usage,
        warnings,
        raw: parsed,
      });
    });
  });
}

/**
 * Handle worker execution in background child process.
 *
 * @param {string} jobId
 * @param {string} prompt
 */
async function runWorker(jobId, prompt) {
  try {
    const result = await runAgyResearch(prompt);
    const existing = readJob(jobId) || { id: jobId, prompt, startedAt: new Date().toISOString() };
    writeJob({
      ...existing,
      status: 'done',
      conversationId: result.conversation_id || existing.conversationId || null,
      finishedAt: new Date().toISOString(),
      response: result.response || '',
      error: null,
    });
  } catch (err) {
    const existing = readJob(jobId) || { id: jobId, prompt, startedAt: new Date().toISOString() };
    writeJob({
      ...existing,
      status: 'error',
      conversationId: err.raw?.conversation_id || existing.conversationId || null,
      finishedAt: new Date().toISOString(),
      response: null,
      error: err.message || String(err),
    });
  }
}

/**
 * CLI Entry point
 */
export async function main(argv = process.argv.slice(2)) {
  const args = [...argv];

  // Internal worker mode
  if (args[0] === '--worker') {
    const jobId = args[1];
    const prompt = args.slice(2).join(' ').trim();
    if (!jobId || !prompt) {
      process.exit(1);
    }
    await runWorker(jobId, prompt);
    process.exit(0);
  }

  // Status command
  if (args[0] === 'status') {
    const jobId = args.slice(1).join(' ').trim();
    if (jobId) {
      const job = readJob(jobId);
      if (!job) {
        console.error(`Error: Job '${jobId}' not found.`);
        process.exit(1);
      }
      const displayStatus = formatJobStatus(job);
      console.log(`Job ID: ${job.id}`);
      console.log(`Status: ${displayStatus}`);
      console.log(`Prompt: ${job.prompt}`);
      if (job.pid) console.log(`PID: ${job.pid}`);
      if (job.conversationId) console.log(`Conversation ID: ${job.conversationId}`);
      if (job.startedAt) console.log(`Started: ${job.startedAt}`);
      if (job.finishedAt) console.log(`Finished: ${job.finishedAt}`);
      if (job.status === 'done') {
        console.log(`\nResponse:\n${job.response || '(empty response)'}`);
      } else if (job.status === 'error') {
        console.log(`\nError:\n${job.error || '(unknown error)'}`);
      }
      return;
    }

    const jobs = listJobs();
    if (jobs.length === 0) {
      console.log('No background jobs found.');
      return;
    }
    const recent = jobs.slice(0, 10);
    console.log(`Recent jobs (${recent.length}/${jobs.length}):\n`);
    for (const job of recent) {
      const displayStatus = formatJobStatus(job);
      const shortPrompt = job.prompt.length > 50 ? job.prompt.slice(0, 47) + '...' : job.prompt;
      console.log(`- [${displayStatus}] ${job.id} (${job.startedAt || 'unknown time'})`);
      console.log(`  Prompt: ${shortPrompt}`);
    }
    return;
  }

  // Handle research / default command
  if (args[0] === 'research') {
    args.shift();
  }

  // Check background flag
  let isBackground = false;
  const filteredArgs = [];
  for (const arg of args) {
    if (arg === '--background' || arg === '-b') {
      isBackground = true;
    } else {
      filteredArgs.push(arg);
    }
  }

  const prompt = filteredArgs.join(' ').trim();
  if (!prompt) {
    console.error('Usage: agy-cli.mjs [research] [--background] <prompt> | agy-cli.mjs status [job-id]');
    process.exit(1);
  }

  if (isBackground) {
    const jobId = crypto.randomUUID();
    const job = {
      id: jobId,
      prompt,
      status: 'running',
      pid: null,
      conversationId: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      response: null,
      error: null,
    };
    writeJob(job);

    const currentScript = fileURLToPath(import.meta.url);
    const child = spawn(process.execPath, [currentScript, '--worker', jobId, prompt], {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
      },
    });
    child.unref();

    job.pid = child.pid;
    writeJob(job);

    console.log(`Job started in background: ${jobId}`);
    console.log(`Use '/agy:status ${jobId}' to check results.`);
    return;
  }

  // Foreground mode
  try {
    const result = await runAgyResearch(prompt);
    if (result.warnings && result.warnings.length > 0) {
      for (const warning of result.warnings) {
        console.error(warning);
      }
    }
    if (result.response) {
      console.log(result.response);
    }
  } catch (err) {
    if (err.warnings && err.warnings.length > 0) {
      for (const warning of err.warnings) {
        console.error(warning);
      }
    }
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

const isDirectRun =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  main();
}
