'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SESSION_ID_RE = /^[A-Za-z0-9_-]+$/;
const MISSING_TOOL_RESULT_JSON = '{"ok":false,"error":"Araç sonucu yok (tur yarıda kaldı)."}';

function normalizeToolCall(tc) {
  if (tc && tc.type === 'function' && tc.function) {
    const out = {
      id: tc.id,
      type: 'function',
      function: {
        name: tc.function.name,
        arguments:
          typeof tc.function.arguments === 'string'
            ? tc.function.arguments
            : JSON.stringify(tc.function.arguments ?? {}),
      },
    };
    if (tc.extra_content && typeof tc.extra_content === 'object' && !Array.isArray(tc.extra_content)) {
      out.extra_content = tc.extra_content;
    }
    return out;
  }
  const out = {
    id: tc.id,
    type: 'function',
    function: {
      name: tc.name,
      arguments:
        typeof tc.arguments === 'string'
          ? tc.arguments
          : JSON.stringify(tc.arguments ?? {}),
    },
  };
  if (tc && tc.extra_content && typeof tc.extra_content === 'object' && !Array.isArray(tc.extra_content)) {
    out.extra_content = tc.extra_content;
  }
  return out;
}

const SUMMARY_PREFIX = '[Önceki konuşmanın özeti]\n';
const SUMMARY_ACK = 'Anladım, özetten devam ediyorum.';
const UNTITLED = 'Adsız oturum';
const MAX_TITLE_LEN = 60;
const MAX_LISTED_SESSIONS = 100;

function findLastCompact(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev && typeof ev === 'object' && ev.type === 'context/compact') return ev;
  }
  return null;
}

function deriveMessages(events = []) {
  if (!Array.isArray(events)) events = [];
  const messages = [];
  let pendingCallIds = [];

  // Son özet varsa sınıra kadarki olaylar yerine özet kullanılır
  const compact = findLastCompact(events);
  const hasCompact = Boolean(compact) && typeof compact.uptoSeq === 'number';
  const knownCallIds = new Set();
  if (hasCompact) {
    events = events.filter(
      (ev) => !(ev && typeof ev.seq === 'number' && ev.seq <= compact.uptoSeq)
    );
    messages.push({ role: 'user', content: SUMMARY_PREFIX + (compact.summary ?? '') });
    messages.push({ role: 'assistant', content: SUMMARY_ACK });
  }

  function flushPendingCalls() {
    for (const callId of pendingCallIds) {
      messages.push({
        role: 'tool',
        tool_call_id: callId,
        content: MISSING_TOOL_RESULT_JSON,
      });
    }
    pendingCallIds = [];
  }

  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;

    if (ev.type === 'user/message') {
      flushPendingCalls();
      messages.push({
        role: 'user',
        content: ev.content ?? '',
      });
    } else if (ev.type === 'assistant/message') {
      flushPendingCalls();
      const rawCalls = Array.isArray(ev.tool_calls) ? ev.tool_calls : [];
      const normalizedCalls = rawCalls.map(normalizeToolCall);
      const msg = {
        role: 'assistant',
        content: ev.content ?? '',
      };
      if (normalizedCalls.length > 0) {
        msg.tool_calls = normalizedCalls;
        pendingCallIds = normalizedCalls.map((c) => c.id);
        for (const c of normalizedCalls) knownCallIds.add(c.id);
      }
      messages.push(msg);
    } else if (ev.type === 'tool/result') {
      const callId = ev.tool_call_id ?? ev.callId;
      // Sınırdan sonra sahibi geçmişte olmayan araç sonucu atılır
      if (hasCompact && !knownCallIds.has(callId)) continue;
      pendingCallIds = pendingCallIds.filter((id) => id !== callId);
      messages.push({
        role: 'tool',
        tool_call_id: callId,
        content:
          typeof ev.content === 'string'
            ? ev.content
            : JSON.stringify(ev.content ?? {}),
      });
    }
  }

  flushPendingCalls();
  return messages;
}

function parseJsonl(raw) {
  const events = [];
  for (const line of String(raw).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        events.push(parsed);
      }
    } catch {
      // Bozuk satırları atla
    }
  }
  return events;
}

