const { StringDecoder } = require('string_decoder');
const {
  formatSources,
  outputTextFromResponse,
  sourcesFromResponse,
} = require('./openaiResponses');

function messagesToResponsesInput(messages = []) {
  const input = [];

  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;

    if (msg.role === 'system' || msg.role === 'user') {
      input.push({
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : '',
      });
      continue;
    }

    if (msg.role === 'assistant') {
      const hasToolCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
      if (typeof msg.content === 'string' && (msg.content.length > 0 || !hasToolCalls)) {
        input.push({
          role: 'assistant',
          content: msg.content,
        });
      }
      if (hasToolCalls) {
        for (const tc of msg.tool_calls) {
          if (!tc || !tc.function?.name) continue;
          input.push({
            type: 'function_call',
            call_id: tc.id,
            name: tc.function.name,
            arguments: typeof tc.function.arguments === 'string'
              ? tc.function.arguments
              : JSON.stringify(tc.function.arguments ?? {}),
          });
        }
      }
      continue;
    }

    if (msg.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: msg.tool_call_id,
        output: typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content ?? ''),
      });
    }
  }

  return input;
}

function toIdeResponsesTools(chatTools = []) {
  return chatTools
    .filter(tool => tool && tool.function?.name)
    .map(tool => ({
      type: 'function',
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
      strict: false,
    }));
}

function buildIdeResponsesPayload({
  model,
  messages = [],
  tools,
  tool_choice = 'auto',
  stream = true,
  provider = {},
}) {
  const payload = {
    model,
    input: messagesToResponsesInput(messages),
    stream: Boolean(stream),
    store: false,
  };

  if (Array.isArray(tools) && tools.length > 0) {
    payload.tools = toIdeResponsesTools(tools);
    payload.tool_choice = tool_choice;
  }

  if (provider?.defaultMaxTokens) {
    payload.max_output_tokens = provider.defaultMaxTokens;
  }

  return payload;
}

function extractIdeToolCalls(response = {}) {
  const output = Array.isArray(response.output) ? response.output : [];
  return output
    .filter(item => item && item.type === 'function_call')
    .map((item, idx) => ({
      id: item.call_id || item.id || `call_${idx}`,
      type: 'function',
      function: {
        name: item.name || '',
        arguments: typeof item.arguments === 'string'
          ? item.arguments
          : JSON.stringify(item.arguments ?? {}),
      },
    }));
}

function toIdeChatCompletion(response = {}) {
  const text = outputTextFromResponse(response) + formatSources(sourcesFromResponse(response));
  const toolCalls = extractIdeToolCalls(response);
  const hasToolCalls = toolCalls.length > 0;

  const message = {
    role: 'assistant',
    content: hasToolCalls ? (text || null) : text,
    ...(hasToolCalls ? { tool_calls: toolCalls } : {}),
  };

  const finishReason = hasToolCalls
    ? 'tool_calls'
    : (response.status === 'completed' || !response.status ? 'stop' : response.status);

  return {
    id: response.id,
    model: response.model,
    choices: [{
      index: 0,
      finish_reason: finishReason,
      message,
    }],
    usage: response.usage,
  };
}

