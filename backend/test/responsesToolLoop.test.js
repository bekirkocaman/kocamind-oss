const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { runResponsesToolLoop, toResponsesTools } = require('../llm/responsesToolLoop');

const chatTools = [
  { type: 'function', function: { name: 'google_calendar__list_events', description: '[Google Takvim] Etkinlikler', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'web_search', description: 'Ortak arama', parameters: { type: 'object', properties: {} } } },
];

const basePayload = () => ({
  model: 'gpt-5.6-luna',
  instructions: 'sistem',
  input: [{ role: 'user', content: 'Yarın ne var?' }],
  stream: false,
  store: false,
  reasoning: { effort: 'low', summary: 'auto' },
  tools: [{ type: 'web_search' }],
  tool_choice: 'auto',
  include: ['web_search_call.action.sources'],
});

const functionCall = { type: 'function_call', id: 'fc1', call_id: 'call_1', name: 'google_calendar__list_events', arguments: '{}' };
const reasoningItem = { type: 'reasoning', id: 'rs1', encrypted_content: 'sifreli', summary: [] };
const messageItem = text => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] });

const jsonResponse = body => ({ ok: true, status: 200, json: async () => body });
const sse = events => Readable.from(events.map(event => `data: ${JSON.stringify(event)}\n\n`));
const streamResponse = events => ({ ok: true, status: 200, body: sse(events) });

function fakeRes() {
  const chunks = [];
  return { chunks, ended: false, write(chunk) { chunks.push(String(chunk)); }, end() { this.ended = true; } };
}

test('toResponsesTools sohbet araçlarını Responses biçimine çevirir, ortak web_search çıkarılır', () => {
  assert.deepEqual(toResponsesTools(chatTools), [
    { type: 'function', name: 'google_calendar__list_events', description: '[Google Takvim] Etkinlikler', parameters: { type: 'object', properties: {} }, strict: false },
  ]);
});

test('akışsız: araç çağrısı çalıştırılır, önceki çıktı + sonuç girdiye eklenir, son cevap sohbet biçiminde döner', async () => {
  const bodies = [];
  const responses = [
    jsonResponse({ id: 'r1', status: 'completed', output: [reasoningItem, functionCall], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } }),
    jsonResponse({ id: 'r2', model: 'gpt-5.6-luna', status: 'completed', output: [messageItem('Yarın 10:00 ders.')], usage: { input_tokens: 20, output_tokens: 6, total_tokens: 26 } }),
  ];
  const executed = [];
  const result = await runResponsesToolLoop({
    send: async body => { bodies.push(JSON.parse(JSON.stringify(body))); return responses.shift(); },
    payload: basePayload(),
    tools: () => chatTools,
    executeTool: async (name, args) => { executed.push([name, args]); return { ok: true, result: { content: 'Ders 10:00' } }; },
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.choices[0].message.content, 'Yarın 10:00 ders.');
  assert.deepEqual(result.usage, { input_tokens: 30, output_tokens: 11, total_tokens: 41 });
  assert.deepEqual(executed, [['google_calendar__list_events', '{}']]);
  assert.deepEqual(bodies[0].tools.map(tool => tool.name || tool.type), ['web_search', 'google_calendar__list_events']);
  assert.ok(bodies[0].include.includes('reasoning.encrypted_content'));
  assert.ok(bodies[0].include.includes('web_search_call.action.sources'));
  const secondInput = bodies[1].input;
  assert.deepEqual(secondInput.slice(0, 1), [{ role: 'user', content: 'Yarın ne var?' }]);
  assert.deepEqual(secondInput[1], reasoningItem);
  assert.deepEqual(secondInput[2], functionCall);
  assert.equal(secondInput[3].type, 'function_call_output');
  assert.equal(secondInput[3].call_id, 'call_1');
  assert.match(secondInput[3].output, /Ders 10:00/);
});

test('akışlı: düşünce ve metin iletilir, araç durumu yazılır, [DONE] ile biter', async () => {
  const responses = [
    streamResponse([
      { type: 'response.reasoning_summary_text.delta', delta: 'Takvime bakmalıyım.' },
      { type: 'response.completed', response: { id: 'r1', status: 'completed', output: [functionCall], usage: { total_tokens: 5 } } },
    ]),
    streamResponse([
      { type: 'response.output_text.delta', delta: 'Yarın ' },
      { type: 'response.output_text.delta', delta: 'ders var.' },
      { type: 'response.completed', response: { id: 'r2', status: 'completed', output: [messageItem('Yarın ders var.')], usage: { total_tokens: 7 } } },
    ]),
  ];
  const res = fakeRes();
  let started = 0;
  const result = await runResponsesToolLoop({
    send: async () => responses.shift(),
    payload: { ...basePayload(), stream: true },
    tools: () => chatTools,
    executeTool: async () => ({ ok: true, result: 'x' }),
    res,
    startStream: () => { started += 1; },
  });
  const output = res.chunks.join('');
  assert.equal(result.ok, true);
  assert.equal(started, 1);
  assert.match(output, /"reasoning_content":"Takvime bakmalıyım\."/);
  assert.match(output, /"kocamind_tool":\{"name":"google_calendar__list_events","status":"started"\}/);
  assert.match(output, /"kocamind_tool":\{"name":"google_calendar__list_events","status":"completed"\}/);
  assert.match(output, /"content":"Yarın "/);
  assert.match(output, /"content":"ders var\."/);
  assert.ok(output.trim().endsWith('data: [DONE]'));
  assert.equal(res.ended, true);
});

