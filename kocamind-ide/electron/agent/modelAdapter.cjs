'use strict';

// Agent dongusunun model.complete arayuzunu backend /ide/complete vekiline baglar.

const MSG_NO_BASE_URL = 'Backend adresi ayarlı değil.';
const MSG_NO_TOKEN = 'Önce giriş yap.';
const MSG_UNREACHABLE = 'Yapay zekâ servisine şu anda ulaşılamıyor.';
const MSG_SESSION_EXPIRED = 'Oturum süresi doldu, yeniden giriş yap.';
const MSG_TIMEOUT = 'Model yanıtı zaman aşımına uğradı.';
const MSG_EMPTY = 'Model boş yanıt döndürdü.';

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Govdeyi parca parca dolasir: async-iterable ya da getReader()
async function* iterateBody(body, signal) {
  if (!body) return;
  if (typeof body.getReader === 'function') {
    const reader = body.getReader();
    try {
      while (true) {
        if (signal && signal.aborted) throw signal.reason ?? new Error('aborted');
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      try {
        if (signal && signal.aborted && typeof reader.cancel === 'function') {
          await reader.cancel();
        }
      } catch {}
      try {
        if (typeof reader.releaseLock === 'function') reader.releaseLock();
      } catch {}
    }
  } else if (typeof body[Symbol.asyncIterator] === 'function') {
    for await (const chunk of body) {
      if (signal && signal.aborted) throw signal.reason ?? new Error('aborted');
      yield chunk;
    }
  } else {
    throw new Error(MSG_UNREACHABLE);
  }
}

async function parseSseStream(body, { onDelta, signal } = {}) {
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let content = '';
  let usage = null;
  let sawDone = false;
  // anahtar -> { id, name, arguments }; sirasi ilk gorulme sirasidir
  const calls = new Map();
  const idToKey = new Map();
  let autoKey = 0;

  function handleToolCalls(list) {
    list.forEach((tc, pos) => {
      if (!tc || typeof tc !== 'object') return;
      let key;
      if (typeof tc.index === 'number') {
        key = `i:${tc.index}`;
      } else if (typeof tc.id === 'string' && tc.id) {
        key = idToKey.get(tc.id) || `id:${tc.id}`;
      } else {
        // index ve id yoksa dizideki siraya gore
        key = `i:${pos}`;
      }
      let entry = calls.get(key);
      if (!entry) {
        entry = { id: '', name: '', arguments: '', order: autoKey++ };
        calls.set(key, entry);
      }
      if (typeof tc.id === 'string' && tc.id) {
        if (!entry.id) entry.id = tc.id;
        idToKey.set(tc.id, key);
      }
      const fn = tc.function || {};
      if (typeof fn.name === 'string' && fn.name) entry.name += fn.name;
      if (typeof fn.arguments === 'string') entry.arguments += fn.arguments;
      if (tc.extra_content && typeof tc.extra_content === 'object' && !Array.isArray(tc.extra_content)) {
        entry.extra_content = tc.extra_content;
      }
    });
  }

  function handleLine(rawLine) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data) return;
    if (data === '[DONE]') {
      sawDone = true;
      return;
    }
    let obj;
    try {
      obj = JSON.parse(data);
    } catch {
      return;
    }
    if (!obj || typeof obj !== 'object') return;
    if (obj.usage && typeof obj.usage === 'object') usage = obj.usage;
    const choice = Array.isArray(obj.choices) ? obj.choices[0] : null;
    const delta = choice && choice.delta;
    if (!delta || typeof delta !== 'object') return;
    if (typeof delta.content === 'string' && delta.content) {
      content += delta.content;
      if (typeof onDelta === 'function') onDelta(delta.content);
    }
    if (Array.isArray(delta.tool_calls)) handleToolCalls(delta.tool_calls);
  }

  function drain(final) {
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      handleLine(line);
    }
    if (final && buffer) {
      handleLine(buffer);
      buffer = '';
    }
  }

  for await (const chunk of iterateBody(body, signal)) {
    if (typeof chunk === 'string') {
      buffer += chunk;
    } else if (chunk) {
      buffer += decoder.decode(chunk, { stream: true });
    }
    drain(false);
  }
  buffer += decoder.decode();
  drain(true);

  const toolCalls = [...calls.values()]
    .sort((a, b) => a.order - b.order)
    .filter((c) => c.name)
    .map((c, i) => {
      const out = {
        id: c.id || `call_${i}`,
        name: c.name,
        arguments: c.arguments || '{}',
      };
      if (c.extra_content) {
        out.extra_content = c.extra_content;
      }
      return out;
    });

  return { content, toolCalls, usage, sawDone };
}

