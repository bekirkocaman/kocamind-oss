const { createHash } = require('crypto');
const { StringDecoder } = require('string_decoder');

const OPENAI_REASONING_BY_MODEL = {
  'gpt-5.6-luna': 'low',
};

function normalizeHistory(history = []) {
  return history
    .filter(item => item && typeof item.content === 'string' && item.content.trim())
    .map(item => ({
      role: item.role === 'ai' ? 'assistant' : item.role === 'assistant' ? 'assistant' : 'user',
      content: item.content,
    }));
}

function buildOpenAIResponsesPayload({
  model,
  systemPrompt,
  history,
  message,
  stream,
  enableWebSearch,
  assistantType,
  userId,
  reasoningSummary = true,
  deepThink = false,
}) {
  const input = normalizeHistory(history);
  if (typeof message === 'string' && message.trim()) input.push({ role: 'user', content: message });

  const defaultEffort = OPENAI_REASONING_BY_MODEL[model] || 'medium';
  const effort = assistantType === 'deep_research' ? 'xhigh' : deepThink ? 'high' : defaultEffort;
  const payload = {
    model,
    instructions: systemPrompt,
    input,
    stream: Boolean(stream),
    store: false,
    // Özet, uygulamadaki düşünme penceresinde gösterilir.
    reasoning: reasoningSummary ? { effort, summary: 'auto' } : { effort },
    text: { verbosity: assistantType === 'deep_research' ? 'high' : 'medium' },
    max_output_tokens: assistantType === 'deep_research' ? 16000 : 8000,
  };

  if (userId) {
    payload.safety_identifier = createHash('sha256').update(String(userId)).digest('hex');
  }
  if (enableWebSearch) {
    payload.tools = [{ type: 'web_search' }];
    payload.tool_choice = 'auto';
    payload.include = ['web_search_call.action.sources'];
  }
  return payload;
}

function outputTextFromResponse(response = {}) {
  if (typeof response.output_text === 'string') return response.output_text;
  return (response.output || [])
    .filter(item => item.type === 'message')
    .flatMap(item => item.content || [])
    .filter(item => item.type === 'output_text')
    .map(item => item.text || '')
    .join('');
}

function sourcesFromResponse(response = {}) {
  const unique = new Map();
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      for (const annotation of content.annotations || []) {
        if (annotation.type !== 'url_citation' || !annotation.url) continue;
        unique.set(annotation.url, annotation.title || annotation.url);
      }
    }
    const sources = item.action?.sources || [];
    for (const source of sources) {
      if (source?.url) unique.set(source.url, source.title || source.url);
    }
  }
  return [...unique].map(([url, title]) => ({ url, title }));
}

function formatSources(sources = []) {
  if (!sources.length) return '';
  return `\n\n📌 Kaynaklar:\n${sources.map(source => `- [${source.title}](${source.url})`).join('\n')}`;
}

function toChatCompletion(response = {}) {
  return {
    id: response.id,
    model: response.model,
    choices: [{
      index: 0,
      finish_reason: response.status === 'completed' ? 'stop' : response.status,
      message: {
        role: 'assistant',
        content: outputTextFromResponse(response) + formatSources(sourcesFromResponse(response)),
      },
    }],
    usage: response.usage,
  };
}

function writeChatDelta(res, content) {
  if (!content) return;
  res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`);
}

// DeepSeek R1 ile aynı alan: istemci düşünceyi yanıt metninden ayrı okur.
function writeReasoningDelta(res, reasoning) {
  if (!reasoning) return;
  res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { reasoning_content: reasoning } }] })}\n\n`);
}

async function pipeResponsesAsChatCompletions(upstreamBody, res) {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  let emittedText = '';
  let emittedReasoning = false;
  let pendingBreak = false;
  let completed = false;
  let failed = false;
  let usage = null;

  const processEvent = (rawEvent) => {
    const dataLine = rawEvent.split(/\r?\n/).find(line => line.startsWith('data:'));
    if (!dataLine) return;
    const rawData = dataLine.slice(5).trim();
    if (!rawData || rawData === '[DONE]') return;

    let event;
    try { event = JSON.parse(rawData); } catch { return; }

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

    if (event.type === 'response.completed') {
      const sources = sourcesFromResponse(event.response);
      const unseenSources = sources.filter(source => !emittedText.includes(source.url));
      writeChatDelta(res, formatSources(unseenSources));
      usage = event.response?.usage || null;
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
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || '';
    for (const event of events) processEvent(event);
  }
  buffer += decoder.end();
  if (buffer.trim()) processEvent(buffer);
  if (!completed && !emittedText) writeChatDelta(res, 'OpenAI boş yanıt döndürdü.');
  res.write('data: [DONE]\n\n');
  res.end();
  return { usage, ok: completed && !failed };
}

module.exports = {
  buildOpenAIResponsesPayload,
  formatSources,
  outputTextFromResponse,
  pipeResponsesAsChatCompletions,
  sourcesFromResponse,
  toChatCompletion,
};
