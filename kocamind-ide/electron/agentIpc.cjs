'use strict';

// Arayuz ile agent cekirdegi arasindaki Electron ana surec koprusu.

const fs = require('node:fs');
const path = require('node:path');
const { listSessions } = require('./agent/sessionLog.cjs');

const VALID_MODES = new Set(['ask', 'auto-edit', 'read-only']);
const RESUME_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function randomSuffix(len = 6) {
  let s = '';
  for (let i = 0; i < len; i++) {
    s += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
  }
  return s;
}

function newSessionId() {
  return 's-' + Date.now().toString(36) + '-' + randomSuffix(6);
}

let turnCounter = 0;
function newTurnId() {
  turnCounter += 1;
  return 't-' + Date.now().toString(36) + '-' + turnCounter.toString(36) + randomSuffix(4);
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function errorMessage(err) {
  if (err && typeof err.message === 'string' && err.message) return err.message;
  return String(err || 'Bilinmeyen hata.');
}

function readSessionMeta(sessionDir, sid) {
  if (typeof sessionDir !== 'string' || !sessionDir) return null;
  try {
    const raw = fs.readFileSync(path.join(sessionDir, `${sid}.meta.json`), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.root === 'string') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function writeSessionMeta(sessionDir, sid, root) {
  if (typeof sessionDir !== 'string' || !sessionDir) return;
  try {
    const existing = readSessionMeta(sessionDir, sid);
    if (existing && existing.root === root) return;
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, `${sid}.meta.json`), JSON.stringify({ root }), 'utf8');
  } catch {}
}

function registerAgentIpc({
  ipcMain,
  getWindow,
  getWorkspaceRoot,
  createModel,
  sessionDir,
  createRuntime = require('./agent/index.cjs').createAgentRuntime,
}) {
  // Durum (tek pencere varsayimi)
  let runtime = null;
  let runtimeModel = null;
  let runtimeRoot = null;
  let runtimeMode = null;
  let sessionId = null;
  let selection = null;
  let current = null; // { turnId, controller }
  const pendingApprovals = new Map(); // callId -> resolve

  function buildModel() {
    const m = createModel();
    if (m && typeof m.setSelection === 'function') {
      m.setSelection(selection);
    }
    return m;
  }

  function send(channel, payload) {
    try {
      const win = typeof getWindow === 'function' ? getWindow() : null;
      if (!win || (typeof win.isDestroyed === 'function' && win.isDestroyed())) return;
      const wc = win.webContents;
      if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) return;
      wc.send(channel, payload);
    } catch {}
  }

  function rejectAllApprovals() {
    const resolvers = [...pendingApprovals.values()];
    pendingApprovals.clear();
    for (const resolve of resolvers) resolve({ approved: false });
  }

  function onEvent(event) {
    const turnId = current ? current.turnId : null;
    send('agent:event', { turnId, ...event });
  }

  function requestApproval(req) {
    const callId = req && req.callId;
    return new Promise((resolve) => {
      // Tur iptal edildiyse hemen reddet
      if (!current || current.controller.signal.aborted) {
        resolve({ approved: false });
        return;
      }
      const prev = pendingApprovals.get(callId);
      if (prev) prev({ approved: false });
      pendingApprovals.set(callId, resolve);
    });
  }

  function safeHandle(channel, fn) {
    ipcMain.handle(channel, async (event, arg) => {
      try {
        return await fn(arg, event);
      } catch (err) {
        return { error: errorMessage(err) };
      }
    });
  }

  safeHandle('agent:start', (arg) => {
    const { message, mode: rawMode } = arg || {};
    const mode = rawMode === undefined || rawMode === null ? 'ask' : rawMode;
    if (!VALID_MODES.has(mode)) return { error: 'Geçersiz onay modu.' };
    if (typeof message !== 'string' || !message.trim()) return { error: 'Mesaj boş olamaz.' };
    const root = typeof getWorkspaceRoot === 'function' ? getWorkspaceRoot() : null;
    if (!root) return { error: 'Önce bir klasör aç.' };
    if (current) return { error: 'Zaten çalışan bir tur var.' };

    if (!runtime || runtimeRoot !== root || runtimeMode !== mode) {
      const sid = newSessionId();
      const model = buildModel();
      runtime = createRuntime({
        rootDir: root,
        sessionDir,
        sessionId: sid,
        model,
        mode,
        requestApproval,
        onEvent,
      });
      runtimeModel = model;
      runtimeRoot = root;
      runtimeMode = mode;
      sessionId = sid;
      writeSessionMeta(sessionDir, sid, root);
    }

    const turnId = newTurnId();
    const controller = new AbortController();
    current = { turnId, controller };
    const rt = runtime;

    // Tur arka planda calisir
    Promise.resolve()
      .then(() => rt.runTurn(message, { signal: controller.signal }))
      .then(
        (result) => ({ turnId, ...(result && typeof result === 'object' ? result : {}) }),
        (err) => ({ turnId, status: 'failed', error: errorMessage(err) })
      )
      .then((donePayload) => {
        if (current && current.turnId === turnId) {
          current = null;
          rejectAllApprovals();
        }
        send('agent:done', donePayload);
      });

    return { turnId, sessionId };
  });

  safeHandle('agent:approve', (arg) => {
    const { callId, approved } = arg || {};
    const resolve = pendingApprovals.get(callId);
    if (!resolve) return { error: 'Bekleyen onay bulunamadı.' };
    pendingApprovals.delete(callId);
    resolve({ approved: Boolean(approved) });
    return { ok: true };
  });

  safeHandle('agent:abort', () => {
    if (current) {
      current.controller.abort();
      rejectAllApprovals();
    }
    return { ok: true };
  });

  safeHandle('agent:newSession', () => {
    if (current) return { error: 'Zaten çalışan bir tur var.' };
    runtime = null;
    runtimeModel = null;
    runtimeRoot = null;
    runtimeMode = null;
    sessionId = null;
    return { ok: true };
  });

  safeHandle('agent:listSessions', () => {
    const root = typeof getWorkspaceRoot === 'function' ? getWorkspaceRoot() : null;
    if (!root) return { sessions: [] };
    const sessions = listSessions(sessionDir).filter((s) => {
      const meta = readSessionMeta(sessionDir, s.sessionId);
      return meta && meta.root === root;
    });
    return { sessions };
  });

  safeHandle('agent:resume', (arg) => {
    const { sessionId: rawId, mode: rawMode } = arg || {};
    if (
      typeof rawId !== 'string' ||
      !RESUME_ID_RE.test(rawId) ||
      typeof sessionDir !== 'string' ||
      !sessionDir ||
      !isFile(path.join(sessionDir, `${rawId}.jsonl`))
    ) {
      return { error: 'Oturum bulunamadı.' };
    }
    if (current) return { error: 'Zaten çalışan bir tur var.' };
    const root = typeof getWorkspaceRoot === 'function' ? getWorkspaceRoot() : null;
    if (!root) return { error: 'Önce bir klasör aç.' };
    const meta = readSessionMeta(sessionDir, rawId);
    if (!meta || meta.root !== root) {
      return { error: 'Bu oturum başka bir klasöre ait.' };
    }
    const mode = rawMode === undefined || rawMode === null ? 'ask' : rawMode;
    if (!VALID_MODES.has(mode)) return { error: 'Geçersiz onay modu.' };

    const model = buildModel();
    const rt = createRuntime({
      rootDir: root,
      sessionDir,
      sessionId: rawId,
      model,
      mode,
      requestApproval,
      onEvent,
    });
    runtime = rt;
    runtimeModel = model;
    runtimeRoot = root;
    runtimeMode = mode;
    sessionId = rawId;
    writeSessionMeta(sessionDir, rawId, root);
    const plan = (rt && rt.session && rt.session.plan) ?? [];
    return { sessionId: rawId, plan };
  });

  safeHandle('agent:listModels', async () => {
    const model = runtimeModel || createModel();
    const res = await model.listModels();
    return {
      models: Array.isArray(res && res.models) ? res.models : [],
      default: (res && res.default) || null,
      selected: selection,
    };
  });

  safeHandle('agent:setModel', (arg) => {
    if (current) return { error: 'Tur çalışırken model değiştirilemez.' };
    if (arg !== null) {
      if (
        !arg ||
        typeof arg !== 'object' ||
        typeof arg.model !== 'string' ||
        !arg.model ||
        typeof arg.provider !== 'string' ||
        !arg.provider
      ) {
        return { error: 'Geçersiz model.' };
      }
      selection = { model: arg.model, provider: arg.provider };
    } else {
      selection = null;
    }
    if (runtimeModel && typeof runtimeModel.setSelection === 'function') {
      runtimeModel.setSelection(selection);
    }
    return { ok: true, selected: selection };
  });

  safeHandle('agent:state', () => ({
    running: Boolean(current),
    turnId: current ? current.turnId : null,
    sessionId: runtime ? sessionId : null,
    mode: runtime ? runtimeMode : null,
    plan: (runtime && runtime.session && runtime.session.plan) ?? [],
    model: selection,
  }));

  safeHandle('agent:revertLastTurn', async () => {
    if (!runtime) return { error: 'Önce bir oturum başlat.' };
    if (current) return { error: 'Tur çalışırken geri alınamaz.' };
    if (typeof runtime.revertLastTurn !== 'function') {
      return { error: 'Bu sürüm geri almayı desteklemiyor.' };
    }
    return await runtime.revertLastTurn();
  });

  safeHandle('agent:trace', () => {
    if (!runtime) return { events: [] };
    const raw = runtime.log && typeof runtime.log.read === 'function' ? runtime.log.read() : [];
    const clip = (val) => (typeof val === 'string' && val.length > 2000 ? val.slice(0, 2000) + '…' : val);
    const events = raw.map((ev) => {
      if (!ev || typeof ev !== 'object') return ev;
      const copy = { ...ev };
      if (typeof copy.content === 'string') {
        copy.content = clip(copy.content);
      }
      if (copy.type === 'context/compact' && typeof copy.summary === 'string') {
        copy.summary = clip(copy.summary);
      }
      return copy;
    });
    return { events };
  });
}

module.exports = { registerAgentIpc };
