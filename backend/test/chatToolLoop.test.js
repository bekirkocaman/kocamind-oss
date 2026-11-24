const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const express = require('express');
const request = require('supertest');
const { registerChatRoutes, liveDataRules } = require('../routes/chat');
const { buildOpenAIResponsesPayload, pipeResponsesAsChatCompletions, toChatCompletion } = require('../openaiResponses');
const { ToolRegistry, objectSchema, z, RISK_LEVELS } = require('../agent/toolRegistry');
const { createDefaultToolRegistry } = require('../agent/tools');
const { AgentRunner } = require('../agent/runner');
const { mergeToolCallDeltas } = require('../llm/chatToolLoop');

function testRegistry(executed = []) {
  const registry = new ToolRegistry();
  registry.register({
    name: 'convert_currency',
    description: 'Kur çevirir.',
    inputSchema: z.object({ amount: z.number(), from: z.string(), to: z.string() }).strict(),
    jsonSchema: objectSchema({ amount: { type: 'number' }, from: { type: 'string' }, to: { type: 'string' } }, ['amount', 'from', 'to']),
    execute: async args => { executed.push(args); return { converted: args.amount * 0.877, rate: 0.877 }; },
  });
  registry.register({
    name: 'web_search',
    description: 'Arar.',
    nativeEquivalent: 'web_search',
    inputSchema: z.object({ query: z.string() }).strict(),
    jsonSchema: objectSchema({ query: { type: 'string' } }, ['query']),
    execute: async ({ query }) => ({ query, results: [] }),
  });
  registry.register({
    name: 'send_email',
    description: 'E-posta gönderir.',
    riskLevel: RISK_LEVELS.HIGH,
    requiresConfirmation: true,
    inputSchema: z.object({ to: z.string() }).strict(),
    jsonSchema: objectSchema({ to: { type: 'string' } }, ['to']),
    execute: async () => { throw new Error('çalışmamalıydı'); },
  });
  return registry;
}

function app(fetch, registry, extra = {}) {
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
  process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'test-key';
  const server = express();
  server.use(express.json());
  registerChatRoutes(server, {
    enforceDailyQuota: () => (req, res, next) => next(),
    hasActivePlus: async () => false,
    DEFAULT_MODEL: { id: 'gpt-5.6-luna', provider: 'openai' },
    PROVIDERS: {
      openai: { name: 'OpenAI', envKey: 'OPENAI_API_KEY', baseUrl: 'https://openai.test/v1/responses', nativeResponses: true },
      deepseek: { name: 'DeepSeek', envKey: 'DEEPSEEK_API_KEY', baseUrl: 'https://deepseek.test/v1/chat/completions' },
    },
    MODEL_CATALOG: [
      { id: 'gpt-5.6-luna', provider: 'openai' },
      { id: 'deepseek-chat', provider: 'deepseek' },
      { id: 'deepseek-reasoner', provider: 'deepseek' },
    ],
    ACTIVE_PROVIDERS: new Set(['openai', 'deepseek']),
    ASSISTANT_PROMPTS: { tiger: 'Türkçe cevap ver.' },
    buildOpenAIResponsesPayload,
    pipeResponsesAsChatCompletions,
    toChatCompletion,
    fetch,
    toolRegistry: registry,
    now: () => new Date('2026-10-12T12:00:00Z'),
    ...extra,
  });
  return server;
}

const jsonResponse = body => ({ ok: true, status: 200, json: async () => body });
const sseResponse = chunks => ({
  ok: true,
  status: 200,
  body: Readable.from(chunks.map(chunk => `data: ${typeof chunk === 'string' ? chunk : JSON.stringify(chunk)}\n\n`)),
});

