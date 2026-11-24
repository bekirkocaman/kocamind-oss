// OpenAI Responses API için ortak araç döngüsü. /chat/completions sağlayıcılarındaki
// runChatToolLoop'un karşılığıdır: aynı ToolRegistry, aynı skill ve bağlantı araçları.
// `store: false` kullanıldığı için önceki yanıta id ile bağlanılmaz; her turda önceki
// çıktı öğeleri (şifreli reasoning dahil) ve araç sonuçları girdiye eklenir.
const { StringDecoder } = require('string_decoder');
const { formatSources, sourcesFromResponse, toChatCompletion } = require('../openaiResponses');
const { serializeToolOutput, DEFAULT_MAX_ROUNDS } = require('./chatToolLoop');
const { createLoopBudget, runToolRound } = require('./toolRound');

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function addUsage(total, usage) {
  if (!usage) return total;
  const sum = { ...(total || {}) };
  for (const [key, value] of Object.entries(usage)) {
    if (typeof value === 'number') sum[key] = (sum[key] || 0) + value;
  }
  return sum;
}

// Sohbet biçimindeki araçlar → Responses fonksiyon araçları. Ortak `web_search`
// aracı çıkarılır; OpenAI kendi yerleşik web aramasını kullanır.
function toResponsesTools(chatTools = []) {
  return chatTools
    .filter(tool => tool.function?.name && tool.function.name !== 'web_search')
    .map(tool => ({
      type: 'function',
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
      strict: false,
    }));
}

async function readResponsesStream(body, { onText, onReasoning }) {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  let completed = null;
  let failure = null;
  let emittedReasoning = false;
  let pendingBreak = false;

  const processEvent = rawEvent => {
    const dataLine = rawEvent.split(/\r?\n/).find(line => line.startsWith('data:'));
    if (!dataLine) return;
    const rawData = dataLine.slice(5).trim();
    if (!rawData || rawData === '[DONE]') return;
    let event;
    try { event = JSON.parse(rawData); } catch { return; }

    if (event.type === 'response.reasoning_summary_part.added') {
      if (emittedReasoning) pendingBreak = true;
    } else if (event.type === 'response.reasoning_summary_text.delta' && typeof event.delta === 'string') {
      onReasoning((pendingBreak ? '\n\n' : '') + event.delta);
      pendingBreak = false;
      emittedReasoning = emittedReasoning || event.delta.length > 0;
    } else if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
      onText(event.delta);
    } else if (event.type === 'response.completed') {
      completed = event.response || {};
    } else if (event.type === 'response.failed' || event.type === 'error') {
      failure = event.response?.error?.message || event.error?.message || event.message || 'OpenAI yanıtı tamamlanamadı.';
    }
  };

  for await (const chunk of body) {
    buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk);
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || '';
    for (const event of events) processEvent(event);
  }
  buffer += decoder.end();
  if (buffer.trim()) processEvent(buffer);
  return { response: completed, failure };
}

async function sendFirst(send, body) {
  let response = await send(body);
  // Reasoning özeti bazı OpenAI hesaplarında kapalıdır; özetsiz bir kez daha dene.
  if (!response.ok && response.status === 400 && body.reasoning?.summary) {
    const rejected = await response.json().catch(() => ({}));
    if (/summar/i.test(`${rejected?.error?.param || ''} ${rejected?.error?.message || ''}`)) {
      delete body.reasoning.summary;
      response = await send(body);
    } else {
      response = { ok: false, status: 400, json: async () => rejected };
    }
  }
  return response;
}

/**
 * @param {object} options
 * @param {(body: object) => Promise<Response>} options.send
 * @param {object} options.payload  buildOpenAIResponsesPayload çıktısı.
 * @param {Array|Function} options.tools  Sohbet biçiminde araç listesi (ya da her turda liste döndüren fonksiyon).
 * @param {Function} options.executeTool  (name, rawArguments) => çıktı.
 * @returns {Promise<{ok: boolean, response?: Response, data?: object, usage?: object}>}
 */