function writeSseChunk(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function writeChatDelta(res, content) {
  if (!content) return;
  writeSseChunk(res, { choices: [{ index: 0, delta: { content } }] });
}

function writeReasoningDelta(res, reasoning) {
  if (!reasoning) return;
  writeSseChunk(res, { choices: [{ index: 0, delta: { reasoning_content: reasoning } }] });
}

async function pipeIdeResponsesAsChatCompletions(upstreamBody, res) {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  let emittedText = '';
  let emittedReasoning = false;
  let pendingBreak = false;
  let completed = false;
  let failed = false;
  let usage = null;
  const slots = [];

  const ensureSlot = ({ itemId, callId, outputIndex } = {}) => {
    let slot = null;
    if (itemId) {
      slot = slots.find(s => s.itemId === itemId) || null;
    }
    if (!slot && callId) {
      slot = slots.find(s => s.callId === callId) || null;
    }
    if (!slot && Number.isInteger(outputIndex)) {
      slot = slots.find(s => s.outputIndex === outputIndex) || null;
    }
    if (!slot && !itemId && !callId && !Number.isInteger(outputIndex) && slots.length > 0) {
      slot = slots[slots.length - 1];
    }
    if (!slot && slots.length === 1 && !slots[0].itemId && !slots[0].callId) {
      slot = slots[0];
    }
    if (!slot) {
      slot = {
        index: slots.length,
        itemId: itemId || null,
        callId: callId || null,
        outputIndex: Number.isInteger(outputIndex) ? outputIndex : null,
        name: '',
        emittedId: false,
        emittedName: false,
        emittedArgs: '',
      };
      slots.push(slot);
    } else {
      if (itemId && !slot.itemId) slot.itemId = itemId;
      if (callId && !slot.callId) slot.callId = callId;
      if (Number.isInteger(outputIndex) && slot.outputIndex === null) slot.outputIndex = outputIndex;
    }
    return slot;
  };

  const emitToolCallDelta = (slot, { callId, name, argsDelta, isFullArgs = false } = {}) => {
    if (callId && !slot.callId) slot.callId = callId;
    if (name && !slot.name) slot.name = name;

    let argumentsPiece = '';
    if (typeof argsDelta === 'string') {
      if (isFullArgs) {
        if (argsDelta.startsWith(slot.emittedArgs)) {
          argumentsPiece = argsDelta.slice(slot.emittedArgs.length);
        } else if (!slot.emittedArgs) {
          argumentsPiece = argsDelta;
        }
      } else {
        argumentsPiece = argsDelta;
      }
    }

    const needId = Boolean(slot.callId && !slot.emittedId);
    const needName = Boolean(slot.name && !slot.emittedName);
    const needArgs = argumentsPiece.length > 0;

    if (!needId && !needName && !needArgs) return;

    const tcDelta = {
      index: slot.index,
      ...(needId ? { id: slot.callId } : {}),
      type: 'function',
      function: {
        ...(needName ? { name: slot.name } : {}),
        ...(needArgs || needName || needId ? { arguments: argumentsPiece } : {}),
      },
    };

    if (needId) slot.emittedId = true;
    if (needName) slot.emittedName = true;
    if (needArgs) slot.emittedArgs += argumentsPiece;

    writeSseChunk(res, { choices: [{ index: 0, delta: { tool_calls: [tcDelta] } }] });
  };

  const processLine = (rawLine) => {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) return;
    const rawData = line.slice(5).trim();
    if (!rawData || rawData === '[DONE]') return;

    let event;
    try {
      event = JSON.parse(rawData);
    } catch {
      return;
    }
    if (!event || typeof event !== 'object') return;

    if (event.type === 'response.reasoning_summary_part.added') {
      if (emittedReasoning) pendingBreak = true;
      return;
    }

    if (event.type === 'response.reasoning_summary_text.delta' && typeof event.delta === 'string') {
      writeReasoningDelta(res, (pendingBreak ? '\n\n' : '') + event.delta);
      pendingBreak = false;
      emittedReasoning = emittedReasoning || event.delta.length > 0;
      return;
    }

    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
      emittedText += event.delta;
      writeChatDelta(res, event.delta);
      return;
    }

    if (event.type === 'response.output_item.added' && event.item?.type === 'function_call') {
      const item = event.item;
      const slot = ensureSlot({
        itemId: item.id,
        callId: item.call_id || item.id,
        outputIndex: event.output_index,
      });
      emitToolCallDelta(slot, {
        callId: item.call_id || item.id,
        name: item.name,
        argsDelta: typeof item.arguments === 'string' ? item.arguments : '',
        isFullArgs: false,
      });
      return;
    }

    if (event.type === 'response.function_call_arguments.delta' && typeof event.delta === 'string') {
      const slot = ensureSlot({
        itemId: event.item_id,
        callId: event.call_id,
        outputIndex: event.output_index,
      });
      emitToolCallDelta(slot, {
        callId: event.call_id,
        name: event.name,
        argsDelta: event.delta,
        isFullArgs: false,
      });
      return;
    }

    if (event.type === 'response.function_call_arguments.done') {
      const slot = ensureSlot({
        itemId: event.item_id,
        callId: event.call_id,
        outputIndex: event.output_index,
      });
      const fullArgs = typeof event.arguments === 'string'
        ? event.arguments
        : (event.arguments !== undefined ? JSON.stringify(event.arguments) : '');
      emitToolCallDelta(slot, {
        callId: event.call_id,
        name: event.name,
        argsDelta: fullArgs,
        isFullArgs: true,
      });
      return;
    }

    if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') {
      const item = event.item;
      const slot = ensureSlot({
        itemId: item.id,
        callId: item.call_id || item.id,
        outputIndex: event.output_index,
      });
      const fullArgs = typeof item.arguments === 'string'
        ? item.arguments
        : JSON.stringify(item.arguments ?? {});
      emitToolCallDelta(slot, {
        callId: item.call_id || item.id,
        name: item.name,
        argsDelta: fullArgs,
        isFullArgs: true,
      });
      return;
    }

    if (event.type === 'response.completed') {
      const resp = event.response || {};
      if (!emittedText) {
        const text = outputTextFromResponse(resp);
        if (text) {
          emittedText += text;
          writeChatDelta(res, text);
        }
      }

      const output = Array.isArray(resp.output) ? resp.output : [];
      output.forEach((item, idx) => {
        if (!item || item.type !== 'function_call') return;
        const slot = ensureSlot({
          itemId: item.id,
          callId: item.call_id || item.id || `call_${idx}`,
          outputIndex: idx,
        });
        const fullArgs = typeof item.arguments === 'string'
          ? item.arguments
          : JSON.stringify(item.arguments ?? {});
        emitToolCallDelta(slot, {
          callId: item.call_id || item.id || `call_${idx}`,
          name: item.name,
          argsDelta: fullArgs,
          isFullArgs: true,
        });
      });

      const sources = sourcesFromResponse(resp);
      const unseenSources = sources.filter(source => !emittedText.includes(source.url));
      writeChatDelta(res, formatSources(unseenSources));

      usage = resp.usage || null;
      if (usage) {
        writeSseChunk(res, { choices: [], usage });
      }
      completed = true;
      return;
    }

    if (event.type === 'response.failed' || event.type === 'error') {
      failed = true;
      const message = event.response?.error?.message || event.error?.message || event.message || 'OpenAI yanıtı tamamlanamadı.';
      writeChatDelta(res, `\n\n⚠️ ${message}`);
    }
  };

  for await (const chunk of upstreamBody) {
    buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk);
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.trim()) processLine(line);
    }
  }
  buffer += decoder.end();
  if (buffer.trim()) {
    processLine(buffer);
  }

  res.write('data: [DONE]\n\n');
  res.end();
  return { usage, ok: completed && !failed };
}

module.exports = {
  buildIdeResponsesPayload,
  extractIdeToolCalls,
  messagesToResponsesInput,
  pipeIdeResponsesAsChatCompletions,
  toIdeChatCompletion,
  toIdeResponsesTools,
};