test('DeepSeek ortak aracı çağırır, sonuç modele geri verilir (akışsız)', async () => {
  const payloads = [];
  const executed = [];
  const responses = [
    jsonResponse({ choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'convert_currency', arguments: '{"amount":3000,"from":"MKD","to":"TRY"}' } }] } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }),
    jsonResponse({ choices: [{ message: { content: '3000 MKD ≈ 2.631 TL' } }], usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 } }),
  ];
  const fetch = async (url, init) => { payloads.push(JSON.parse(init.body)); return responses.shift(); };

  const response = await request(app(fetch, testRegistry(executed)))
    .post('/chat').send({ message: '3000 mkd ne kadar tl', provider: 'deepseek', model: 'deepseek-chat' });

  assert.equal(response.status, 200);
  assert.equal(response.body.choices[0].message.content, '3000 MKD ≈ 2.631 TL');
  assert.equal(response.body.usage.total_tokens, 43);
  assert.deepEqual(executed, [{ amount: 3000, from: 'MKD', to: 'TRY' }]);
  assert.equal(payloads.length, 2);
  const toolNames = payloads[0].tools.map(tool => tool.function.name);
  assert.deepEqual(toolNames.sort(), ['convert_currency', 'web_search']);
  const toolMessage = payloads[1].messages.find(message => message.role === 'tool');
  assert.equal(toolMessage.tool_call_id, 'c1');
  assert.match(toolMessage.content, /0\.877/);
});

test('Akışta parça parça gelen araç çağrısı birleşir; düşünce geri gönderilir', async () => {
  const payloads = [];
  const responses = [
    sseResponse([
      { choices: [{ delta: { reasoning_content: 'Kura bakmalıyım.' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'convert_currency', arguments: '{"amount":3000,' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"from":"MKD","to":"TRY"}' } }] }, finish_reason: 'tool_calls' }] },
      { choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
      '[DONE]',
    ]),
    sseResponse([
      { choices: [{ delta: { content: '2.631 TL' } }] },
      { choices: [{ delta: { content: ' ediyor.' }, finish_reason: 'stop' }] },
      '[DONE]',
    ]),
  ];
  const fetch = async (url, init) => { payloads.push(JSON.parse(init.body)); return responses.shift(); };

  const response = await request(app(fetch, testRegistry()))
    .post('/chat').send({ message: 'kur?', provider: 'deepseek', model: 'deepseek-reasoner', stream: true });

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /text\/event-stream/);
  const streamedText = response.text.split('\n')
    .filter(line => line.startsWith('data: {'))
    .map(line => JSON.parse(line.slice(6)).choices?.[0]?.delta?.content || '')
    .join('');
  assert.equal(streamedText, '2.631 TL ediyor.');
  assert.match(response.text, /"reasoning_content":"Kura bakmalıyım\."/);
  assert.match(response.text, /"kocamind_tool":\{"name":"convert_currency","status":"completed"\}/);
  assert.ok(response.text.trim().endsWith('data: [DONE]'));
  const assistantTurn = payloads[1].messages.find(message => message.role === 'assistant' && message.tool_calls);
  assert.equal(assistantTurn.reasoning_content, 'Kura bakmalıyım.');
  assert.equal(assistantTurn.tool_calls[0].function.arguments, '{"amount":3000,"from":"MKD","to":"TRY"}');
});

test('Onay isteyen araç sohbette verilmez ve çağrılsa bile çalışmaz', async () => {
  const payloads = [];
  const responses = [
    jsonResponse({ choices: [{ message: { tool_calls: [{ id: 'c1', type: 'function', function: { name: 'send_email', arguments: '{"to":"a@b.c"}' } }] } }] }),
    jsonResponse({ choices: [{ message: { content: 'Gönderemem.' } }] }),
  ];
  const fetch = async (url, init) => { payloads.push(JSON.parse(init.body)); return responses.shift(); };
  const response = await request(app(fetch, testRegistry()))
    .post('/chat').send({ message: 'mail at', provider: 'deepseek', model: 'deepseek-chat' });
  assert.equal(response.status, 200);
  assert.ok(!payloads[0].tools.some(tool => tool.function.name === 'send_email'));
  assert.match(payloads[1].messages.find(message => message.role === 'tool').content, /kullanılamıyor/);
});

test('Web araması kapalıysa web_search aracı verilmez, diğer araçlar kalır', async () => {
  const payloads = [];
  const fetch = async (url, init) => { payloads.push(JSON.parse(init.body)); return jsonResponse({ choices: [{ message: { content: 'ok' } }] }); };
  await request(app(fetch, testRegistry())).post('/chat').send({ message: 'x', provider: 'deepseek', model: 'deepseek-chat', web_search: false });
  assert.deepEqual(payloads[0].tools.map(tool => tool.function.name), ['convert_currency']);
});

test('Araç döngüsü sınırında model araçsız cevap vermeye zorlanır', async () => {
  const payloads = [];
  const fetch = async (url, init) => {
    const payload = JSON.parse(init.body);
    payloads.push(payload);
    if (payload.tool_choice === 'none') return jsonResponse({ choices: [{ message: { content: 'Elimdekiyle cevap.' } }] });
    return jsonResponse({ choices: [{ message: { tool_calls: [{ id: `c${payloads.length}`, type: 'function', function: { name: 'web_search', arguments: `{"query":"q${payloads.length}"}` } }] } }] });
  };
  const response = await request(app(fetch, testRegistry())).post('/chat').send({ message: 'x', provider: 'deepseek', model: 'deepseek-chat' });
  assert.equal(response.body.choices[0].message.content, 'Elimdekiyle cevap.');
  assert.equal(payloads.at(-1).tool_choice, 'none');
  assert.ok(payloads.length <= 6);
});

test('İlk sağlayıcı hatası eskisi gibi genel mesajla döner', async () => {
  const fetch = async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'Insufficient Balance' } }) });
  const response = await request(app(fetch, testRegistry())).post('/chat').send({ message: 'x', provider: 'deepseek', model: 'deepseek-chat' });
  assert.equal(response.status, 429);
  assert.doesNotMatch(JSON.stringify(response.body), /Balance/);
});