async function runResponsesToolLoop({ send, payload, tools, executeTool, res, startStream, maxRounds = DEFAULT_MAX_ROUNDS, budget = createLoopBudget() }) {
  const stream = payload.stream === true;
  const nativeTools = Array.isArray(payload.tools) ? payload.tools : [];
  const include = [...new Set([...(payload.include || []), 'reasoning.encrypted_content'])];
  const reasoning = payload.reasoning ? { ...payload.reasoning } : undefined;
  let input = [...(payload.input || [])];
  let usage = null;
  let started = false;
  let emittedText = '';
  const abortExit = () => {
    if (stream && res && !res.writableEnded && !res.ended) res.end();
    return { ok: false, usage, aborted: true, written: true, stats: budget.stats() };
  };

  for (let round = 0; round <= maxRounds; round++) {
    if (budget.aborted()) return abortExit();
    const finalRound = round >= maxRounds || budget.shouldFinish();
    const functionTools = toResponsesTools(typeof tools === 'function' ? tools() : tools);
    const body = {
      ...payload,
      input,
      reasoning,
      include,
      tools: [...nativeTools, ...functionTools],
      // Son turda model araç çağıramaz, elindeki sonuçlarla cevap yazmak zorundadır.
      tool_choice: finalRound ? 'none' : 'auto',
    };
    // sendFirst özeti kaldırırsa aynı `reasoning` nesnesi sonraki turlarda da özetsiz kalır.
    let response;
    try {
      response = round === 0 ? await sendFirst(send, body) : await send(body);
    } catch (error) {
      if (budget.aborted()) return abortExit();
      throw error;
    }

    if (!response.ok) {
      if (!started) return { ok: false, response, stats: budget.stats() };
      const upstream = await response.json().catch(() => ({}));
      console.error('Responses araç döngüsü hatası:', response.status, upstream?.error?.message || upstream?.error);
      if (stream) {
        writeSse(res, { choices: [{ index: 0, delta: { content: '\n\n⚠️ Yapay zekâ servisine şu anda ulaşılamıyor. Biraz sonra tekrar dene.' } }] });
        res.write('data: [DONE]\n\n');
        res.end();
      }
      return { ok: false, usage, written: true, stats: budget.stats() };
    }

    let result;
    if (stream) {
      if (!started) { startStream?.(); started = true; }
      let firstInRound = true;
      const streamed = await readResponsesStream(response.body, {
        onText: text => {
          const prefix = firstInRound && emittedText ? '\n\n' : '';
          firstInRound = false;
          emittedText += text;
          writeSse(res, { choices: [{ index: 0, delta: { content: prefix + text } }] });
        },
        onReasoning: text => writeSse(res, { choices: [{ index: 0, delta: { reasoning_content: text } }] }),
      });
      if (streamed.failure || !streamed.response) {
        writeSse(res, { choices: [{ index: 0, delta: { content: `\n\n⚠️ ${streamed.failure || 'OpenAI yanıtı tamamlanamadı.'}` } }] });
        res.write('data: [DONE]\n\n');
        res.end();
        return { ok: false, usage, written: true, stats: budget.stats() };
      }
      result = streamed.response;
    } else {
      started = true;
      result = await response.json();
    }
    usage = addUsage(usage, result.usage);

    const output = Array.isArray(result.output) ? result.output : [];
    const calls = output.filter(item => item.type === 'function_call');
    if (!calls.length || finalRound) {
      if (stream) {
        const unseen = sourcesFromResponse(result).filter(source => !emittedText.includes(source.url));
        const sources = formatSources(unseen);
        if (sources) writeSse(res, { choices: [{ index: 0, delta: { content: sources } }] });
        if (!emittedText && !sources) writeSse(res, { choices: [{ index: 0, delta: { content: 'OpenAI boş yanıt döndürdü.' } }] });
        writeSse(res, { choices: [], usage });
        res.write('data: [DONE]\n\n');
        res.end();
        return { ok: true, usage, stats: budget.stats() };
      }
      return { ok: true, usage, data: { ...toChatCompletion(result), usage }, stats: budget.stats() };
    }

    input = [...input, ...output];
    const outputs = await runToolRound({
      calls: calls.map(call => ({ name: call.name, arguments: call.arguments })),
      executeTool,
      budget,
      onStart: call => {
        if (stream) writeSse(res, { choices: [{ index: 0, delta: {} }], kocamind_tool: { name: call.name, status: 'started' } });
      },
      onDone: (call, _index, toolOutput) => {
        if (stream) writeSse(res, { choices: [{ index: 0, delta: {} }], kocamind_tool: { name: call.name, status: toolOutput.ok ? 'completed' : 'failed' } });
      },
    });
    calls.forEach((call, index) => {
      input.push({ type: 'function_call_output', call_id: call.call_id, output: serializeToolOutput(outputs[index]) });
    });
  }
  return { ok: false, usage, stats: budget.stats() };
}

module.exports = { runResponsesToolLoop, toResponsesTools, readResponsesStream };
