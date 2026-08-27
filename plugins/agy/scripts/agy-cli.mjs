#!/usr/bin/env node

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
  let isBackground = false;
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
    if (arg === '--background' || arg === '-b') {
      isBackground = true;
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
    isBackground,
    resumeId: resumeId || null,
    prompt: promptParts.join(' ').trim(),
  };
}

/**
 * Execute research prompt via agy headless CLI.
 *
 * @param {string} prompt
 * @param {object} [options]
 * @param {string} [options.agyBin]
 * @param {string} [options.timeout]
 * @param {string} [options.resumeId]
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
  if (options.resumeId) {
    args.push('--conversation', options.resumeId);
  }

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

      if (options.resumeId) {
        const returnedId = parsed.conversation_id;
        if (returnedId !== options.resumeId) {
          return reject(
            new Error(
              `上下文未延续（resume 失败）：引擎返回了新会话 ${returnedId}，这可能是一次全新回答`
            )
          );
        }
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

const IMPLEMENT_INSTRUCTION =
  '不要修改任何文件、不要调用写文件工具。阅读相关文件后，在回复末尾对每个要修改的文件输出：`===FILE: <相对路径>===` 一行，随后是完整修改后文件内容，`===END===` 结束。块外可有说明文字。';

function extractImplementFiles(response) {
  const files = [];
  const fileBlockPattern = /===FILE:\s*(.+?)===\r?\n([\s\S]*?)===END===/g;
  let match;
  while ((match = fileBlockPattern.exec(response)) !== null) {
    files.push({ path: match[1].trim(), content: match[2] });
  }
  if (files.length === 0) return null;
  // Delimiter-collision guard: '===END===' or '===FILE:' appearing inside a
  // block's content means the regex terminated that block early (content
  // silently truncated). Detect leftovers so callers get a warning instead
  // of trusting a clipped extraction.
  for (let i = 0; i < files.length; i++) {
    if (/===END===|===FILE:/.test(files[i].content)) {
      files[i].contentSuspect = true;
    }
  }
  return files;
}

/**
 * Ask agy for complete replacement contents without allowing it to write files.
 *
 * @param {string} prompt
 * @param {object} [options]
 * @param {string} [options.agyBin]
 * @param {string} [options.timeout]
 * @returns {Promise<{status: string, response: string, files: Array<{path: string, content: string}> | null, warnings: string[], session_id: string | undefined, usage: any, raw: any}>}
 */
