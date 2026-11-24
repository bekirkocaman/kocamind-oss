// OpenAI uyumlu /chat/completions sağlayıcıları (DeepSeek, Groq, Gemini, xAI ...)
// için ortak araç döngüsü. Model araç isterse sunucu ortak ToolRegistry'den
// çalıştırır, sonucu modele geri verir; model metin yazınca döngü biter.
// Akış (stream) açıkken metin ve düşünce parçaları istemciye anında iletilir.
const { StringDecoder } = require('string_decoder');
const { safeError } = require('../agent/security');
const { chatToolFor, executeWithRetry } = require('../agent/toolRegistry');
const { extractDsmlToolCalls, createDsmlStreamFilter } = require('./dsml');
const { fixMixedScriptWords, createMixedScriptStreamFixer } = require('./mixedScript');
const { createLoopBudget, runToolRound } = require('./toolRound');

const DEFAULT_MAX_ROUNDS = 5;
const FINAL_ANSWER_NUDGE = 'Artık araç çağıramazsın. Şu ana kadar topladığın bilgilerle kullanıcıya doğrudan, düz metin olarak cevap ver; emin olmadığın kısmı açıkça söyle.';
const EMPTY_ANSWER_FALLBACK = 'Bu soruyu araştırırken bir aksilik oldu, net bir cevap çıkaramadım. Bir kez daha sorar mısın?';
const MAX_TOOL_OUTPUT_CHARS = 12000;

