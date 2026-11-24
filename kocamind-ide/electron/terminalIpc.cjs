'use strict';

const crypto = require('node:crypto');
const defaultChildProcess = require('node:child_process');

const MAX_COMMAND_LENGTH = 10000;
const OUTPUT_LIMIT_NOTICE = '\n[Çıktı sınırı aşıldı, komut durduruldu.]\n';

/** @type {Set<() => void>} */
const activeKillers = new Set();

function killAll() {
  for (const killer of [...activeKillers]) {
    try {
      killer();
    } catch {
      // yoksay
    }
  }
}

function registerTerminalIpc({
  ipcMain,
  getWindow,
  getWorkspaceRoot,
  spawnImpl = defaultChildProcess.spawn,
  platform = process.platform,
  maxOutputBytes = 5 * 1024 * 1024,
}) {
  /** @type {null | { runId: string; child: any; killed: boolean; killTree: () => void }} */
  let activeRun = null;

  function safeSend(channel, payload) {
    try {
      const win = typeof getWindow === 'function' ? getWindow() : null;
      if (!win) return;
      if (typeof win.isDestroyed === 'function' && win.isDestroyed()) return;
      if (win.webContents && typeof win.webContents.send === 'function') {
        win.webContents.send(channel, payload);
      }
    } catch {
      // pencere kapanmis olabilir
    }
  }

  function killProcessTree(child) {
    if (!child || !child.pid) return;
    if (platform === 'win32') {
      try {
        const killer = spawnImpl('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
          stdio: 'ignore',
          windowsHide: true,
        });
        if (killer && typeof killer.unref === 'function') killer.unref();
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          // yoksay
        }
      }
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          // yoksay
        }
      }
    }
  }

  const instanceKillAll = () => {
    if (activeRun) {
      activeRun.killTree();
    }
  };
  activeKillers.add(instanceKillAll);

  ipcMain.handle('terminal:run', async (_event, payload) => {
    try {
      const command = payload && typeof payload === 'object' ? payload.command : undefined;
      if (
        typeof command !== 'string' ||
        command.trim() === '' ||
        command.length > MAX_COMMAND_LENGTH
      ) {
        return { error: 'Komut geçersiz.' };
      }

      const root = typeof getWorkspaceRoot === 'function' ? getWorkspaceRoot() : null;
      if (!root) {
        return { error: 'Önce bir klasör aç.' };
      }

      if (activeRun) {
        return { error: 'Zaten çalışan bir komut var.' };
      }

      const runId = crypto.randomUUID();
      const startTime = Date.now();
      const isWin = platform === 'win32';
      const file = isWin ? 'cmd.exe' : '/bin/sh';
      const spawnArgs = isWin ? ['/d', '/s', '/c', `"${command}"`] : ['-c', command];

      const child = spawnImpl(file, spawnArgs, {
        cwd: root,
        env: { ...process.env, FORCE_COLOR: '1' },
        shell: false,
        windowsHide: true,
        ...(isWin ? { windowsVerbatimArguments: true } : { detached: true }),
      });

      let totalBytes = 0;
      let limitExceeded = false;
      let finished = false;
      let killGraceTimer = null;

      const runEntry = {
        runId,
        child,
        killed: false,
        killTree: () => {
          if (runEntry.killed) return;
          runEntry.killed = true;
          killProcessTree(child);
          if (!killGraceTimer && !finished) {
            killGraceTimer = setTimeout(() => {
              finish(null, 'SIGKILL');
            }, 1500);
            if (typeof killGraceTimer.unref === 'function') killGraceTimer.unref();
          }
        },
      };
      activeRun = runEntry;

      function finish(code, signal) {
        if (finished) return;
        finished = true;
        if (killGraceTimer) {
          clearTimeout(killGraceTimer);
          killGraceTimer = null;
        }
        if (activeRun && activeRun.runId === runId) {
          activeRun = null;
        }
        safeSend('terminal:exit', {
          runId,
          code: runEntry.killed ? null : code,
          signal: signal ?? null,
          durationMs: Date.now() - startTime,
          killed: runEntry.killed,
        });
      }

      function handleChunk(stream, chunk) {
        if (finished || limitExceeded) return;
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
        totalBytes += buf.length;
        if (totalBytes > maxOutputBytes) {
          limitExceeded = true;
          safeSend('terminal:data', {
            runId,
            stream: 'stderr',
            text: OUTPUT_LIMIT_NOTICE,
          });
          runEntry.killTree();
          return;
        }
        safeSend('terminal:data', {
          runId,
          stream,
          text: buf.toString('utf8'),
        });
      }

      if (child.stdout) {
        child.stdout.on('data', (chunk) => handleChunk('stdout', chunk));
      }
      if (child.stderr) {
        child.stderr.on('data', (chunk) => handleChunk('stderr', chunk));
      }

      child.on('error', (err) => {
        if (!finished) {
          safeSend('terminal:data', {
            runId,
            stream: 'stderr',
            text: `${err.message}\n`,
          });
        }
        finish(1, null);
      });

      child.on('close', (code, signal) => {
        finish(code, signal);
      });

      return { runId };
    } catch {
      return { error: 'Komut başlatılamadı.' };
    }
  });

  ipcMain.handle('terminal:kill', async () => {
    try {
      if (activeRun) {
        activeRun.killTree();
      }
      return { ok: true };
    } catch {
      return { error: 'Komut durdurulamadı.' };
    }
  });

  ipcMain.handle('terminal:state', async () => {
    try {
      return {
        running: Boolean(activeRun),
        runId: activeRun ? activeRun.runId : null,
      };
    } catch {
      return { error: 'Terminal durumu alınamadı.' };
    }
  });

  return { killAll: instanceKillAll };
}

module.exports = { registerTerminalIpc, killAll };
