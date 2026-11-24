'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { registerAgentIpc } = require('../agentIpc.cjs');
const { createAgentRuntime } = require('../agent/index.cjs');

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
    waitFor(channel, pred = () => true) {
      const found = sent.find((s) => s.channel === channel && pred(s.payload));
      if (found) return Promise.resolve(found.payload);
      return new Promise((resolve) => {
        waiters.push({ match: (c, p) => c === channel && pred(p), resolve });
      });
    },
  };
  return win;
}

// Sahte runtime: her runTurn, test tarafindan kontrol edilen bir Promise doner
function createFakeRuntimeFactory() {
  const created = [];
  const factory = (opts) => {
    const rt = {
      opts,
      session: { plan: [] },
      turns: [],
      runTurn(message, { signal }) {
        let resolve;
        let reject;
        const p = new Promise((res, rej) => {
          resolve = res;
          reject = rej;
        });
        rt.turns.push({ message, signal, resolve, reject });
        return p;
      },
    };
    created.push(rt);
    return rt;
  };
  factory.created = created;
  return factory;
}

function setup({ root = '/proje', win = createMockWindow(), createRuntime } = {}) {
  const ipcMain = createMockIpcMain();
  const state = { root, win };
  const factory = createRuntime || createFakeRuntimeFactory();
  let modelCount = 0;
  registerAgentIpc({
    ipcMain,
    getWindow: () => state.win,
    getWorkspaceRoot: () => state.root,
    createModel: () => ({ id: ++modelCount }),
    sessionDir: '/oturumlar',
    createRuntime: factory,
  });
  return { ipcMain, state, factory, win };
}

const tick = () => new Promise((r) => setImmediate(r));

test('1. agent:start klasor yokken, bos mesajda, gecersiz modda hata dondurur', async () => {
  const { ipcMain, state, factory } = setup({ root: null });
  assert.deepEqual(await ipcMain.invoke('agent:start', { message: 'selam' }), {
    error: 'Önce bir klasör aç.',
  });
  state.root = '/proje';
  assert.deepEqual(await ipcMain.invoke('agent:start', { message: '   ' }), {
    error: 'Mesaj boş olamaz.',
  });
  assert.deepEqual(await ipcMain.invoke('agent:start', {}), { error: 'Mesaj boş olamaz.' });
  assert.deepEqual(await ipcMain.invoke('agent:start', { message: 'selam', mode: 'yolo' }), {
    error: 'Geçersiz onay modu.',
  });
  assert.equal(factory.created.length, 0);
});

test('2. basarili agent:start hemen turnId ve sessionId doner; olaylar ve done gider', async () => {
  const { ipcMain, factory, win } = setup();
  const res = await ipcMain.invoke('agent:start', { message: 'selam' });
  assert.equal(typeof res.turnId, 'string');
  assert.match(res.sessionId, /^s-[0-9a-z]+-[0-9a-zA-Z]{6}$/);

  assert.equal(factory.created.length, 1);
  const rt = factory.created[0];
  assert.equal(rt.opts.rootDir, '/proje');
  assert.equal(rt.opts.sessionDir, '/oturumlar');
  assert.equal(rt.opts.sessionId, res.sessionId);
  assert.equal(rt.opts.mode, 'ask');
  assert.deepEqual(rt.opts.model, { id: 1 });
  assert.equal(typeof rt.opts.requestApproval, 'function');

  await tick();
  assert.equal(rt.turns.length, 1);
  assert.equal(rt.turns[0].message, 'selam');

  rt.opts.onEvent({ type: 'assistant/delta', delta: 'Mer' });
  const ev = win.sent.find((s) => s.channel === 'agent:event');
  assert.deepEqual(ev.payload, { turnId: res.turnId, type: 'assistant/delta', delta: 'Mer' });

  rt.turns[0].resolve({ status: 'completed', text: 'Merhaba', steps: 1, toolCalls: 0 });
  const done = await win.waitFor('agent:done');
  assert.deepEqual(done, {
    turnId: res.turnId,
    status: 'completed',
    text: 'Merhaba',
    steps: 1,
    toolCalls: 0,
  });
  const st = await ipcMain.invoke('agent:state');
  assert.equal(st.running, false);
});