async function readErrorMessage(response) {
  try {
    const data = await response.json();
    const msg = data && data.error && data.error.message;
    return typeof msg === 'string' ? msg : '';
  } catch {
    return '';
  }
}

function createBackendModel({
  baseUrl,
  getToken,
  fetchImpl = globalThis.fetch,
  model,
  provider,
  timeoutMs = 120000,
  retryDelaysMs = [500, 1500],
  sleep,
} = {}) {
  const wait = typeof sleep === 'function' ? sleep : defaultSleep;
  const base = typeof baseUrl === 'string' ? baseUrl.trim().replace(/\/+$/, '') : '';
  let selectedModel = typeof model === 'string' && model ? model : null;
  let selectedProvider = typeof provider === 'string' && provider ? provider : null;

  function setSelection(selection) {
    if (
      selection &&
      typeof selection === 'object' &&
      typeof selection.model === 'string' &&
      selection.model &&
      typeof selection.provider === 'string' &&
      selection.provider
    ) {
      selectedModel = selection.model;
      selectedProvider = selection.provider;
    } else {
      selectedModel = null;
      selectedProvider = null;
    }
  }

  function getSelection() {
    if (!selectedModel && !selectedProvider) return null;
    return { model: selectedModel, provider: selectedProvider };
  }

  async function attemptOnce({ body, token, signal, onDelta, state }) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onCallerAbort = () => controller.abort(signal.reason);
    if (signal) signal.addEventListener('abort', onCallerAbort, { once: true });

    function mapError(err) {
      if (signal && signal.aborted) return err;
      if (timedOut) {
        const e = new Error(MSG_TIMEOUT);
        e.retryable = true;
        return e;
      }
      if (err && err.status !== undefined) return err;
      if (err && err.message === MSG_EMPTY) return err;
      const e = new Error(MSG_UNREACHABLE);
      e.retryable = true;
      e.cause = err;
      return e;
    }

    try {
      let response;
      try {
        response = await fetchImpl(`${base}/ide/complete`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body,
          signal: controller.signal,
        });
      } catch (err) {
        throw mapError(err);
      }

      if (!response.ok) {
        const status = response.status;
        const msg = status === 401 ? MSG_SESSION_EXPIRED : await readErrorMessage(response);
        const e = new Error(msg || MSG_UNREACHABLE);
        e.status = status;
        e.retryable = RETRYABLE_STATUS.has(status);
        throw e;
      }

      let parsed;
      try {
        parsed = await parseSseStream(response.body, {
          signal: controller.signal,
          onDelta(text) {
            state.deltaSent = true;
            if (typeof onDelta === 'function') {
              try {
                onDelta(text);
              } catch {}
            }
          },
        });
      } catch (err) {
        throw mapError(err);
      }

      if (!parsed.content && parsed.toolCalls.length === 0) {
        throw new Error(MSG_EMPTY);
      }
      return { content: parsed.content, toolCalls: parsed.toolCalls, usage: parsed.usage };
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onCallerAbort);
    }
  }

  async function complete({ messages, tools, toolChoice, signal = null, onDelta } = {}) {
    if (!base) throw new Error(MSG_NO_BASE_URL);
    const token = typeof getToken === 'function' ? await getToken() : null;
    if (!token) throw new Error(MSG_NO_TOKEN);

    const payload = { messages: Array.isArray(messages) ? messages : [] };
    if (Array.isArray(tools) && tools.length > 0) {
      payload.tools = tools;
      payload.tool_choice = toolChoice === 'none' ? 'none' : 'auto';
    }
    if (selectedModel) payload.model = selectedModel;
    if (selectedProvider) payload.provider = selectedProvider;
    payload.stream = true;
    const body = JSON.stringify(payload);

    const delays = Array.isArray(retryDelaysMs) ? retryDelaysMs : [];
    let attempt = 0;
    while (true) {
      if (signal && signal.aborted) {
        throw signal.reason ?? new Error('aborted');
      }
      const state = { deltaSent: false };
      try {
        return await attemptOnce({ body, token, signal, onDelta, state });
      } catch (err) {
        if (signal && signal.aborted) throw err;
        const canRetry = err && err.retryable && !state.deltaSent && attempt < delays.length;
        if (!canRetry) {
          if (err && typeof err === 'object') delete err.retryable;
          throw err;
        }
        await wait(delays[attempt]);
        attempt += 1;
      }
    }
  }

  async function executeWebPost(endpoint, payload, timeoutLimitMs, signal) {
    if (!base) throw new Error(MSG_NO_BASE_URL);
    if (signal && signal.aborted) throw signal.reason ?? new Error('aborted');
    const token = typeof getToken === 'function' ? await getToken() : null;
    if (!token) throw new Error(MSG_NO_TOKEN);

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutLimitMs);
    const onCallerAbort = () => controller.abort(signal.reason);
    if (signal) signal.addEventListener('abort', onCallerAbort, { once: true });

    try {
      let response;
      try {
        response = await fetchImpl(`${base}${endpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } catch (err) {
        if (signal && signal.aborted) throw signal.reason ?? err;
        if (timedOut) throw new Error(MSG_TIMEOUT);
        const e = new Error(MSG_UNREACHABLE);
        e.cause = err;
        throw e;
      }

      if (!response.ok) {
        const status = response.status;
        const msg = status === 401 ? MSG_SESSION_EXPIRED : await readErrorMessage(response);
        const e = new Error(msg || MSG_UNREACHABLE);
        e.status = status;
        throw e;
      }

      return await response.json();
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onCallerAbort);
    }
  }

  async function webSearch(query, { signal = null } = {}) {
    const data = await executeWebPost('/ide/web/search', { query }, 30000, signal);
    return data.results;
  }

  async function webFetch(url, { signal = null } = {}) {
    const data = await executeWebPost('/ide/web/fetch', { url }, 45000, signal);
    return data.page;
  }

  async function listModels({ signal = null } = {}) {
    if (!base) throw new Error(MSG_NO_BASE_URL);
    if (signal && signal.aborted) throw signal.reason ?? new Error('aborted');
    const token = typeof getToken === 'function' ? await getToken() : null;
    if (!token) throw new Error(MSG_NO_TOKEN);

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 15000);
    const onCallerAbort = () => controller.abort(signal.reason);
    if (signal) signal.addEventListener('abort', onCallerAbort, { once: true });

    try {
      let response;
      try {
        response = await fetchImpl(`${base}/ide/models`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          signal: controller.signal,
        });
      } catch (err) {
        if (signal && signal.aborted) throw signal.reason ?? err;
        if (timedOut) throw new Error(MSG_TIMEOUT);
        const e = new Error(MSG_UNREACHABLE);
        e.cause = err;
        throw e;
      }

      if (!response.ok) {
        const status = response.status;
        const msg = status === 401 ? MSG_SESSION_EXPIRED : await readErrorMessage(response);
        const e = new Error(msg || MSG_UNREACHABLE);
        e.status = status;
        throw e;
      }

      const data = await response.json();
      return {
        models: Array.isArray(data && data.models) ? data.models : [],
        default: (data && data.default) || null,
      };
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onCallerAbort);
    }
  }

  return { complete, webSearch, webFetch, setSelection, getSelection, listModels };
}

module.exports = { createBackendModel, parseSseStream };
