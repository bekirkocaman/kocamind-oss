const { randomUUID, createHash } = require('crypto');
const { safeError } = require('./security');
const { executeWithRetry } = require('./toolRegistry');
const { trimHistory } = require('../memoryAssist');
const { readResponsesStream } = require('../llm/responsesToolLoop');

const DEFAULT_LIMITS = Object.freeze({
  maxSteps: 8,
  maxToolCalls: 12,
  maxWallTimeMs: 120000,
  maxTotalTokens: 120000,
});

function outputText(response) {
  if (typeof response?.output_text === 'string') return response.output_text;
  return (response?.output || [])
    .filter(item => item.type === 'message')
    .flatMap(item => item.content || [])
    .filter(item => item.type === 'output_text')
    .map(item => item.text || '')
    .join('');
}

function extractSources(response) {
  const sources = [];
  for (const item of response?.output || []) {
    for (const content of item.content || []) {
      for (const annotation of content.annotations || []) {
        const url = annotation.url || annotation.url_citation?.url;
        if (url && !sources.some(source => source.url === url)) {
          sources.push({ title: annotation.title || annotation.url_citation?.title || url, url });
        }
      }
    }
  }
  return sources;
}

function privacySafeIdentifier(userId) {
  return createHash('sha256').update(`kocamind:${userId}`).digest('hex').slice(0, 32);
}

function abortableTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} zaman aşımına uğradı.`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function chunkText(text, size = 28) {
  const chunks = [];
  let cursor = 0;
  while (cursor < text.length) {
    let end = Math.min(text.length, cursor + size);
    if (end < text.length) {
      const space = text.lastIndexOf(' ', end);
      if (space > cursor + 8) end = space + 1;
    }
    chunks.push(text.slice(cursor, end));
    cursor = end;
  }
  return chunks;
}

function clientGoneError() {
  return Object.assign(new Error('İstemci bağlantıyı kapattı.'), { code: 'client_disconnected' });
}

function timeoutError() {
  return Object.assign(new Error('Agent çalışma süresi sınırına ulaştı.'), { code: 'timeout' });
}

class AgentRunner {
  constructor({ registry, store, fetchImpl, apiKey, limits = {}, onModelCall, streamText = false }) {
    this.registry = registry;
    this.store = store;
    this.fetch = fetchImpl || require('node-fetch');
    this.apiKey = apiKey;
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.onModelCall = onModelCall;
    this.streamText = Boolean(streamText);
  }

  // Güvenlik payı: büyük sınırlarda 2 sn, çok küçük sınırlarda (test) %10.
  safetyMs() {
    return Math.min(2000, Math.floor(this.limits.maxWallTimeMs * 0.1));
  }

  remainingMs(state) {
    return (state.deadline ?? (state.startedAt + this.limits.maxWallTimeMs)) - Date.now();
  }

  async timedModelCall(state, payload, signal, onDelta) {
    const startedAt = Date.now();
    const report = (ok, usage) => {
      try {
        this.onModelCall?.({
          uid: state.userId,
          route: state.mode === 'deep_research' ? 'deep_research' : 'agent',
          provider: 'openai',
          model: state.model,
          ok,
          usage,
          latencyMs: Date.now() - startedAt,
        });
      } catch { /* ölçüm agent akışını bozmamalı */ }
    };
    try {
      const response = await this.callOpenAI(payload, signal, state, onDelta);
      report(true, response.usage);
      return response;
    } catch (error) {
      report(false, null);
      throw error;
    }
  }

  async callOpenAI(payload, signal, state, onDelta) {
    const abortError = () => (state && this.remainingMs(state) <= 0 ? timeoutError() : clientGoneError());
    const requestPayload = this.streamText ? { ...payload, stream: true } : payload;
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (signal?.aborted) throw abortError();
      let callTimeout = 90000;
      if (state) {
        const remaining = this.remainingMs(state) - this.safetyMs();
        if (remaining <= 0) throw timeoutError();
        callTimeout = Math.min(90000, remaining);
      }
      let emittedInAttempt = false;
      try {
        const response = await this.fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify(requestPayload),
          timeout: callTimeout,
          ...(signal ? { signal } : {}),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          const message = data.error?.message || `OpenAI HTTP ${response.status}`;
          const upstreamError = Object.assign(new Error(message), { upstream: true, status: response.status });
          if (![408, 409, 429, 500, 502, 503, 504].includes(response.status) || attempt === 2) throw upstreamError;
          lastError = upstreamError;
        } else if (this.streamText) {
          const streamed = await readResponsesStream(response.body, {
            onText: delta => {
              if (delta) emittedInAttempt = true;
              onDelta?.(delta);
            },
            onReasoning: () => {},
          });
          if (streamed.failure || !streamed.response) {
            const message = streamed.failure || 'OpenAI yanıtı tamamlanamadı.';
            throw Object.assign(new Error(message), { upstream: true, status: 502 });
          }
          return streamed.response;
        } else {
          return await response.json().catch(() => ({}));
        }
      } catch (error) {
        lastError = error;
        if (signal?.aborted) throw abortError();
        if (emittedInAttempt || (error?.upstream && ![408, 409, 429, 500, 502, 503, 504].includes(error.status)) || attempt === 2) {
          throw error;
        }
      }
      const delay = 250 * (2 ** attempt);
      // Kalan süre bekleme + yeni deneme için yetmiyorsa tekrar deneme yok.
      if (state && this.remainingMs(state) - this.safetyMs() <= delay) break;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    throw lastError || new Error('OpenAI yanıt vermedi.');
  }

  async start(options) {
    const runId = randomUUID();
    const startedAt = Date.now();
    const state = {
      runId,
      userId: options.userId,
      model: options.model || 'gpt-5.6-luna',
      instructions: options.instructions,
      mode: options.mode || 'agent',
      requestedTools: options.enabledTools,
      startedAt,
      deadline: startedAt + this.limits.maxWallTimeMs,
      steps: 0,
      toolCalls: 0,
      totalTokens: 0,
      seenCalls: {},
      context: options.context || {},
    };
    await this.store.createRun({
      id: runId,
      userId: state.userId,
      model: state.model,
      mode: state.mode,
      status: 'running',
      prompt: String(options.message || '').slice(0, 12000),
    });
    let loopInput;
    try {
      await options.onEvent?.({ type: 'run_started', runId, model: state.model, mode: state.mode });
      const history = trimHistory((options.history || []).slice(-30)).map(message => ({
        role: message.role === 'ai' ? 'assistant' : message.role,
        content: String(message.content || '').slice(0, 30000),
      }));
      loopInput = [...history, { role: 'user', content: options.message }];
    } catch (error) {
      return this.failRun(state, error, options.onEvent);
    }
    return this.runLoop(state, {
      input: loopInput,
      onEvent: options.onEvent,
      signal: options.signal,
    });
  }

  // createRun sonrası hazırlık hatasında run kaydını 'failed' kapatır; kapatma da başarısız olursa yalnızca loglar.
  async failRun(state, error, onEvent) {
    const clean = safeError(error).error;
    console.error('Agent çalışması başlatılamadı:', clean);
    try {
      await this.store.updateRun(state.runId, { status: 'failed', error: clean, steps: state.steps, toolCalls: state.toolCalls });
    } catch (updateError) {
      console.error('Agent run kaydı kapatılamadı:', safeError(updateError).error);
    }
    try {
      await onEvent?.({ type: 'error', runId: state.runId, error: 'Agent başlatılamadı.' });
    } catch { /* istemci kopmuş olabilir */ }
    return { runId: state.runId, status: 'failed', error: 'Agent başlatılamadı.' };
  }

  buildTools(state) {
    const useNativeSearch = state.mode === 'deep_research' || state.context.enableWebSearch !== false;
    // Yerleşik arama açıkken aynı işi yapan ortak araç tekrar verilmez.
    const tools = this.registry.toOpenAITools(state.context, state.requestedTools)
      .filter(tool => !(useNativeSearch && this.registry.get(tool.name)?.nativeEquivalent === 'web_search'));
    if (useNativeSearch) tools.unshift({ type: 'web_search' });
    return tools;
  }

  async executeTool(state, call, onEvent) {
    const tool = this.registry.get(call.name, state.context);
    if (!tool || !tool.enabled(state.context)) return { call, output: { ok: false, error: 'Araç kullanılamıyor.' } };
    let args;
    try {
      args = this.registry.validate(call.name, call.arguments, state.context);
    } catch (error) {
      return { call, output: { ok: false, error: `Geçersiz parametre: ${error.message}` } };
    }
    const signature = `${call.name}:${JSON.stringify(args)}`;
    if (state.seenCalls[signature]) return { call, output: state.seenCalls[signature], args, duplicate: true };
    const startedAt = Date.now();
    await onEvent?.({ type: 'tool_started', runId: state.runId, callId: call.call_id, name: call.name, arguments: args, riskLevel: tool.riskLevel });
    let output;
    try {
      const result = await executeWithRetry(tool, args, state.context, { timeoutMs: Math.max(1, Math.min(tool.timeoutMs, this.remainingMs(state))) });
      output = { ok: true, result };
    } catch (error) {
      output = safeError(error);
    }
    state.seenCalls[signature] = output;
    await this.store.logTool({
      runId: state.runId,
      userId: state.userId,
      callId: call.call_id,
      tool: call.name,
      arguments: args,
      output,
      durationMs: Date.now() - startedAt,
    });
    await onEvent?.({ type: 'tool_completed', runId: state.runId, callId: call.call_id, name: call.name, arguments: args, output });
    return { call, output, args };
  }

  async pauseForApproval(state, response, calls, safeResults, onEvent) {
    const persistedState = { ...state };
    delete persistedState.context;
    const confirmationId = await this.store.createConfirmation({
      runId: state.runId,
      userId: state.userId,
      calls: calls.map(({ call, args, tool }) => ({
        callId: call.call_id,
        name: call.name,
        arguments: args,
        riskLevel: tool.riskLevel,
        summary: tool.confirmationSummary?.(args) || `${call.name} işlemi çalıştırılacak.`,
      })),
    });
    await this.store.updateRun(state.runId, {
      status: 'waiting_confirmation',
      pending: {
        confirmationId,
        previousResponseId: response.id,
        riskyCalls: calls.map(item => item.call),
        safeOutputs: safeResults.map(item => ({
          type: 'function_call_output',
          call_id: item.call.call_id,
          output: JSON.stringify(item.output),
        })),
        state: persistedState,
      },
    });
    await onEvent?.({
      type: 'approval_required',
      runId: state.runId,
      confirmationId,
      actions: calls.map(({ call, args, tool }) => ({
        name: call.name,
        arguments: args,
        riskLevel: tool.riskLevel,
        summary: tool.confirmationSummary?.(args) || `${call.name} işlemi çalıştırılacak.`,
      })),
    });
    return { runId: state.runId, status: 'waiting_confirmation', confirmationId };
  }

  async resume({ runId, confirmationId, approved, userId, context = {}, onEvent, signal }) {
    const run = await this.store.getRun(runId);
    if (!run || run.userId !== userId || run.pending?.confirmationId !== confirmationId) throw new Error('Agent çalışması bulunamadı.');
    await this.store.resolveConfirmation(confirmationId, userId, approved);
    const resumedAt = Date.now();
    const state = { ...run.pending.state, context, startedAt: resumedAt, deadline: resumedAt + this.limits.maxWallTimeMs };
    const riskyResults = approved
      ? await Promise.all(run.pending.riskyCalls.map(call => this.executeTool(state, call, onEvent)))
      : run.pending.riskyCalls.map(call => ({ call, output: { ok: false, error: 'Kullanıcı işlemi onaylamadı.' } }));
    const outputs = [
      ...(run.pending.safeOutputs || []),
      ...riskyResults.map(item => ({ type: 'function_call_output', call_id: item.call.call_id, output: JSON.stringify(item.output) })),
    ];
    await this.store.updateRun(runId, { status: 'running', pending: null });
    await onEvent?.({ type: approved ? 'approval_accepted' : 'approval_rejected', runId, confirmationId });
    return this.runLoop(state, { previousResponseId: run.pending.previousResponseId, input: outputs, onEvent, signal });
  }

  async runLoop(state, { input, previousResponseId, onEvent, signal: clientSignal }) {
    // Kesin watchdog: deadline'da model çağrıları abort edilir ve döngü Promise.race ile kesilir.
    const deadlineController = new AbortController();
    const signal = clientSignal ? AbortSignal.any([clientSignal, deadlineController.signal]) : deadlineController.signal;
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => { deadlineController.abort(); reject(timeoutError()); }, Math.max(0, this.remainingMs(state)));
    });
    timeoutPromise.catch(() => {});
    try {
      return await Promise.race([
        this.runLoopInner(state, { input, previousResponseId, onEvent, signal }),
        timeoutPromise,
      ]);
    } catch (error) {
      return this.finalizeFailure(state, error, onEvent);
    } finally {
      clearTimeout(timer);
    }
  }

  async runLoopInner(state, { input, previousResponseId, onEvent, signal }) {
    try {
      while (state.steps < this.limits.maxSteps) {
        if (signal?.aborted) throw clientGoneError();
        if (this.remainingMs(state) <= 0) throw timeoutError();
        state.steps += 1;
        const finalStep = state.steps >= this.limits.maxSteps || state.forceFinal === true;
        const statusMessage = finalStep
          ? 'Sınıra ulaştım, elimdekilerle cevap yazıyorum…'
          : (state.steps === 1 ? 'Görevi planlıyorum…' : 'Sonuçları değerlendiriyorum…');
        await onEvent?.({ type: 'status', runId: state.runId, message: statusMessage, step: state.steps });
        const payload = {
          model: state.model,
          instructions: state.instructions,
          input,
          tools: this.buildTools(state),
          tool_choice: finalStep ? 'none' : 'auto',
          parallel_tool_calls: true,
          reasoning: { effort: state.mode === 'deep_research' ? 'medium' : 'low' },
          text: { verbosity: state.mode === 'deep_research' ? 'high' : 'medium' },
          max_output_tokens: state.mode === 'deep_research' ? 12000 : 6000,
          safety_identifier: privacySafeIdentifier(state.userId),
          store: true,
        };
        if (previousResponseId) payload.previous_response_id = previousResponseId;
        let roundStreamed = false;
        const onDelta = this.streamText
          ? delta => {
            if (!delta) return;
            const prefix = !roundStreamed && state.emittedText ? '\n\n' : '';
            roundStreamed = true;
            state.emittedText = true;
            onEvent?.({ type: 'text_delta', runId: state.runId, delta: prefix + delta });
          }
          : undefined;
        const response = await this.timedModelCall(state, payload, signal, onDelta);
        state.totalTokens += Number(response.usage?.total_tokens || 0);
        if (state.totalTokens > this.limits.maxTotalTokens) throw new Error('Agent token sınırına ulaştı.');

        const functionCalls = (response.output || []).filter(item => item.type === 'function_call');
        const webCalls = (response.output || []).filter(item => item.type === 'web_search_call');
        for (const call of webCalls) {
          await onEvent?.({ type: 'tool_completed', runId: state.runId, callId: call.id, name: 'web_search', arguments: {}, output: { ok: true } });
        }
        if (!functionCalls.length) {
          const text = outputText(response);
          if (!text.trim()) throw new Error('Model boş yanıt döndürdü.');
          if (!roundStreamed) {
            for (const delta of chunkText(text)) await onEvent?.({ type: 'text_delta', runId: state.runId, delta });
          }
          const sources = extractSources(response);
          const limitReached = state.forceFinal ? 'tool_calls' : (finalStep ? 'steps' : null);
          await this.store.updateRun(state.runId, { status: 'completed', responseId: response.id, steps: state.steps, toolCalls: state.toolCalls, usage: response.usage || null, sources, limitReached });
          await onEvent?.({ type: 'completed', runId: state.runId, text, sources, usage: response.usage || null });
          return { runId: state.runId, status: 'completed', text, sources };
        }

        if (finalStep) throw new Error('Agent adım sınırına ulaştı.');

        state.toolCalls += functionCalls.length;
        if (state.toolCalls > this.limits.maxToolCalls) {
          state.toolCalls = this.limits.maxToolCalls;
          state.forceFinal = true;
          const limitOutput = JSON.stringify({ ok: false, error: 'Araç çağrısı sınırına ulaşıldı. Elindeki bilgilerle cevap ver.' });
          input = functionCalls.map(call => ({
            type: 'function_call_output',
            call_id: call.call_id,
            output: limitOutput,
          }));
          previousResponseId = response.id;
          continue;
        }
        const prepared = functionCalls.map(call => {
          const tool = this.registry.get(call.name, state.context);
          let args = {};
          let valid = false;
          try {
            args = this.registry.validate(call.name, call.arguments, state.context);
            valid = true;
          } catch { /* executor yapılandırılmış hata döndürür */ }
          return { call, tool, args, valid };
        });
        const risky = prepared.filter(item => item.tool?.requiresConfirmation && item.valid);
        const safe = prepared.filter(item => !(item.tool?.requiresConfirmation && item.valid));
        const safeResults = await Promise.all(safe.map(item => this.executeTool(state, item.call, onEvent)));
        if (risky.length) return this.pauseForApproval(state, response, risky, safeResults, onEvent);
        input = safeResults.map(item => ({ type: 'function_call_output', call_id: item.call.call_id, output: JSON.stringify(item.output) }));
        previousResponseId = response.id;
      }
      throw new Error('Agent adım sınırına ulaştı.');
    } catch (error) {
      return this.finalizeFailure(state, error, onEvent);
    }
  }

  async finalizeFailure(state, error, onEvent) {
    if (state.finalized) return { runId: state.runId, status: 'failed', error: state.finalError };
    state.finalized = true;
    {
      const clean = safeError(error).error;
      // Sağlayıcı hatasının ayrıntısı (bakiye, model, panel adresi) yalnızca sunucu kaydında kalır.
      const publicMessage = error?.upstream
        ? (error.status === 429 ? 'Yapay zekâ servisi şu anda yoğun, biraz sonra tekrar dene.' : 'Yapay zekâ servisine şu anda ulaşılamıyor. Biraz sonra tekrar dene.')
        : clean;
      if (error?.upstream) console.error('Agent sağlayıcı hatası:', error.status, clean);
      try {
        await this.store.updateRun(state.runId, {
          status: 'failed', error: clean, steps: state.steps, toolCalls: state.toolCalls,
          ...(error?.code === 'client_disconnected' || error?.code === 'timeout' ? { errorCode: error.code } : {}),
        });
      } catch (updateError) {
        console.error('Agent run kaydı güncellenemedi:', safeError(updateError).error);
      }
      try {
        await onEvent?.({ type: 'error', runId: state.runId, error: publicMessage });
      } catch (eventError) {
        console.error('Agent hata olayı iletilemedi:', safeError(eventError).error);
      }
      state.finalError = publicMessage;
      return { runId: state.runId, status: 'failed', error: publicMessage };
    }
  }
}

module.exports = { AgentRunner, DEFAULT_LIMITS, outputText, extractSources, privacySafeIdentifier };