test('3. tur calisirken ikinci agent:start hata dondurur', async () => {
  const { ipcMain } = setup();
  const r1 = await ipcMain.invoke('agent:start', { message: 'bir' });
  assert.ok(r1.turnId);
  assert.deepEqual(await ipcMain.invoke('agent:start', { message: 'iki' }), {
    error: 'Zaten çalışan bir tur var.',
  });
});

test('4. onay: requestApproval bekler, agent:approve ile cozulur; bilinmeyen callId hata', async () => {
  const { ipcMain, factory } = setup();
  await ipcMain.invoke('agent:start', { message: 'yaz' });
  const rt = factory.created[0];

  let settled = null;
  const p = rt.opts.requestApproval({ callId: 'c1', name: 'write_file' }).then((v) => {
    settled = v;
    return v;
  });
  await tick();
  assert.equal(settled, null);

  assert.deepEqual(await ipcMain.invoke('agent:approve', { callId: 'yok', approved: true }), {
    error: 'Bekleyen onay bulunamadı.',
  });
  assert.deepEqual(await ipcMain.invoke('agent:approve', { callId: 'c1', approved: 1 }), { ok: true });
  assert.deepEqual(await p, { approved: true });

  // Ayni callId ikinci kez cozulmez
  assert.deepEqual(await ipcMain.invoke('agent:approve', { callId: 'c1', approved: true }), {
    error: 'Bekleyen onay bulunamadı.',
  });
});

test('5. agent:abort sinyali iptal eder ve bekleyen onaylari approved false ile cozer', async () => {
  const { ipcMain, factory, win } = setup();
  await ipcMain.invoke('agent:start', { message: 'yaz' });
  await tick();
  const rt = factory.created[0];
  const signal = rt.turns[0].signal;
  const a1 = rt.opts.requestApproval({ callId: 'c1' });
  const a2 = rt.opts.requestApproval({ callId: 'c2' });

  assert.deepEqual(await ipcMain.invoke('agent:abort'), { ok: true });
  assert.equal(signal.aborted, true);
  assert.deepEqual(await a1, { approved: false });
  assert.deepEqual(await a2, { approved: false });

  rt.turns[0].resolve({ status: 'aborted', text: '' });
  const done = await win.waitFor('agent:done');
  assert.equal(done.status, 'aborted');

  // Tur yokken de ok
  assert.deepEqual(await ipcMain.invoke('agent:abort'), { ok: true });
});

test('6. ayni klasor ve modda ayni runtime; klasor ya da mod degisince yeni runtime', async () => {
  const { ipcMain, factory, state, win } = setup();
  const finishLast = async () => {
    const rt = factory.created[factory.created.length - 1];
    await tick();
    const turn = rt.turns[rt.turns.length - 1];
    const n = win.sent.filter((s) => s.channel === 'agent:done').length;
    turn.resolve({ status: 'completed', text: 'ok' });
    await win.waitFor('agent:done', () => win.sent.filter((s) => s.channel === 'agent:done').length > n);
  };

  const r1 = await ipcMain.invoke('agent:start', { message: 'bir' });
  await finishLast();
  const r2 = await ipcMain.invoke('agent:start', { message: 'iki', mode: 'ask' });
  await finishLast();
  assert.equal(factory.created.length, 1);
  assert.equal(r1.sessionId, r2.sessionId);
  assert.notEqual(r1.turnId, r2.turnId);
  assert.equal(factory.created[0].turns.length, 2);

  const r3 = await ipcMain.invoke('agent:start', { message: 'uc', mode: 'read-only' });
  await finishLast();
  assert.equal(factory.created.length, 2);
  assert.equal(factory.created[1].opts.mode, 'read-only');
  assert.notEqual(r3.sessionId, r2.sessionId);

  state.root = '/baska';
  await ipcMain.invoke('agent:start', { message: 'dort', mode: 'read-only' });
  await finishLast();
  assert.equal(factory.created.length, 3);
  assert.equal(factory.created[2].opts.rootDir, '/baska');
});