test('OpenAI yerleşik web aramasını korur ve ortak araçları function olarak alır (web_search tekrarlanmaz)', async () => {
  const payloads = [];
  const fetch = async (url, init) => { payloads.push(JSON.parse(init.body)); return jsonResponse({ id: 'r1', status: 'completed', output_text: 'Merhaba' }); };
  const response = await request(app(fetch, testRegistry())).post('/chat').send({ message: 'Selam' });
  assert.equal(response.status, 200);
  assert.deepEqual(payloads[0].tools, [{ type: 'web_search' }, { type: 'function', name: 'convert_currency', description: payloads[0].tools[1].description, parameters: payloads[0].tools[1].parameters, strict: false }]);
  assert.ok(payloads[0].include.includes('reasoning.encrypted_content'));
});

test('OpenAI araç döngüsü 400 alırsa sohbet araçsız yoldan devam eder', async () => {
  const payloads = [];
  const fetch = async (url, init) => {
    const payload = JSON.parse(init.body);
    payloads.push(payload);
    if (payload.tools?.some(tool => tool.type === 'function')) return { ok: false, status: 400, json: async () => ({ error: { param: 'tools[1]', message: 'Invalid schema' } }) };
    return jsonResponse({ id: 'r2', status: 'completed', output_text: 'Araçsız cevap' });
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    const response = await request(app(fetch, testRegistry())).post('/chat').send({ message: 'Selam' });
    assert.equal(response.status, 200);
    assert.equal(response.body.choices[0].message.content, 'Araçsız cevap');
    assert.deepEqual(payloads.at(-1).tools, [{ type: 'web_search' }]);
  } finally {
    console.warn = warn;
  }
});

test('OPENAI_CHAT_TOOLS=false ise OpenAI eski araçsız yolu kullanır', async () => {
  const payloads = [];
  const fetch = async (url, init) => { payloads.push(JSON.parse(init.body)); return jsonResponse({ id: 'r1', status: 'completed', output_text: 'Merhaba' }); };
  process.env.OPENAI_CHAT_TOOLS = 'false';
  try {
    await request(app(fetch, testRegistry())).post('/chat').send({ message: 'Selam' });
    assert.deepEqual(payloads[0].tools, [{ type: 'web_search' }]);
  } finally {
    delete process.env.OPENAI_CHAT_TOOLS;
  }
});

