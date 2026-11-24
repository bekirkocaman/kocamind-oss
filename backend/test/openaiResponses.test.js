const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildOpenAIResponsesPayload,
  pipeResponsesAsChatCompletions,
  sourcesFromResponse,
  toChatCompletion,
} = require('../openaiResponses');

test('GPT-5.6 Luna Responses API için düşük reasoning ve web arama kullanır', () => {
  const payload = buildOpenAIResponsesPayload({
    model: 'gpt-5.6-luna',
    systemPrompt: 'Türkçe cevap ver.',
    history: [{ role: 'ai', content: 'Önceki cevap' }],
    message: 'Bugün ne oldu?',
    stream: true,
    enableWebSearch: true,
    assistantType: 'tiger',
    userId: 'user-1',
  });
  assert.equal(payload.reasoning.effort, 'low');
  assert.equal(payload.text.verbosity, 'medium');
  assert.deepEqual(payload.tools, [{ type: 'web_search' }]);
  assert.equal(payload.input[0].role, 'assistant');
  assert.equal(payload.safety_identifier.length, 64);
});

test('Responses cevabı metin ve kaynaklarla Chat Completions biçimine çevrilir', () => {
  const response = {
    id: 'resp_1',
    model: 'gpt-5.6-luna',
    status: 'completed',
    output: [{
      type: 'message',
      content: [{
        type: 'output_text',
        text: 'Güncel cevap.',
        annotations: [{ type: 'url_citation', title: 'Kaynak', url: 'https://example.com' }],
      }],
    }],
  };
  assert.deepEqual(sourcesFromResponse(response), [{ title: 'Kaynak', url: 'https://example.com' }]);
  assert.match(toChatCompletion(response).choices[0].message.content, /https:\/\/example\.com/);
});

test('Responses SSE akışı mevcut arayüzün okuyacağı delta biçimine çevrilir', async () => {
  const completed = {
    type: 'response.completed',
    response: {
      output: [{
        type: 'message',
        content: [{
          type: 'output_text',
          text: 'Merhaba',
          annotations: [{ type: 'url_citation', title: 'Resmi kaynak', url: 'https://example.com/source' }],
        }],
      }],
    },
  };
  const body = (async function* stream() {
    yield Buffer.from('event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Merhaba"}\n\n');
    yield Buffer.from(`event: response.completed\ndata: ${JSON.stringify(completed)}\n\n`);
  }());
  const chunks = [];
  const res = { write: chunk => chunks.push(chunk), end: () => chunks.push('END') };
  await pipeResponsesAsChatCompletions(body, res);
  const output = chunks.join('');
  assert.match(output, /Merhaba/);
  assert.match(output, /https:\/\/example\.com\/source/);
  assert.match(output, /data: \[DONE\]/);
  assert.match(output, /END$/);
});

test('Düşünme penceresi için reasoning özeti istenir; kapatılabilir', () => {
  const base = { model: 'gpt-5.6-luna', systemPrompt: 's', history: [], message: 'm', stream: true };
  assert.equal(buildOpenAIResponsesPayload(base).reasoning.summary, 'auto');
  assert.equal(buildOpenAIResponsesPayload({ ...base, reasoningSummary: false }).reasoning.summary, undefined);
});

test('Reasoning özeti akışta reasoning_content olarak, bölümler arası boş satırla iletilir', async () => {
  const ev = obj => Buffer.from(`event: ${obj.type}\ndata: ${JSON.stringify(obj)}\n\n`);
  const body = (async function* stream() {
    yield ev({ type: 'response.reasoning_summary_part.added', summary_index: 0 });
    yield ev({ type: 'response.reasoning_summary_text.delta', summary_index: 0, delta: 'Soruyu ' });
    yield ev({ type: 'response.reasoning_summary_text.delta', summary_index: 0, delta: 'anlıyorum.' });
    yield ev({ type: 'response.reasoning_summary_part.added', summary_index: 1 });
    yield ev({ type: 'response.reasoning_summary_text.delta', summary_index: 1, delta: 'Örnek vereyim.' });
    yield ev({ type: 'response.output_text.delta', delta: 'Cevap' });
    yield ev({ type: 'response.completed', response: { output: [] } });
  }());
  const chunks = [];
  const res = { write: chunk => chunks.push(chunk), end: () => {} };
  await pipeResponsesAsChatCompletions(body, res);
  const deltas = chunks
    .filter(c => c.startsWith('data: {'))
    .map(c => JSON.parse(c.slice(6)).choices[0].delta);
  const reasoning = deltas.map(d => d.reasoning_content || '').join('');
  const content = deltas.map(d => d.content || '').join('');
  assert.equal(reasoning, 'Soruyu anlıyorum.\n\nÖrnek vereyim.');
  assert.equal(content, 'Cevap');
  // Düşünce metni asla yanıt metnine karışmaz.
  assert.ok(deltas.every(d => !(d.reasoning_content && d.content)));
});