test('7. agent:newSession sonrasi yeni runtime ve yeni sessionId', async () => {
  const { ipcMain, factory, win } = setup();
  const r1 = await ipcMain.invoke('agent:start', { message: 'bir' });
  assert.deepEqual(await ipcMain.invoke('agent:newSession'), { error: 'Zaten çalışan bir tur var.' });
  await tick();
  factory.created[0].turns[0].resolve({ status: 'completed' });
  await win.waitFor('agent:done');

  assert.deepEqual(await ipcMain.invoke('agent:newSession'), { ok: true });
  const st = await ipcMain.invoke('agent:state');
  assert.equal(st.sessionId, null);

  const r2 = await ipcMain.invoke('agent:start', { message: 'iki' });
  assert.equal(factory.created.length, 2);
  assert.notEqual(r1.sessionId, r2.sessionId);
  assert.deepEqual(factory.created[1].opts.model, { id: 2 });
});

test('8. runTurn firlatirsa agent:done failed gider ve sonraki agent:start calisir', async () => {
  const { ipcMain, factory, win } = setup();
  const r1 = await ipcMain.invoke('agent:start', { message: 'bir' });
  await tick();
  factory.created[0].turns[0].reject(new Error('beklenmedik patlama'));
  const done = await win.waitFor('agent:done');
  assert.deepEqual(done, { turnId: r1.turnId, status: 'failed', error: 'beklenmedik patlama' });

  const r2 = await ipcMain.invoke('agent:start', { message: 'iki' });
  assert.ok(r2.turnId);
  assert.equal(r2.error, undefined);
});

test('9. pencere yok edilmisse ya da yoksa olay gonderimi firlatmaz', async () => {
  const { ipcMain, factory, win, state } = setup();
  await ipcMain.invoke('agent:start', { message: 'bir' });
  await tick();
  const rt = factory.created[0];
  win.destroyed = true;
  assert.doesNotThrow(() => rt.opts.onEvent({ type: 'step/start' }));
  state.win = null;
  assert.doesNotThrow(() => rt.opts.onEvent({ type: 'step/start' }));
  assert.equal(win.sent.length, 0);

  rt.turns[0].resolve({ status: 'completed' });
  await tick();
  await tick();
  const st = await ipcMain.invoke('agent:state');
  assert.equal(st.running, false);
});

test('10. agent:state calisma durumunu ve plani dondurur', async () => {
  const { ipcMain, factory, win } = setup();
  assert.deepEqual(await ipcMain.invoke('agent:state'), {
    running: false,
    turnId: null,
    sessionId: null,
    mode: null,
    plan: [],
    model: null,
  });
  const r = await ipcMain.invoke('agent:start', { message: 'bir', mode: 'auto-edit' });
  await tick();
  const rt = factory.created[0];
  rt.session.plan = [{ content: 'Oku', status: 'in_progress' }];
  assert.deepEqual(await ipcMain.invoke('agent:state'), {
    running: true,
    turnId: r.turnId,
    sessionId: r.sessionId,
    mode: 'auto-edit',
    plan: [{ content: 'Oku', status: 'in_progress' }],
    model: null,
  });
  rt.turns[0].resolve({ status: 'completed' });
  await win.waitFor('agent:done');
  const st = await ipcMain.invoke('agent:state');
  assert.equal(st.running, false);
  assert.equal(st.turnId, null);
  assert.equal(st.sessionId, r.sessionId);
});

test('11. uctan uca: gercek runtime, read_file sonra cevap, agent:done completed', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-ipc-ws-'));
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-ipc-session-'));
  try {
    fs.writeFileSync(path.join(rootDir, 'not.txt'), 'gizli kelime: elma\n', 'utf8');
    const modelCalls = [];
    const responses = [
      {
        content: '',
        toolCalls: [{ id: 'call_1', name: 'read_file', arguments: JSON.stringify({ path: 'not.txt' }) }],
        usage: null,
      },
      { content: 'Dosyada elma yazıyor.', toolCalls: [], usage: null },
    ];
    const win = createMockWindow();
    const ipcMain = createMockIpcMain();
    registerAgentIpc({
      ipcMain,
      getWindow: () => win,
      getWorkspaceRoot: () => rootDir,
      sessionDir,
      createModel: () => ({
        async complete(req) {
          modelCalls.push(req);
          return responses[modelCalls.length - 1];
        },
      }),
      createRuntime: createAgentRuntime,
    });

    const res = await ipcMain.invoke('agent:start', { message: 'not.txt ne diyor?' });
    assert.ok(res.turnId);
    const done = await win.waitFor('agent:done');
    assert.equal(done.turnId, res.turnId);
    assert.equal(done.status, 'completed');
    assert.equal(done.text, 'Dosyada elma yazıyor.');
    assert.equal(modelCalls.length, 2);

    const events = win.sent.filter((s) => s.channel === 'agent:event').map((s) => s.payload);
    assert.ok(events.every((e) => e.turnId === res.turnId));
    const toolResult = events.find((e) => e.type === 'tool/result');
    assert.ok(toolResult);
    assert.equal(toolResult.ok, true);
    assert.match(toolResult.content, /elma/);
    assert.equal(events[events.length - 1].type, 'turn/end');
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});