export function runAgyImplement(prompt, options = {}) {
  const agyBin = options.agyBin || process.env.AGY_BIN || 'agy';
  const timeout = options.timeout || process.env.AGY_TIMEOUT || '3m';
  const templatedPrompt = `${IMPLEMENT_INSTRUCTION}\n\n${prompt}`;
  const args = [
    '-p',
    templatedPrompt,
    '--output-format',
    'json',
    '--print-timeout',
    timeout,
  ];

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(agyBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return reject(err);
    }

    let stdoutData = '';
    let stderrData = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdoutData += chunk; });
    child.stderr.on('data', (chunk) => { stderrData += chunk; });

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
      const trimmedStderr = stderrData.trim();
      const stderrForEmbed = truncateForEmbed(trimmedStderr);
      if (!trimmedStdout) {
        return reject(new Error(
          `agy exited with code ${code} and produced no stdout. stderr: ${stderrForEmbed || '(empty)'}`
        ));
      }

      let parsed;
      try {
        parsed = JSON.parse(trimmedStdout);
      } catch (parseErr) {
        return reject(new Error(
          `Failed to parse agy JSON output: ${parseErr.message}\nRaw output: ${truncateForEmbed(trimmedStdout)}\nstderr: ${stderrForEmbed}`
        ));
      }

      const response = parsed.response || '';
      const warnings = [];
      const permissionPattern = /权限不足|无法访问|被拒绝|auto-denied|denied|not allowed/i;
      if (permissionPattern.test(trimmedStderr)) {
        warnings.push(`Warning (permission issue detected in stderr): ${stderrForEmbed}`);
      }

      if (parsed.status === 'CANCELED') {
        const detail = stderrForEmbed || parsed.error || 'agy run was canceled';
        const runErr = new Error(
          `${detail}\n两个办法任选其一：①在交互模式运行一次 agy，把当前目录加入 trustedWorkspaces；②在 ~/.gemini/antigravity-cli/settings.json 的 permissions.allow 中添加所需规则。`
        );
        runErr.status = parsed.status;
        runErr.raw = parsed;
        runErr.warnings = warnings;
        return reject(runErr);
      }

      // Contract: SUCCESS requires a non-empty response; ERROR is only a
      // defensive success when it carries a non-blank response.
      const hasProduct = response.trim().length > 0;
      if (!hasProduct) {
        const runErr = new Error(
          `${parsed.error || `agy run ended with status '${parsed.status}'`}\nstderr: ${stderrForEmbed || '(empty)'}`
        );
        runErr.status = parsed.status;
        runErr.raw = parsed;
        runErr.warnings = warnings;
        return reject(runErr);
      }

      if (parsed.status !== 'SUCCESS' && parsed.status !== 'ERROR') {
        const parts = [];
        if (parsed.error) parts.push(parsed.error);
        if (stderrForEmbed) parts.push(`stderr: ${stderrForEmbed}`);
        if (!parts.length) parts.push(`agy run ended with status '${parsed.status}' (exit code ${code})`);
        const runErr = new Error(parts.join('\n'));
        runErr.status = parsed.status;
        runErr.raw = parsed;
        runErr.warnings = warnings;
        return reject(runErr);
      }

      if (parsed.status === 'ERROR') {
        warnings.push('agy 报内部错误但产物可能在 response，请人工核对');
      }
      const files = extractImplementFiles(response);
      if (files === null) {
        warnings.push('未找到 FILE 块，response 原样返回');
      } else if (files.some((f) => f.contentSuspect)) {
        warnings.push('检测到 FILE 块内容中含 ===END===/===FILE: 字样，提取结果可能被截断——请以完整 response 为准');
      }
      return resolve({
        status: parsed.status,
        response,
        files,
        warnings,
        session_id: parsed.session_id || parsed.conversation_id,
        usage: parsed.usage,
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

  if (args[0] === 'implement') {
    const prompt = args.slice(1).join(' ').trim();
    if (!prompt) {
      console.error('Usage: agy-cli.mjs implement <instruction>');
      process.exit(1);
    }
    try {
      const result = await runAgyImplement(prompt);
      if (result.files) {
        console.log('Files:');
        for (const file of result.files) {
          const lines = file.content === '' ? [] : file.content.split(/\r?\n/);
          if (lines.at(-1) === '') lines.pop();
          const lineCount = lines.length;
          console.log(`- ${file.path} (${lineCount} 行)`);
        }
      }
      console.log(result.response);
      for (const warning of result.warnings) console.error(warning);
      return;
    } catch (err) {
      if (err.warnings) {
        for (const warning of err.warnings) console.error(warning);
      }
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  }

  // Handle research / default command
  if (args[0] === 'research') {
    args.shift();
  }

  const parsedArgs = parseResearchCliArgs(args);
  if (parsedArgs.error === 'missing-resume-id') {
    console.error('Usage: agy-cli.mjs research [--resume <id>] [--background] <prompt> | agy-cli.mjs implement <instruction> | agy-cli.mjs status [job-id]');
    process.exit(1);
  }
  const { isBackground, resumeId } = parsedArgs;
  const prompt = parsedArgs.prompt;
  if (!prompt) {
    console.error('Usage: agy-cli.mjs research [--resume <id>] [--background] <prompt> | agy-cli.mjs implement <instruction> | agy-cli.mjs status [job-id]');
    process.exit(1);
  }

  const resultsDir =
    process.env.QUOTA_ROUTER_NO_SAVE === '1'
      ? null
      : process.env.QUOTA_ROUTER_RESULTS_DIR ||
        path.join(os.homedir(), '.claude', 'quota-router', 'results');

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
    const result = await runAgyResearch(prompt, { resumeId: resumeId || undefined });
    if (result.warnings && result.warnings.length > 0) {
      for (const warning of result.warnings) {
        console.error(warning);
      }
    }
    if (result.response) {
      console.log(result.response);
    }
    persistResearchResult(
      {
        engine: 'agy',
        session_id: result.conversation_id,
        prompt,
        body: result.response || '',
      },
      resultsDir
    );
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