function createSessionLog({ dir, sessionId, now = () => new Date() } = {}) {
  if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) {
    throw new Error('Geçersiz oturum kimliği.');
  }
  if (typeof dir !== 'string' || dir.trim() === '') {
    throw new Error('Geçersiz oturum klasörü.');
  }

  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${sessionId}.jsonl`);

  function read() {
    if (!fs.existsSync(filePath)) return [];
    return parseJsonl(fs.readFileSync(filePath, 'utf8'));
  }

  let lastSeq = 0;
  const existing = read();
  for (const ev of existing) {
    if (typeof ev.seq === 'number' && ev.seq > lastSeq) {
      lastSeq = ev.seq;
    }
  }

  function append(event) {
    if (!event || typeof event !== 'object' || typeof event.type !== 'string' || !event.type) {
      throw new Error('Olay türü (type) zorunludur.');
    }
    lastSeq += 1;
    const rawNow = now();
    const at = rawNow instanceof Date ? rawNow.toISOString() : new Date(rawNow).toISOString();
    const record = {
      ...event,
      seq: lastSeq,
      at,
    };
    fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf8');
    return record;
  }

  return {
    path: filePath,
    append,
    read,
  };
}

// Diske yazmayan kayıt (alt agent'lar için); createSessionLog ile aynı davranış
function createMemoryLog({ now = () => new Date() } = {}) {
  const events = [];
  let lastSeq = 0;

  function append(event) {
    if (!event || typeof event !== 'object' || typeof event.type !== 'string' || !event.type) {
      throw new Error('Olay türü (type) zorunludur.');
    }
    lastSeq += 1;
    const rawNow = now();
    const at = rawNow instanceof Date ? rawNow.toISOString() : new Date(rawNow).toISOString();
    const record = {
      ...event,
      seq: lastSeq,
      at,
    };
    events.push(record);
    return record;
  }

  function read() {
    return events.slice();
  }

  return {
    path: null,
    append,
    read,
  };
}

function summarizeSessionFile(sessionId, events) {
  let title = null;
  let turns = 0;
  for (const ev of events) {
    if (ev.type === 'turn/start') turns += 1;
    if (title === null && ev.type === 'user/message') {
      const oneLine = String(ev.content ?? '').replace(/\s+/g, ' ').trim();
      title = oneLine ? oneLine.slice(0, MAX_TITLE_LEN) : '';
    }
  }
  const last = events[events.length - 1];
  return {
    sessionId,
    title: title || UNTITLED,
    updatedAt: typeof last.at === 'string' ? last.at : null,
    turns,
  };
}

function listSessions(dir) {
  if (typeof dir !== 'string' || !dir) return [];
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const sessions = [];
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    const sessionId = name.slice(0, -'.jsonl'.length);
    if (!SESSION_ID_RE.test(sessionId)) continue;
    let events;
    try {
      events = parseJsonl(fs.readFileSync(path.join(dir, name), 'utf8'));
    } catch {
      continue; // Okunamayan dosya atlanır
    }
    if (events.length === 0) continue; // Hiç geçerli olay yoksa listelenmez
    sessions.push(summarizeSessionFile(sessionId, events));
  }
  sessions.sort((a, b) => {
    const ax = a.updatedAt || '';
    const bx = b.updatedAt || '';
    if (ax === bx) return a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0;
    return ax < bx ? 1 : -1;
  });
  return sessions.slice(0, MAX_LISTED_SESSIONS);
}

function restorePlan(events) {
  if (!Array.isArray(events)) return [];
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (!ev || ev.type !== 'tool/result' || ev.name !== 'update_plan' || ev.ok !== true) continue;
    let out = null;
    if (typeof ev.content === 'string') {
      try {
        out = JSON.parse(ev.content);
      } catch {
        out = null;
      }
    } else if (ev.content && typeof ev.content === 'object') {
      out = ev.content;
    }
    const items = out && out.result && typeof out.result === 'object' ? out.result.items : null;
    return Array.isArray(items) ? items : [];
  }
  return [];
}

module.exports = { createSessionLog, createMemoryLog, deriveMessages, listSessions, restorePlan };