test('son turda model araç çağıramaz', async () => {
  const bodies = [];
  const result = await runResponsesToolLoop({
    send: async body => {
      bodies.push(body.tool_choice);
      return jsonResponse({ id: 'r', status: 'completed', output: bodies.length <= 2 ? [functionCall] : [messageItem('bitti')] });
    },
    payload: basePayload(),
    tools: () => chatTools,
    executeTool: async () => ({ ok: true, result: 'x' }),
    maxRounds: 2,
  });
  assert.deepEqual(bodies, ['auto', 'auto', 'none']);
  assert.equal(result.data.choices[0].message.content, 'bitti');
});

test('ilk istek başarısızsa hiçbir şey yazmadan yanıtı geri verir', async () => {
  const failed = { ok: false, status: 503, json: async () => ({ error: { message: 'down' } }) };
  const res = fakeRes();
  const result = await runResponsesToolLoop({ send: async () => failed, payload: { ...basePayload(), stream: true }, tools: () => chatTools, executeTool: async () => ({}), res });
  assert.equal(result.ok, false);
  assert.equal(result.response, failed);
  assert.deepEqual(res.chunks, []);
});

test('reasoning özeti desteklenmiyorsa özetsiz tekrar denenir', async () => {
  const bodies = [];
  const result = await runResponsesToolLoop({
    send: async body => {
      bodies.push(JSON.parse(JSON.stringify(body)));
      if (body.reasoning?.summary) return { ok: false, status: 400, json: async () => ({ error: { param: 'reasoning.summary', message: 'organization must be verified' } }) };
      return jsonResponse({ id: 'r', status: 'completed', output: [messageItem('tamam')] });
    },
    payload: basePayload(),
    tools: () => chatTools,
    executeTool: async () => ({}),
  });
  assert.equal(result.ok, true);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].reasoning.summary, undefined);
});

test('iki araç paralel başlar ve çıktılar çağrı sırasıyla eklenir; bütçe bitince tool_choice: none olur', async () => {
  const { createLoopBudget } = require('../llm/toolRound');
  const active = new Set();
  let maxConcurrent = 0;
  const bodies = [];
  const callA = { type: 'function_call', id: 'fc1', call_id: 'call_a', name: 'google_calendar__list_events', arguments: '{"s":1}' };
  const callB = { type: 'function_call', id: 'fc2', call_id: 'call_b', name: 'google_calendar__list_events', arguments: '{"s":2}' };
  const responses = [
    jsonResponse({ id: 'r1', status: 'completed', output: [callA, callB] }),
    jsonResponse({ id: 'r2', status: 'completed', output: [messageItem('Tamamlandı')] }),
  ];
  const budget = createLoopBudget({ maxToolCalls: 2 });
  const result = await runResponsesToolLoop({
    send: async body => { bodies.push(JSON.parse(JSON.stringify(body))); return responses.shift(); },
    payload: basePayload(),
    tools: () => chatTools,
    budget,
    executeTool: async (name, rawArgs) => {
      const parsed = JSON.parse(rawArgs);
      active.add(parsed.s);
      maxConcurrent = Math.max(maxConcurrent, active.size);
      await new Promise(resolve => setTimeout(resolve, parsed.s === 1 ? 25 : 5));
      active.delete(parsed.s);
      return { ok: true, result: { step: parsed.s } };
    },
  });
  assert.equal(result.ok, true);
  assert.ok(maxConcurrent >= 2);
  assert.equal(bodies[0].tool_choice, 'auto');
  assert.equal(bodies[1].tool_choice, 'none');
  const outputs = bodies[1].input.filter(item => item.type === 'function_call_output');
  assert.deepEqual(outputs.map(o => o.call_id), ['call_a', 'call_b']);
  assert.match(outputs[0].output, /"step":1/);
  assert.match(outputs[1].output, /"step":2/);
  assert.equal(result.stats.toolCalls, 2);
  assert.equal(result.stats.limitReached, 'tool_calls');
});

test('responsesToolLoop iptal sinyaliyle send çağırmadan veya send fırlatınca aborted: true döner', async () => {
  const { createLoopBudget } = require('../llm/toolRound');
  const c1 = new AbortController();
  c1.abort();
  let called = 0;
  const r1 = await runResponsesToolLoop({
    send: async () => { called += 1; return jsonResponse({}); },
    payload: basePayload(),
    tools: () => chatTools,
    executeTool: async () => ({ ok: true }),
    budget: createLoopBudget({ signal: c1.signal }),
  });
  assert.equal(called, 0);
  assert.equal(r1.ok, false);
  assert.equal(r1.aborted, true);
  assert.equal(r1.written, true);
  assert.ok(r1.stats);

  const c2 = new AbortController();
  const r2 = await runResponsesToolLoop({
    send: async () => { c2.abort(); throw new Error('aborted'); },
    payload: basePayload(),
    tools: () => chatTools,
    executeTool: async () => ({ ok: true }),
    budget: createLoopBudget({ signal: c2.signal }),
  });
  assert.equal(r2.ok, false);
  assert.equal(r2.aborted, true);
  assert.equal(r2.written, true);
  assert.ok(r2.stats);
});