// ---- Aşama 4a: oturum listesi ve sürdürme ----

function setupWithDir({ root = '/proje', sessionDir, createRuntime } = {}) {
  const ipcMain = createMockIpcMain();
  const win = createMockWindow();
  const state = { root, win };
  const factory = createRuntime || createFakeRuntimeFactory();
  let modelCount = 0;
  registerAgentIpc({
    ipcMain,
    getWindow: () => state.win,
    getWorkspaceRoot: () => state.root,
    createModel: () => ({ id: ++modelCount }),
    sessionDir,
    createRuntime: factory,
  });
  return { ipcMain, state, factory, win };
}

function writeSessionFile(dir, id, events) {
  fs.writeFileSync(
    path.join(dir, id + '.jsonl'),
    events.map((e) => JSON.stringify(e)).join('\n') + '\n',
    'utf8'
  );
}

test('12. agent:listSessions oturumlari dondurur; klasor yoksa bos dizi', async () => {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-ipc-list-'));
  try {
    writeSessionFile(sessionDir, 's-a', [
      { seq: 1, type: 'turn/start', at: '2026-03-01T00:00:00.000Z' },
      { seq: 2, type: 'user/message', content: 'ilk oturum', at: '2026-03-01T00:00:01.000Z' },
    ]);
    fs.writeFileSync(path.join(sessionDir, 's-a.meta.json'), JSON.stringify({ root: '/proje' }), 'utf8');
    writeSessionFile(sessionDir, 's-b', [
      { seq: 1, type: 'turn/start', at: '2026-04-01T00:00:00.000Z' },
      { seq: 2, type: 'user/message', content: 'ikinci oturum', at: '2026-04-01T00:00:01.000Z' },
    ]);
    fs.writeFileSync(path.join(sessionDir, 's-b.meta.json'), JSON.stringify({ root: '/proje' }), 'utf8');
    const { ipcMain } = setupWithDir({ sessionDir });
    assert.deepEqual(await ipcMain.invoke('agent:listSessions'), {
      sessions: [
        { sessionId: 's-b', title: 'ikinci oturum', updatedAt: '2026-04-01T00:00:01.000Z', turns: 1 },
        { sessionId: 's-a', title: 'ilk oturum', updatedAt: '2026-03-01T00:00:01.000Z', turns: 1 },
      ],
    });

    const other = setupWithDir({ sessionDir: path.join(sessionDir, 'olmayan') });
    assert.deepEqual(await other.ipcMain.invoke('agent:listSessions'), { sessions: [] });
  } finally {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('13. agent:resume gecersiz kimlik, olmayan oturum, calisan tur ve klasor yok hatalari', async () => {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-ipc-resume-'));
  try {
    writeSessionFile(sessionDir, 's-var', [{ seq: 1, type: 'turn/start', at: '2026-03-01T00:00:00.000Z' }]);
    const { ipcMain, state, factory, win } = setupWithDir({ sessionDir });

    for (const bad of [undefined, null, '', '../s-var', 's var', 'a'.repeat(101), 123]) {
      assert.deepEqual(await ipcMain.invoke('agent:resume', { sessionId: bad }), {
        error: 'Oturum bulunamadı.',
      });
    }
    assert.deepEqual(await ipcMain.invoke('agent:resume'), { error: 'Oturum bulunamadı.' });
    assert.deepEqual(await ipcMain.invoke('agent:resume', { sessionId: 's-yok' }), {
      error: 'Oturum bulunamadı.',
    });

    state.root = null;
    assert.deepEqual(await ipcMain.invoke('agent:resume', { sessionId: 's-var' }), {
      error: 'Önce bir klasör aç.',
    });
    state.root = '/proje';

    await ipcMain.invoke('agent:start', { message: 'bir' });
    assert.deepEqual(await ipcMain.invoke('agent:resume', { sessionId: 's-var' }), {
      error: 'Zaten çalışan bir tur var.',
    });
    await tick();
    factory.created[0].turns[0].resolve({ status: 'completed' });
    await win.waitFor('agent:done');
    assert.equal(factory.created.length, 1);
  } finally {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('14. agent:resume basarida plani dondurur ve sonraki start ayni oturumu kullanir', async () => {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-ipc-resume-'));
  try {
    writeSessionFile(sessionDir, 's-eski_1', [{ seq: 1, type: 'turn/start', at: '2026-03-01T00:00:00.000Z' }]);
    fs.writeFileSync(path.join(sessionDir, 's-eski_1.meta.json'), JSON.stringify({ root: '/proje' }), 'utf8');
    const factory = createFakeRuntimeFactory();
    const wrapped = (opts) => {
      const rt = factory(opts);
      rt.session.plan = [{ content: 'Geri gelen adım', status: 'in_progress' }];
      return rt;
    };
    wrapped.created = factory.created;
    const { ipcMain, win } = setupWithDir({ sessionDir, createRuntime: wrapped });

    const res = await ipcMain.invoke('agent:resume', { sessionId: 's-eski_1', mode: 'auto-edit' });
    assert.deepEqual(res, {
      sessionId: 's-eski_1',
      plan: [{ content: 'Geri gelen adım', status: 'in_progress' }],
    });
    assert.equal(factory.created.length, 1);
    const rt = factory.created[0];
    assert.equal(rt.opts.sessionId, 's-eski_1');
    assert.equal(rt.opts.sessionDir, sessionDir);
    assert.equal(rt.opts.rootDir, '/proje');
    assert.equal(rt.opts.mode, 'auto-edit');
    assert.equal(typeof rt.opts.requestApproval, 'function');
    assert.equal(typeof rt.opts.onEvent, 'function');

    const st = await ipcMain.invoke('agent:state');
    assert.equal(st.sessionId, 's-eski_1');
    assert.equal(st.mode, 'auto-edit');
    assert.deepEqual(st.plan, [{ content: 'Geri gelen adım', status: 'in_progress' }]);

    const start = await ipcMain.invoke('agent:start', { message: 'devam', mode: 'auto-edit' });
    assert.equal(start.sessionId, 's-eski_1');
    assert.equal(factory.created.length, 1);
    await tick();
    assert.equal(rt.turns.length, 1);
    assert.equal(rt.turns[0].message, 'devam');
    rt.turns[0].resolve({ status: 'completed' });
    await win.waitFor('agent:done');

    // mode verilmezse varsayılan ask; geçersiz mod hata
    const res2 = await ipcMain.invoke('agent:resume', { sessionId: 's-eski_1' });
    assert.equal(res2.sessionId, 's-eski_1');
    assert.equal(factory.created[1].opts.mode, 'ask');
    assert.deepEqual(await ipcMain.invoke('agent:resume', { sessionId: 's-eski_1', mode: 'yolo' }), {
      error: 'Geçersiz onay modu.',
    });
  } finally {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('15. uctan uca: gercek runtime ile resume plani ve gecmisi geri getirir', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-ipc-ws-'));
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-ipc-session-'));
  try {
    writeSessionFile(sessionDir, 's-gercek', [
      { seq: 1, type: 'turn/start', at: '2026-03-01T00:00:00.000Z' },
      { seq: 2, type: 'user/message', content: 'eski soru', at: '2026-03-01T00:00:01.000Z' },
      {
        seq: 3,
        type: 'tool/result',
        callId: 'p1',
        name: 'update_plan',
        ok: true,
        content: JSON.stringify({ ok: true, result: { items: [{ content: 'Adım 1', status: 'pending' }] } }),
        at: '2026-03-01T00:00:02.000Z',
      },
      { seq: 4, type: 'assistant/message', content: 'eski cevap', at: '2026-03-01T00:00:03.000Z' },
      { seq: 5, type: 'turn/end', status: 'completed', at: '2026-03-01T00:00:04.000Z' },
    ]);
    fs.writeFileSync(path.join(sessionDir, 's-gercek.meta.json'), JSON.stringify({ root: rootDir }), 'utf8');
    const modelCalls = [];
    const win = createMockWindow();
    const ipcMain = createMockIpcMain();
    registerAgentIpc({
      ipcMain,
      getWindow: () => win,
      getWorkspaceRoot: () => rootDir,
      sessionDir,
      createModel: () => ({
        async complete(req) {
          modelCalls.push(req);
          return { content: 'yeni cevap', toolCalls: [], usage: null };
        },
      }),
      createRuntime: createAgentRuntime,
    });

    const res = await ipcMain.invoke('agent:resume', { sessionId: 's-gercek' });
    assert.deepEqual(res, { sessionId: 's-gercek', plan: [{ content: 'Adım 1', status: 'pending' }] });
    const start = await ipcMain.invoke('agent:start', { message: 'yeni soru' });
    assert.equal(start.sessionId, 's-gercek');
    const done = await win.waitFor('agent:done');
    assert.equal(done.status, 'completed');
    const userMsgs = modelCalls[0].messages.filter((m) => m.role === 'user').map((m) => m.content);
    assert.deepEqual(userMsgs, ['eski soru', 'yeni soru']);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

// ---- Aşama 3b: oturumlari klasore baglama ----

test('16. agent:start ve agent:resume oturum meta.json dosyasini yazar; ayni root varsa dokunmaz', async () => {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-ipc-meta-'));
  try {
    const { ipcMain, factory, win } = setupWithDir({ root: '/proje-a', sessionDir });
    const res = await ipcMain.invoke('agent:start', { message: 'selam' });
    assert.ok(res.sessionId);

    const metaPath = path.join(sessionDir, `${res.sessionId}.meta.json`);
    assert.equal(fs.existsSync(metaPath), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(metaPath, 'utf8')), { root: '/proje-a' });

    await tick();
    factory.created[0].turns[0].resolve({ status: 'completed' });
    await win.waitFor('agent:done');

    // Resume'da ayni root varsa meta dosyasina tekrar yazilmaz (mtime korunur)
    writeSessionFile(sessionDir, res.sessionId, [{ seq: 1, type: 'turn/start', at: '2026-03-01T00:00:00.000Z' }]);
    const beforeMtime = fs.statSync(metaPath).mtimeMs;
    await new Promise((r) => setTimeout(r, 20));
    const resumed = await ipcMain.invoke('agent:resume', { sessionId: res.sessionId });
    assert.equal(resumed.sessionId, res.sessionId);
    const afterMtime = fs.statSync(metaPath).mtimeMs;
    assert.equal(afterMtime, beforeMtime);
  } finally {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('17. agent:listSessions yalnizca acik klasore ait meta.json\'lu oturumlari dondurur', async () => {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-ipc-filter-'));
  try {
    writeSessionFile(sessionDir, 's-a', [
      { seq: 1, type: 'turn/start', at: '2026-03-01T00:00:00.000Z' },
      { seq: 2, type: 'user/message', content: 'A oturumu', at: '2026-03-01T00:00:01.000Z' },
    ]);
    fs.writeFileSync(path.join(sessionDir, 's-a.meta.json'), JSON.stringify({ root: '/proje-a' }), 'utf8');

    writeSessionFile(sessionDir, 's-b', [
      { seq: 1, type: 'turn/start', at: '2026-04-01T00:00:00.000Z' },
      { seq: 2, type: 'user/message', content: 'B oturumu', at: '2026-04-01T00:00:01.000Z' },
    ]);
    fs.writeFileSync(path.join(sessionDir, 's-b.meta.json'), JSON.stringify({ root: '/proje-b' }), 'utf8');

    writeSessionFile(sessionDir, 's-metasiz', [
      { seq: 1, type: 'turn/start', at: '2026-05-01T00:00:00.000Z' },
      { seq: 2, type: 'user/message', content: 'Metasiz', at: '2026-05-01T00:00:01.000Z' },
    ]);

    const { ipcMain, state } = setupWithDir({ root: '/proje-a', sessionDir });
    const listA = await ipcMain.invoke('agent:listSessions');
    assert.equal(listA.sessions.length, 1);
    assert.equal(listA.sessions[0].sessionId, 's-a');

    state.root = null;
    assert.deepEqual(await ipcMain.invoke('agent:listSessions'), { sessions: [] });
  } finally {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('18. agent:resume meta.json yoksa veya root farkliysa reddeder', async () => {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-ipc-reject-'));
  try {
    writeSessionFile(sessionDir, 's-baska', [{ seq: 1, type: 'turn/start', at: '2026-03-01T00:00:00.000Z' }]);
    fs.writeFileSync(path.join(sessionDir, 's-baska.meta.json'), JSON.stringify({ root: '/proje-b' }), 'utf8');

    writeSessionFile(sessionDir, 's-metasiz', [{ seq: 1, type: 'turn/start', at: '2026-03-01T00:00:00.000Z' }]);

    const { ipcMain, factory } = setupWithDir({ root: '/proje-a', sessionDir });
    assert.deepEqual(await ipcMain.invoke('agent:resume', { sessionId: 's-baska' }), {
      error: 'Bu oturum başka bir klasöre ait.',
    });
    assert.deepEqual(await ipcMain.invoke('agent:resume', { sessionId: 's-metasiz' }), {
      error: 'Bu oturum başka bir klasöre ait.',
    });
    assert.equal(factory.created.length, 0);
  } finally {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

// ---- Aşama 4c: tur geri alma ve iz ----

test('19. agent:revertLastTurn hata durumlari, tur calisirken red ve basarili geri alma', async () => {
  const { ipcMain, factory, win } = setup();

  // Runtime yokken
  assert.deepEqual(await ipcMain.invoke('agent:revertLastTurn'), {
    error: 'Önce bir oturum başlat.',
  });

  // Tur calisirken
  await ipcMain.invoke('agent:start', { message: 'yaz' });
  assert.deepEqual(await ipcMain.invoke('agent:revertLastTurn'), {
    error: 'Tur çalışırken geri alınamaz.',
  });

  await tick();
  const rt = factory.created[0];
  rt.turns[0].resolve({ status: 'completed' });
  await win.waitFor('agent:done');

  // Eski cekirdek (revertLastTurn yok)
  assert.deepEqual(await ipcMain.invoke('agent:revertLastTurn'), {
    error: 'Bu sürüm geri almayı desteklemiyor.',
  });

  // Firlatirsa hata metni doner
  rt.revertLastTurn = async () => {
    throw new Error('Geri alınacak değişiklik yok.');
  };
  assert.deepEqual(await ipcMain.invoke('agent:revertLastTurn'), {
    error: 'Geri alınacak değişiklik yok.',
  });

  // Basarili geri alma
  rt.revertLastTurn = async () => ({ turnId: 't1', restored: ['a.ts', 'b.ts'] });
  assert.deepEqual(await ipcMain.invoke('agent:revertLastTurn'), {
    turnId: 't1',
    restored: ['a.ts', 'b.ts'],
  });
});

test('20. agent:trace runtime yokken bos, varken content ve summary 2000 karakterle kisaltilir', async () => {
  const { ipcMain, factory, win } = setup();

  // Runtime yokken
  assert.deepEqual(await ipcMain.invoke('agent:trace'), { events: [] });

  await ipcMain.invoke('agent:start', { message: 'test' });
  await tick();
  const rt = factory.created[0];
  rt.turns[0].resolve({ status: 'completed' });
  await win.waitFor('agent:done');

  const longText = 'a'.repeat(2500);
  const longSummary = 'b'.repeat(2200);
  const rawEvents = [
    { seq: 1, at: '2026-03-01T00:00:00.000Z', type: 'turn/start' },
    { seq: 2, at: '2026-03-01T00:00:01.000Z', type: 'user/message', content: 'kisa' },
    { seq: 3, at: '2026-03-01T00:00:02.000Z', type: 'tool/result', callId: 'c1', name: 'read_file', ok: true, content: longText },
    { seq: 4, at: '2026-03-01T00:00:03.000Z', type: 'context/compact', summary: longSummary, uptoSeq: 3 },
  ];
  rt.log = { read: () => rawEvents };

  const res = await ipcMain.invoke('agent:trace');
  assert.equal(res.events.length, 4);
  assert.equal(res.events[1].content, 'kisa');
  assert.equal(res.events[2].content, 'a'.repeat(2000) + '…');
  assert.equal(res.events[3].summary, 'b'.repeat(2000) + '…');
  // Orijinal olay mutasyona ugramaz
  assert.equal(rawEvents[2].content.length, 2500);
  assert.equal(rawEvents[3].summary.length, 2200);
});

// ---- Aşama 3c: model secimi ----

test('21. agent:listModels basari ve hata durumlarini dondurur', async () => {
  const ipcMain = createMockIpcMain();
  let listResult = {
    models: [
      { id: 'deepseek-chat', provider: 'deepseek', label: 'DeepSeek Chat' },
      { id: 'gpt-5', provider: 'openai', label: 'GPT-5' },
    ],
    default: { id: 'deepseek-chat', provider: 'deepseek' },
  };
  let shouldThrow = false;

  registerAgentIpc({
    ipcMain,
    getWindow: () => createMockWindow(),
    getWorkspaceRoot: () => '/proje',
    createModel: () => ({
      setSelection() {},
      async listModels() {
        if (shouldThrow) throw new Error('Modeller alınamadı.');
        return listResult;
      },
    }),
    sessionDir: '/oturumlar',
    createRuntime: createFakeRuntimeFactory(),
  });

  const ok = await ipcMain.invoke('agent:listModels');
  assert.deepEqual(ok, {
    ...listResult,
    selected: null,
  });

  shouldThrow = true;
  const err = await ipcMain.invoke('agent:listModels');
  assert.deepEqual(err, { error: 'Modeller alınamadı.' });
});

test('22. agent:setModel yeni ve var olan runtime a uygulanir, calisirken ve gecersiz giriste reddeder, agent:state dondurur', async () => {
  const ipcMain = createMockIpcMain();
  const win = createMockWindow();
  const factory = createFakeRuntimeFactory();
  const models = [];

  registerAgentIpc({
    ipcMain,
    getWindow: () => win,
    getWorkspaceRoot: () => '/proje',
    createModel: () => {
      const m = {
        selection: null,
        setSelection(sel) {
          m.selection = sel;
        },
        async listModels() {
          return { models: [{ id: 'm1', provider: 'p1', label: 'M1' }], default: { id: 'm1', provider: 'p1' } };
        },
      };
      models.push(m);
      return m;
    },
    sessionDir: '/oturumlar',
    createRuntime: factory,
  });

  // Baslangicta state.model null
  let st = await ipcMain.invoke('agent:state');
  assert.equal(st.model, null);

  // Gecersiz girisler
  assert.deepEqual(await ipcMain.invoke('agent:setModel', 'kotu'), { error: 'Geçersiz model.' });
  assert.deepEqual(await ipcMain.invoke('agent:setModel', { model: 123, provider: 'p1' }), { error: 'Geçersiz model.' });
  assert.deepEqual(await ipcMain.invoke('agent:setModel', { model: '', provider: 'p1' }), { error: 'Geçersiz model.' });
  assert.deepEqual(await ipcMain.invoke('agent:setModel', { model: 'm1' }), { error: 'Geçersiz model.' });

  // Runtime yokken secim yapilir, sonraki yeni runtime a uygulanir
  assert.deepEqual(await ipcMain.invoke('agent:setModel', { model: 'm1', provider: 'p1' }), {
    ok: true,
    selected: { model: 'm1', provider: 'p1' },
  });
  st = await ipcMain.invoke('agent:state');
  assert.deepEqual(st.model, { model: 'm1', provider: 'p1' });

  const listed = await ipcMain.invoke('agent:listModels');
  assert.deepEqual(listed.selected, { model: 'm1', provider: 'p1' });

  await ipcMain.invoke('agent:start', { message: 'merhaba' });
  await tick();
  assert.equal(factory.created.length, 1);
  assert.deepEqual(factory.created[0].opts.model.selection, { model: 'm1', provider: 'p1' });

  // Tur calisirken reddedilir
  assert.deepEqual(await ipcMain.invoke('agent:setModel', null), {
    error: 'Tur çalışırken model değiştirilemez.',
  });

  // Tur bitince var olan runtime a da uygulanir
  factory.created[0].turns[0].resolve({ status: 'completed', text: 'ok' });
  await win.waitFor('agent:done');

  assert.deepEqual(await ipcMain.invoke('agent:setModel', { model: 'm2', provider: 'p2' }), {
    ok: true,
    selected: { model: 'm2', provider: 'p2' },
  });
  assert.deepEqual(factory.created[0].opts.model.selection, { model: 'm2', provider: 'p2' });

  assert.deepEqual(await ipcMain.invoke('agent:setModel', null), {
    ok: true,
    selected: null,
  });
  assert.equal(factory.created[0].opts.model.selection, null);
  st = await ipcMain.invoke('agent:state');
  assert.equal(st.model, null);
});
