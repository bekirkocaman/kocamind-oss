'use strict';

const { spawn } = require('node:child_process');

const DEFAULT_TIMEOUT_MS = 30000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 120000;
const MAX_OUTPUT_CHARS = 20000;
const TRUNCATE_PREFIX = '…(kısaltıldı)\n';
const ALLOWED_KEYS = new Set(['command', 'timeout_ms']);

function validate(raw) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Geçersiz alan: args');
  }
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new Error(`Bilinmeyen alan: ${key}`);
    }
  }
  if (raw.command === undefined || raw.command === null) {
    throw new Error('Eksik alan: command');
  }
  if (typeof raw.command !== 'string' || raw.command.trim() === '') {
    throw new Error('Geçersiz alan: command');
  }

  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (raw.timeout_ms !== undefined) {
    if (
      typeof raw.timeout_ms !== 'number' ||
      !Number.isInteger(raw.timeout_ms) ||
      raw.timeout_ms < MIN_TIMEOUT_MS ||
      raw.timeout_ms > MAX_TIMEOUT_MS
    ) {
      throw new Error('Geçersiz alan: timeout_ms');
    }
    timeoutMs = raw.timeout_ms;
  }

  return { command: raw.command, timeout_ms: timeoutMs };
}

function truncateOutput(text) {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return TRUNCATE_PREFIX + text.slice(-MAX_OUTPUT_CHARS);
}

function killProcessTree(child) {
  if (!child || !child.pid) return;
  if (process.platform === 'win32') {
    try {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.unref();
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {}
    }
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {}
    }
  }
}

async function execute(args, ctx) {
  const startTime = Date.now();
  const isWin = process.platform === 'win32';

  if (ctx.signal && ctx.signal.aborted) {
    return {
      exitCode: null,
      stdout: '',
      stderr: '',
      timedOut: true,
      durationMs: 0,
    };
  }

  return new Promise((resolve) => {
    const file = isWin ? 'cmd.exe' : '/bin/sh';
    const spawnArgs = isWin ? ['/d', '/s', '/c', `"${args.command}"`] : ['-c', args.command];

    const child = spawn(file, spawnArgs, {
      cwd: ctx.workspace.root,
      env: process.env,
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: isWin,
      detached: !isWin,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let killGraceTimer = null;

    const keepTail = (buf) => (buf.length > MAX_OUTPUT_CHARS * 2 ? buf.slice(-MAX_OUTPUT_CHARS - 100) : buf);

    if (child.stdout) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout = keepTail(stdout + chunk);
      });
    }
    if (child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => {
        stderr = keepTail(stderr + chunk);
      });
    }

    function finish(code) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killGraceTimer) clearTimeout(killGraceTimer);
      if (ctx.signal) {
        ctx.signal.removeEventListener('abort', onAbort);
      }
      resolve({
        exitCode: timedOut ? null : code,
        stdout: truncateOutput(stdout),
        stderr: truncateOutput(stderr),
        timedOut,
        durationMs: Date.now() - startTime,
      });
    }

    function triggerAbortOrTimeout() {
      if (timedOut) return;
      timedOut = true;
      killProcessTree(child);
      killGraceTimer = setTimeout(() => finish(null), 500);
    }

    const timer = setTimeout(triggerAbortOrTimeout, args.timeout_ms);

    function onAbort() {
      triggerAbortOrTimeout();
    }

    if (ctx.signal) {
      ctx.signal.addEventListener('abort', onAbort, { once: true });
    }

    child.on('error', (err) => {
      stderr += err.message;
      finish(1);
    });

    child.on('close', (code) => {
      finish(code);
    });
  });
}

const runCommandTool = {
  name: 'run_command',
  description: 'Çalışma alanı kök klasöründe kabuk komutu çalıştırır.',
  risk: 'exec',
  jsonSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Çalıştırılacak komut.' },
      timeout_ms: { type: 'integer', description: 'Zaman aşımı süresi (1000..120000 ms, varsayılan 30000).' },
    },
    required: ['command'],
    additionalProperties: false,
  },
  validate,
  execute,
};

module.exports = { runCommandTool };