test('Bütün modellerin talimatına bugünün tarihi ve güncel bilgi kuralı eklenir', async () => {
  const payloads = [];
  const fetch = async (url, init) => { payloads.push(JSON.parse(init.body)); return jsonResponse({ id: 'r1', status: 'completed', output_text: 'ok', choices: [{ message: { content: 'ok' } }] }); };
  const server = app(fetch, testRegistry());
  await request(server).post('/chat').send({ message: 'x' });
  await request(server).post('/chat').send({ message: 'x', provider: 'deepseek', model: 'deepseek-chat' });
  assert.match(payloads[0].instructions, /12 Ekim 2026/);
  assert.match(payloads[1].messages[0].content, /12 Ekim 2026/);
  assert.match(liveDataRules(new Date('2026-10-12T12:00:00Z')), /kesin rakamla verme/);
});

test('index göndermeyen sağlayıcıların araç deltaları id ile birleşir', () => {
  const calls = [];
  mergeToolCallDeltas(calls, [{ id: 'a', function: { name: 'web_search', arguments: '{"query":' } }]);
  mergeToolCallDeltas(calls, [{ id: 'a', function: { arguments: '"x"}' } }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.arguments, '{"query":"x"}');
});

test('mergeToolCallDeltas extra_content varsa korur, yoksa eklemez', () => {
  const calls = [];
  mergeToolCallDeltas(calls, [{
    index: 0,
    id: 'g1',
    function: { name: 'web_search', arguments: '{"query":' },
    extra_content: { google: { thought_signature: 'sig-1' } },
  }]);
  mergeToolCallDeltas(calls, [{
    index: 0,
    function: { arguments: '"test"}' },
  }]);
  mergeToolCallDeltas(calls, [{
    index: 1,
    id: 'd1',
    function: { name: 'convert_currency', arguments: '{}' },
  }]);
  assert.deepEqual(calls[0].extra_content, { google: { thought_signature: 'sig-1' } });
  assert.equal('extra_content' in calls[1], false);
});

test('Ortak registry web_search içerir ve sohbet formatına çevrilir', async () => {
  const registry = createDefaultToolRegistry({ env: {}, webSearch: async () => ({ items: [{ title: 'T', link: 'https://e.com', snippet: 'S' }], aiSummary: 'özet' }) });
  const tools = registry.toChatCompletionsTools({});
  assert.ok(tools.some(tool => tool.function.name === 'web_search'));
  assert.ok(tools.every(tool => tool.type === 'function' && tool.function.parameters));
  const result = await registry.get('web_search').execute({ query: 'q' });
  assert.equal(result.results[0].url, 'https://e.com');
  assert.equal(result.untrustedContent, true);
});

test('OpenAI agent yerleşik arama açıkken ortak web_search aracını tekrar vermez', () => {
  const runner = new AgentRunner({ registry: testRegistry(), store: {}, apiKey: 'x' });
  const withNative = runner.buildTools({ context: { enableWebSearch: true }, mode: 'agent' });
  assert.equal(withNative.filter(tool => tool.type === 'web_search' || tool.name === 'web_search').length, 1);
  assert.equal(withNative[0].type, 'web_search');
  const withoutNative = runner.buildTools({ context: { enableWebSearch: false }, mode: 'agent' });
  assert.ok(withoutNative.some(tool => tool.name === 'web_search'));
});

test('DeepSeek araç şemasını 400 ile reddederse sohbet araçsız devam eder', async () => {
  const payloads = [];
  const fetch = async (url, init) => {
    const payload = JSON.parse(init.body);
    payloads.push(payload);
    if (payload.tools) return { ok: false, status: 400, json: async () => ({ error: { message: 'Invalid tools schema' } }) };
    return jsonResponse({ choices: [{ message: { content: 'Araçsız cevap' } }] });
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    const response = await request(app(fetch, testRegistry())).post('/chat').send({ message: 'x', provider: 'deepseek', model: 'deepseek-chat' });
    assert.equal(response.status, 200);
    assert.equal(response.body.choices[0].message.content, 'Araçsız cevap');
    assert.equal(payloads.at(-1).tools, undefined);
  } finally {
    console.warn = warn;
  }
});

test('Bilgi sorusunda arama sonuçları kullanıcı mesajından önce modele verilir; DeepSeek düşük sıcaklıkla çağrılır', async () => {
  const registry = testRegistry();
  registry.get('web_search', {}).execute = async ({ query }) => ({
    query,
    results: [{ title: 'Airborne', url: 'https://rust.facepunch.com/news/airborne', snippet: 'Added Attack Helicopter' }],
  });
  const payloads = [];
  const fetch = async (url, init) => { payloads.push(JSON.parse(init.body)); return jsonResponse({ choices: [{ message: { content: 'Eylül 2023.' } }] }); };
  const providers = {
    openai: { name: 'OpenAI', envKey: 'OPENAI_API_KEY', baseUrl: 'https://openai.test/v1/responses', nativeResponses: true },
    deepseek: { name: 'DeepSeek', envKey: 'DEEPSEEK_API_KEY', baseUrl: 'https://deepseek.test/v1/chat/completions', defaultTemperature: 0.3 },
  };
  const response = await request(app(fetch, registry, { PROVIDERS: providers }))
    .post('/chat').send({ message: 'Rust atak helikopteri ne zaman eklendi?', provider: 'deepseek', model: 'deepseek-chat' });
  assert.equal(response.status, 200);
  const { messages, temperature } = payloads[0];
  assert.equal(temperature, 0.3);
  assert.equal(messages.at(-1).role, 'user');
  assert.equal(messages.at(-2).role, 'system');
  assert.match(messages.at(-2).content, /rust\.facepunch\.com\/news\/airborne/);
});

test('web_search kapalıysa ya da mesaj sohbetse önce-arama yapılmaz', async () => {
  const registry = testRegistry();
  let searched = 0;
  registry.get('web_search', {}).execute = async () => { searched += 1; return { results: [{ title: 't', url: 'u' }] }; };
  const fetch = async () => jsonResponse({ choices: [{ message: { content: 'ok' } }] });
  await request(app(fetch, registry)).post('/chat').send({ message: 'GTA 6 ne zaman çıkıyor?', provider: 'deepseek', model: 'deepseek-chat', web_search: false });
  await request(app(fetch, registry)).post('/chat').send({ message: 'selam kanka', provider: 'deepseek', model: 'deepseek-chat' });
  assert.equal(searched, 0);
});

test('maxToolCalls: 1 bütçesiyle iki araç isteyen turda biri çalışır diğeri sınır çıktısı alır ve sonraki istek tool_choice: none ile gider', async () => {
  const { runChatToolLoop } = require('../llm/chatToolLoop');
  const { createLoopBudget } = require('../llm/toolRound');
  const bodies = [];
  const executed = [];
  const responses = [
    jsonResponse({
      choices: [{
        message: {
          content: null,
          tool_calls: [
            { id: 'c1', type: 'function', function: { name: 'web_search', arguments: '{"query":"bir"}' } },
            { id: 'c2', type: 'function', function: { name: 'web_search', arguments: '{"query":"iki"}' } },
          ],
        },
      }],
    }),
    jsonResponse({ choices: [{ message: { content: 'Tek araçla cevap.' } }] }),
  ];
  const budget = createLoopBudget({ maxToolCalls: 1 });
  const result = await runChatToolLoop({
    send: async body => { bodies.push(body); return responses.shift(); },
    payload: { model: 'deepseek-chat', messages: [{ role: 'user', content: 'sor' }], stream: false },
    tools: [{ type: 'function', function: { name: 'web_search', parameters: {} } }],
    executeTool: async (name, args) => { executed.push([name, args]); return { ok: true, result: 'bulundu' }; },
    budget,
  });
  assert.equal(result.ok, true);
  assert.equal(executed.length, 1);
  assert.equal(bodies[0].tool_choice, 'auto');
  assert.equal(bodies[1].tool_choice, 'none');
  const toolMessages = bodies[1].messages.filter(m => m.role === 'tool');
  assert.equal(toolMessages.length, 2);
  assert.match(toolMessages[0].content, /bulundu/);
  assert.deepEqual(JSON.parse(toolMessages[1].content), { ok: false, error: 'Araç çağrısı sınırına ulaşıldı.' });
  assert.equal(result.stats.toolCalls, 1);
  assert.equal(result.stats.limitReached, 'tool_calls');
});

test('süresi dolmuş bütçede ilk tur tool_choice: none ile gider ve dönüşte stats vardır', async () => {
  const { runChatToolLoop } = require('../llm/chatToolLoop');
  const { createLoopBudget } = require('../llm/toolRound');
  let clock = 1000;
  const budget = createLoopBudget({ maxWallTimeMs: 500, now: () => clock });
  clock = 2000;
  const bodies = [];
  const result = await runChatToolLoop({
    send: async body => { bodies.push(body); return jsonResponse({ choices: [{ message: { content: 'Hızlı cevap.' } }] }); },
    payload: { model: 'deepseek-chat', messages: [{ role: 'user', content: 'sor' }], stream: false },
    tools: [{ type: 'function', function: { name: 'web_search', parameters: {} } }],
    executeTool: async () => ({ ok: true }),
    budget,
  });
  assert.equal(result.ok, true);
  assert.equal(bodies[0].tool_choice, 'none');
  assert.equal(result.stats.limitReached, 'time');
});

test('iptal edilmiş sinyalde send hiç çağrılmaz ve aborted: true döner; send fırlatırken sinyal iptal edilmişse aborted: true döner', async () => {
  const { runChatToolLoop } = require('../llm/chatToolLoop');
  const { createLoopBudget } = require('../llm/toolRound');

  const preAborted = new AbortController();
  preAborted.abort();
  let sendCalled = 0;
  const res1 = await runChatToolLoop({
    send: async () => { sendCalled += 1; return jsonResponse({}); },
    payload: { model: 'deepseek-chat', messages: [{ role: 'user', content: 'sor' }], stream: false },
    tools: [],
    executeTool: async () => ({ ok: true }),
    budget: createLoopBudget({ signal: preAborted.signal }),
  });
  assert.equal(sendCalled, 0);
  assert.equal(res1.ok, false);
  assert.equal(res1.aborted, true);
  assert.equal(res1.written, true);
  assert.ok(res1.stats);

  const midAbort = new AbortController();
  const res2 = await runChatToolLoop({
    send: async () => { midAbort.abort(); throw new Error('istek iptal edildi'); },
    payload: { model: 'deepseek-chat', messages: [{ role: 'user', content: 'sor' }], stream: false },
    tools: [],
    executeTool: async () => ({ ok: true }),
    budget: createLoopBudget({ signal: midAbort.signal }),
  });
  assert.equal(res2.ok, false);
  assert.equal(res2.aborted, true);
  assert.equal(res2.written, true);
  assert.ok(res2.stats);
});

test('Akışta iki Buffer parçasına bölünen çok baytlı Türkçe harfler bozulmaz', async () => {
  const text = 'anlık ş ğ ü';
  const raw = Buffer.from(
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`,
    'utf8',
  );
  const splitIndex = raw.indexOf(Buffer.from('ı', 'utf8')) + 1;
  const fetch = async () => ({
    ok: true,
    status: 200,
    body: Readable.from([raw.subarray(0, splitIndex), raw.subarray(splitIndex)]),
  });

  const response = await request(app(fetch, testRegistry()))
    .post('/chat')
    .send({ message: 'merhaba', provider: 'deepseek', model: 'deepseek-chat', stream: true, web_search: false });

  assert.equal(response.status, 200);
  const streamedText = response.text.split('\n')
    .filter(line => line.startsWith('data: {'))
    .map(line => JSON.parse(line.slice(6)).choices?.[0]?.delta?.content || '')
    .join('');
  assert.equal(streamedText, text);
  assert.equal(streamedText.includes('\uFFFD'), false);
});