function addUsage(total, usage) {
  if (!usage) return total;
  const base = total || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  return {
    prompt_tokens: base.prompt_tokens + Number(usage.prompt_tokens || 0),
    completion_tokens: base.completion_tokens + Number(usage.completion_tokens || 0),
    total_tokens: base.total_tokens + Number(usage.total_tokens || 0),
  };
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} zaman aşımına uğradı.`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

// Sohbet bağlamında araç çalıştırır. Onay isteyen araçlar burada yalnızca kendi
// onay adımını taşıyan sohbet varyantıyla çalışır (bkz. toolRegistry chatVariant).
function createToolExecutor(registry, context) {
  const seen = new Map();
  return async function executeTool(name, rawArguments) {
    const tool = chatToolFor(registry.get(name, context));
    if (!tool || !tool.enabled(context)) {
      return { ok: false, error: 'Araç kullanılamıyor.' };
    }
    let args;
    try {
      args = registry.validate(name, rawArguments, context, tool);
    } catch (error) {
      return { ok: false, error: `Geçersiz parametre: ${error.message}` };
    }
    // Aynı çağrı paralel turda da tekrarlanabilir; devam eden iş paylaşılır.
    const signature = `${name}:${JSON.stringify(args)}`;
    if (seen.has(signature)) return seen.get(signature);
    const pending = Promise.resolve()
      .then(() => executeWithRetry(tool, args, context, { timeoutMs: tool.timeoutMs }))
      .then(result => ({ ok: true, result }), error => safeError(error));
    seen.set(signature, pending);
    return pending;
  };
}

function serializeToolOutput(output) {
  const text = JSON.stringify(output);
  return text.length > MAX_TOOL_OUTPUT_CHARS ? `${text.slice(0, MAX_TOOL_OUTPUT_CHARS)}…(kısaltıldı)` : text;
}

// Akış parçalarındaki tool_calls deltalarını birleştirir. Bazı sağlayıcılar
// `index` göndermez; o durumda id ya da sıra kullanılır.
function mergeToolCallDeltas(target, deltas) {
  for (const delta of deltas || []) {
    let slot = Number.isInteger(delta.index) ? target[delta.index] : target.find(call => delta.id && call.id === delta.id);
    if (!slot) {
      slot = { id: '', type: 'function', function: { name: '', arguments: '' } };
      if (Number.isInteger(delta.index)) target[delta.index] = slot;
      else target.push(slot);
    }
    if (delta.id) slot.id = delta.id;
    if (delta.function?.name) slot.function.name += delta.function.name;
    if (delta.function?.arguments) slot.function.arguments += delta.function.arguments;
    if (delta.extra_content) slot.extra_content = delta.extra_content;
  }
}

async function readStreamRound(body, { onContent, onReasoning }) {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  let content = '';
  let reasoning = '';
  let usage = null;
  const toolCalls = [];

  const handleLine = (line) => {
    if (!line.startsWith('data:')) return;
    const raw = line.slice(5).trim();
    if (!raw || raw === '[DONE]') return;
    let chunk;
    try { chunk = JSON.parse(raw); } catch { return; }
    if (chunk.usage) usage = chunk.usage;
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) return;
    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
      reasoning += delta.reasoning_content;
      onReasoning(delta.reasoning_content);
    }
    if (typeof delta.content === 'string' && delta.content) {
      content += delta.content;
      onContent(delta.content);
    }
    if (delta.tool_calls) mergeToolCallDeltas(toolCalls, delta.tool_calls);
  };

  for await (const piece of body) {
    buffer += typeof piece === 'string' ? piece : decoder.write(piece);
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) handleLine(line);
  }
  buffer += decoder.end();
  if (buffer.trim()) handleLine(buffer.trim());
  return { content, reasoning, usage, toolCalls: toolCalls.filter(call => call && call.function.name) };
}

const seconds = ms => `${(ms / 1000).toFixed(1)}s`;

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/**
 * @param {object} options
 * @param {(body: object) => Promise<Response>} options.send  Sağlayıcıya istek atar.
 * @param {object} options.payload  model, messages, stream ve sağlayıcıya özel alanlar.
 * @param {Array|Function} options.tools  toChatCompletionsTools çıktısı ya da her turda
 *   güncel listeyi döndüren fonksiyon (find_tools ile etkinleşen araçlar için).
 * @param {Function} options.executeTool  (name, rawArguments) => çıktı.
 * @param {object} [options.res]  Akış açıkken yazılacak Express yanıtı.
 * @param {Function} [options.startStream]  İlk başarılı yanıtta SSE başlıklarını yazar.
 * @returns {Promise<{ok: boolean, response?: Response, data?: object, usage?: object}>}
 *   İlk istek başarısızsa `{ ok: false, response }` döner ve hiçbir şey yazılmamış olur.
 */
async function runChatToolLoop({ send, payload, tools, executeTool, res, startStream, maxRounds = DEFAULT_MAX_ROUNDS, budget = createLoopBudget() }) {
  const stream = payload.stream === true;
  const messages = [...payload.messages];
  let usage = null;
  let started = false;
  let emittedText = false;
  let nudged = false;
  // Yavaş cevapların nereden geldiğini görmek için her model turu ve araç süresi tek satırda loglanır.
  const loopStartedAt = Date.now();
  const timings = [];
  const logTimings = () => console.info(`[timing] chat ${payload.model} ${seconds(Date.now() - loopStartedAt)} -> ${timings.join(' | ')}`);
  const abortExit = () => {
    if (stream && res && !res.writableEnded && !res.ended) res.end();
    return { ok: false, usage, aborted: true, written: true, stats: budget.stats() };
  };

  for (let round = 0; round <= maxRounds + (nudged ? 1 : 0); round++) {
    if (budget.aborted()) return abortExit();
    // Son turda model araç çağıramaz, elindeki sonuçlarla cevap yazmak zorundadır.
    // Yine de ham DSML yazdıysa bir kez araçsız, açık talimatla yeniden istenir.
    const finalRound = round >= maxRounds || budget.shouldFinish();
    const roundTools = typeof tools === 'function' ? tools() : tools;
    const body = round > maxRounds
      ? { ...payload, messages }
      : { ...payload, messages, tools: roundTools, tool_choice: finalRound ? 'none' : 'auto' };
    const roundStartedAt = Date.now();
    let response;
    try {
      response = await send(body);
    } catch (error) {
      if (budget.aborted()) return abortExit();
      throw error;
    }

    if (!response.ok) {
      timings.push(`model#${round + 1} HTTP ${response.status} ${seconds(Date.now() - roundStartedAt)}`);
      logTimings();
      if (!started) return { ok: false, response, stats: budget.stats() };
      const upstream = await response.json().catch(() => ({}));
      console.error('Araç döngüsü sağlayıcı hatası:', response.status, upstream?.error?.message || upstream?.error);
      if (stream) {
        writeSse(res, { choices: [{ index: 0, delta: { content: '\n\n⚠️ Yapay zekâ servisine şu anda ulaşılamıyor. Biraz sonra tekrar dene.' } }] });
        res.write('data: [DONE]\n\n');
        res.end();
      }
      return { ok: false, usage, written: true, stats: budget.stats() };
    }

    let turn;
    if (stream) {
      if (!started) { startStream?.(); started = true; }
      let firstInRound = true;
      const fixer = createMixedScriptStreamFixer(text => {
        // Araçtan önce yazılan kısa metinle son cevap birbirine yapışmasın.
        const prefix = firstInRound && emittedText ? '\n\n' : '';
        firstInRound = false;
        emittedText = true;
        writeSse(res, { choices: [{ index: 0, delta: { content: prefix + text } }] });
      });
      const filter = createDsmlStreamFilter(fixer.push);
      turn = await readStreamRound(response.body, {
        onContent: filter.push,
        onReasoning: text => writeSse(res, { choices: [{ index: 0, delta: { reasoning_content: text } }] }),
      });
      filter.flush();
      fixer.flush();
    } else {
      started = true;
      const data = await response.json();
      const message = data.choices?.[0]?.message || {};
      turn = {
        content: message.content || '',
        reasoning: message.reasoning_content || '',
        usage: data.usage,
        toolCalls: message.tool_calls || [],
        data,
      };
    }
    usage = addUsage(usage, turn.usage);
    timings.push(`model#${round + 1} ${seconds(Date.now() - roundStartedAt)}${turn.reasoning ? ` (reasoning ${turn.reasoning.length} chars)` : ''}`);

    const leaked = extractDsmlToolCalls(turn.content, `dsml_${round}`);
    if (leaked) {
      turn.content = leaked.text;
      if (!turn.toolCalls.length && !finalRound) turn.toolCalls = leaked.toolCalls;
      if (finalRound && !turn.content && !nudged) {
        nudged = true;
        timings.push('dsml-leak retry-without-tools');
        messages.push({ role: 'system', content: FINAL_ANSWER_NUDGE });
        continue;
      }
    }

    if (!turn.toolCalls.length || finalRound) {
      if (!turn.content && !emittedText) {
        turn.content = EMPTY_ANSWER_FALLBACK;
        if (stream) writeSse(res, { choices: [{ index: 0, delta: { content: EMPTY_ANSWER_FALLBACK } }] });
      }
      if (!stream && turn.data?.choices?.[0]?.message) {
        turn.data.choices[0].message = { ...turn.data.choices[0].message, content: fixMixedScriptWords(turn.content), tool_calls: undefined };
      }
      logTimings();
      if (stream) {
        writeSse(res, { choices: [], usage });
        res.write('data: [DONE]\n\n');
        res.end();
        return { ok: true, usage, stats: budget.stats() };
      }
      return { ok: true, usage, data: { ...turn.data, usage }, stats: budget.stats() };
    }

    // DeepSeek düşünme modunda aynı tur içindeki reasoning_content geri gönderilmelidir.
    messages.push({
      role: 'assistant',
      content: turn.content || null,
      tool_calls: turn.toolCalls,
      ...(turn.reasoning ? { reasoning_content: turn.reasoning } : {}),
    });
    // Aynı turdaki araçlar birbirini beklemeden çalışır; sonuçlar modele çağrı sırasıyla döner.
    const roundToolsStartedAt = Date.now();
    const outputs = await runToolRound({
      calls: turn.toolCalls.map(call => ({ name: call.function?.name, arguments: call.function?.arguments })),
      executeTool,
      budget,
      onStart: call => {
        if (stream) writeSse(res, { choices: [{ index: 0, delta: {} }], kocamind_tool: { name: call.name, status: 'started' } });
      },
      onDone: (call, _index, output, durationMs) => {
        timings.push(`${call.name} ${seconds(durationMs)}${output.ok ? '' : ' (error)'}`);
        if (stream) writeSse(res, { choices: [{ index: 0, delta: {} }], kocamind_tool: { name: call.name, status: output.ok ? 'completed' : 'failed' } });
      },
    });
    if (turn.toolCalls.length > 1) timings.push(`tools(parallel) ${seconds(Date.now() - roundToolsStartedAt)}`);
    turn.toolCalls.forEach((call, index) => {
      messages.push({ role: 'tool', tool_call_id: call.id, content: serializeToolOutput(outputs[index]) });
    });
  }
  logTimings();
  return { ok: false, usage, stats: budget.stats() };
}

module.exports = { runChatToolLoop, createToolExecutor, mergeToolCallDeltas, readStreamRound, serializeToolOutput, DEFAULT_MAX_ROUNDS };
