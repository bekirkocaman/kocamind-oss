'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');

const { registerTerminalIpc } = require('../terminalIpc.cjs');

function createMockIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, fn) {
      handlers.set(channel, fn);
    },
    invoke(channel, ...args) {
      const fn = handlers.get(channel);
      if (!fn) throw new Error(`Handler bulunamadı: ${channel}`);
      return fn({}, ...args);
    },
  };
}

function createMockWindow() {
  const sent = [];
  const waiters = [];
  const win = {
    destroyed: false,
    sent,
    isDestroyed() {
      return this.destroyed;
    },
    webContents: {
      send(channel, payload) {
        sent.push({ channel, payload });
        for (const w of [...waiters]) {
          if (w.match(channel, payload)) {
            waiters.splice(waiters.indexOf(w), 1);
            w.resolve(payload);
          }
        }
      },
    },
    waitFor(channel, pred = () => true, timeoutMs = 5000) {
      const found = sent.find((s) => s.channel === channel && pred(s.payload));
      if (found) return Promise.resolve(found.payload);
      return new Promise((resolve, reject) => {
        const entry = {
          match: (c, p) => c === channel && pred(p),
          resolve: (val) => {
            clearTimeout(timer);
            resolve(val);
          },
        };
        const timer = setTimeout(() => {
          const idx = waiters.indexOf(entry);
          if (idx >= 0) waiters.splice(idx, 1);
          reject(new Error(`Zaman aşımı: ${channel}`));
        }, timeoutMs);
        waiters.push(entry);
      });
    },
  };
  return win;
}

function setup({ root = os.tmpdir(), win = createMockWindow(), maxOutputBytes } = {}) {
  const ipcMain = createMockIpcMain();
  const state = { root, win };
  const api = registerTerminalIpc({
    ipcMain,
    getWindow: () => state.win,
    getWorkspaceRoot: () => state.root,
    ...(maxOutputBytes !== undefined ? { maxOutputBytes } : {}),
  });
  return { ipcMain, state, win, killAll: api.killAll };
}

test('1. stdout ve stderr parcalari runId ile gelir; cikis kodu dogru', async () => {
  const { ipcMain, win, killAll } = setup();
  try {
    const res = await ipcMain.invoke('terminal:run', {
      command: 'node -e "process.stdout.write(\'merhaba\\n\'); process.stderr.write(\'uyari\\n\'); process.exit(3)"',
    });
    assert.ok(res.runId);
    const exit = await win.waitFor('terminal:exit', (p) => p.runId === res.runId);
    assert.equal(exit.code, 3);
    assert.equal(exit.killed, false);
    assert.equal(typeof exit.durationMs, 'number');

    const dataEvents = win.sent.filter((s) => s.channel === 'terminal:data' && s.payload.runId === res.runId);
    const out = dataEvents.filter((d) => d.payload.stream === 'stdout').map((d) => d.payload.text).join('');
    const err = dataEvents.filter((d) => d.payload.stream === 'stderr').map((d) => d.payload.text).join('');
    assert.match(out, /merhaba/);
    assert.match(err, /uyari/);
  } finally {
    killAll();
  }
});

test('2. ikinci es zamanli run reddedilir ve terminal:state running doner', async () => {
  const { ipcMain, win, killAll } = setup();
  try {
    const initialState = await ipcMain.invoke('terminal:state');
    assert.deepEqual(initialState, { running: false, runId: null });

    const first = await ipcMain.invoke('terminal:run', {
      command: 'node -e "setTimeout(() => {}, 5000)"',
    });
    assert.ok(first.runId);

    const runningState = await ipcMain.invoke('terminal:state');
    assert.deepEqual(runningState, { running: true, runId: first.runId });

    const second = await ipcMain.invoke('terminal:run', { command: 'node -e "console.log(1)"' });
    assert.equal(second.error, 'Zaten çalışan bir komut var.');

    await ipcMain.invoke('terminal:kill');
    await win.waitFor('terminal:exit', (p) => p.runId === first.runId);
  } finally {
    killAll();
  }
});

test('3. kill uzun suren komutu durdurur (killed: true); calisan yokken de ok doner', async () => {
  const { ipcMain, win, killAll } = setup();
  try {
    const idleKill = await ipcMain.invoke('terminal:kill');
    assert.deepEqual(idleKill, { ok: true });

    const res = await ipcMain.invoke('terminal:run', {
      command: 'node -e "setInterval(() => {}, 1000)"',
    });
    assert.ok(res.runId);

    const killRes = await ipcMain.invoke('terminal:kill');
    assert.deepEqual(killRes, { ok: true });

    const exit = await win.waitFor('terminal:exit', (p) => p.runId === res.runId);
    assert.equal(exit.killed, true);

    const afterState = await ipcMain.invoke('terminal:state');
    assert.deepEqual(afterState, { running: false, runId: null });
  } finally {
    killAll();
  }
});

test('4. klasor yokken hata dondurur', async () => {
  const { ipcMain } = setup({ root: null });
  const res = await ipcMain.invoke('terminal:run', { command: 'echo selam' });
  assert.equal(res.error, 'Önce bir klasör aç.');
});

test('5. bos veya cok uzun komut hatasi', async () => {
  const { ipcMain } = setup();
  assert.equal((await ipcMain.invoke('terminal:run', { command: '' })).error, 'Komut geçersiz.');
  assert.equal((await ipcMain.invoke('terminal:run', { command: '   ' })).error, 'Komut geçersiz.');
  assert.equal((await ipcMain.invoke('terminal:run', { command: null })).error, 'Komut geçersiz.');
  assert.equal((await ipcMain.invoke('terminal:run', { command: 'a'.repeat(10001) })).error, 'Komut geçersiz.');
});

test('6. pencere yok edilmisken veya null iken firlatmaz', async () => {
  const { ipcMain, state, win, killAll } = setup();
  try {
    win.destroyed = true;
    const res1 = await ipcMain.invoke('terminal:run', {
      command: 'node -e "console.log(123)"',
    });
    assert.ok(res1.runId);
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(win.sent.length, 0);

    state.win = null;
    const res2 = await ipcMain.invoke('terminal:run', {
      command: 'node -e "console.log(456)"',
    });
    assert.ok(res2.runId);
    await new Promise((r) => setTimeout(r, 250));
  } finally {
    killAll();
  }
});

test('7. kucuk maxOutputBytes ile cikti siniri asilinca durdurulur ve uyari gonderilir', async () => {
  const { ipcMain, win, killAll } = setup({ maxOutputBytes: 64 });
  try {
    const res = await ipcMain.invoke('terminal:run', {
      command: 'node -e "console.log(\'x\'.repeat(500)); setInterval(() => {}, 1000)"',
    });
    assert.ok(res.runId);

    const exit = await win.waitFor('terminal:exit', (p) => p.runId === res.runId);
    assert.equal(exit.killed, true);

    const stderrText = win.sent
      .filter((s) => s.channel === 'terminal:data' && s.payload.runId === res.runId && s.payload.stream === 'stderr')
      .map((s) => s.payload.text)
      .join('');
    assert.ok(stderrText.includes('[Çıktı sınırı aşıldı, komut durduruldu.]'));
  } finally {
    killAll();
  }
});
