const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const http = require('node:http');
const { PassThrough, Readable } = require('node:stream');
const { setTimeout: delay } = require('node:timers/promises');
const { registerChatRoutes, pickFallbackModel, createBusyModels } = require('../routes/chat');
const { createQuota } = require('../quota');
const { fakeFirestore } = require('./fakeFirestore');
const { createDefaultToolRegistry } = require('../agent/tools');
const { createSkillStore } = require('../skills/skillStore');

const PROVIDERS = {
  deepseek: { name: 'DeepSeek', envKey: 'DEEPSEEK_API_KEY', baseUrl: 'https://deepseek.test/v1/chat/completions' },
  evren: { name: 'EVREN', envKey: 'EVREN_LLM_API_KEY', baseUrl: 'https://evren.test/v1/chat/completions' },
  openai: { name: 'OpenAI', envKey: 'OPENAI_API_KEY', baseUrl: 'https://openai.test/v1/responses', nativeResponses: true },
  groq: { name: 'Groq', envKey: 'GROQ_API_KEY', baseUrl: 'https://groq.test/v1/chat/completions' },
};
const MODEL_CATALOG = [
  { id: 'deepseek-chat', provider: 'deepseek', label: 'DeepSeek V3' },
  { id: 'glm-5.3', provider: 'evren', label: 'GLM 5.3' },
  { id: 'qwen3.8-flash-next', provider: 'evren', label: 'Qwen 3.8 Flash' },
  { id: 'deepseek-v4.1-flash', provider: 'evren', label: 'DeepSeek V4.1 Flash' },
  { id: 'openai/gpt-oss-120b', provider: 'groq', label: 'GPT-OSS 120B' },
];

function fallbackApp(fetch, busyModels = createBusyModels(), options = {}) {
  process.env.DEEPSEEK_API_KEY = 'test-key';
  process.env.EVREN_LLM_API_KEY = 'test-key';
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { uid: 'u1' }; next(); });
  registerChatRoutes(app, {
    enforceDailyQuota: () => (req, res, next) => next(),
    hasActivePlus: async () => false,
    DEFAULT_MODEL: { id: 'deepseek-chat', provider: 'deepseek' },
    PROVIDERS,
    MODEL_CATALOG,
    ACTIVE_PROVIDERS: new Set(['deepseek', 'evren']),
    ASSISTANT_PROMPTS: { tiger: 'Türkçe cevap ver.' },
    fetch,
    busyModels,
    ...options,
  });
  return app;
}

const busy = { ok: false, status: 503, json: async () => ({ error: { message: 'Model şu anda dolu' } }) };
const answer = model => ({ ok: true, status: 200, json: async () => ({ model, choices: [{ message: { role: 'assistant', content: 'Merhaba!' } }] }) });

test('Seçilen model doluysa cevap yedek modelden gelir ve başlıklar bunu söyler', async () => {
  const calls = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, model: body.model });
    return url.includes('evren') ? busy : answer(body.model);
  };
  const response = await request(fallbackApp(fetch)).post('/chat')
    .send({ message: 'Selam', provider: 'evren', model: 'glm-5.3', stream: false, tools: false });

  assert.equal(response.status, 200);
  assert.deepEqual(calls.map(call => call.model), ['glm-5.3', 'deepseek-chat']);
  assert.equal(calls[1].url, PROVIDERS.deepseek.baseUrl);
  assert.equal(response.headers['x-kocamind-model'], 'deepseek-chat');
  assert.equal(response.headers['x-kocamind-provider'], 'deepseek');
  assert.equal(response.headers['x-kocamind-fallback-from'], 'glm-5.3');
  assert.equal(response.headers['x-kocamind-fallback-from-label'], 'GLM 5.3');
  assert.equal(response.body.choices[0].message.content, 'Merhaba!');
});

test('Yedek de doluysa bir kez denenir ve kullanıcıya yoğunluk hatası döner', async () => {
  let calls = 0;
  const fetch = async () => { calls += 1; return busy; };
  const response = await request(fallbackApp(fetch)).post('/chat')
    .send({ message: 'Selam', provider: 'evren', model: 'glm-5.3', stream: false, tools: false });

  assert.equal(calls, 2);
  assert.equal(response.status, 503);
});

test('Dolu dışındaki hatalarda yedeğe geçilmez', async () => {
  let calls = 0;
  const fetch = async () => { calls += 1; return { ok: false, status: 400, json: async () => ({ error: { message: 'Bad input' } }) }; };
  const response = await request(fallbackApp(fetch)).post('/chat')
    .send({ message: 'Selam', provider: 'evren', model: 'glm-5.3', stream: false, tools: false });

  assert.equal(calls, 1);
  assert.equal(response.status, 503);
  assert.equal(response.headers['x-kocamind-fallback-from'], undefined);
});

test('Yedek seçimi: seçilen modeli, anahtarı olmayanı ve Responses sağlayıcısını atlar', () => {
  const env = { EVREN_LLM_API_KEY: 'k', CHAT_FALLBACK_MODELS: 'openai:gpt-5.6-luna,deepseek:deepseek-chat,evren:qwen3.8-flash-next' };
  const catalog = [...MODEL_CATALOG, { id: 'gpt-5.6-luna', provider: 'openai' }];
  const active = new Set(['openai', 'deepseek', 'evren']);

  const fromGlm = pickFallbackModel({ current: { providerId: 'evren', model: 'glm-5.3' }, PROVIDERS, MODEL_CATALOG: catalog, ACTIVE_PROVIDERS: active, env });
  assert.equal(fromGlm.model, 'qwen3.8-flash-next');

  const fromQwen = pickFallbackModel({ current: { providerId: 'evren', model: 'qwen3.8-flash-next' }, PROVIDERS, MODEL_CATALOG: catalog, ACTIVE_PROVIDERS: active, env });
  assert.equal(fromQwen, null);
});

test('Dolu diyen model hatırlanır: sonraki mesaj ona hiç sormadan yedeğe gider', async () => {
  const calls = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body.model);
    return url.includes('evren') ? busy : answer(body.model);
  };
  const app = fallbackApp(fetch);
  const message = { message: 'Selam', provider: 'evren', model: 'glm-5.3', stream: false, tools: false };

  await request(app).post('/chat').send(message);
  const second = await request(app).post('/chat').send(message);

  assert.deepEqual(calls, ['glm-5.3', 'deepseek-chat', 'deepseek-chat']);
  assert.equal(second.status, 200);
  assert.equal(second.headers['x-kocamind-fallback-from'], 'glm-5.3');
});

test('Hatırlama süresi dolunca model tekrar denenir', () => {
  let clock = 0;
  const busyModels = createBusyModels({ cooldownMs: 1000, now: () => clock });
  const glm = { providerId: 'evren', model: 'glm-5.3' };

  busyModels.mark(glm);
  assert.equal(busyModels.isBusy(glm), true);
  clock = 1001;
  assert.equal(busyModels.isBusy(glm), false);
});

test('Dolu olduğu bilinen yedek atlanır', () => {
  const env = { DEEPSEEK_API_KEY: 'k', EVREN_LLM_API_KEY: 'k' };
  const isBusy = model => model.model === 'deepseek-chat';
  const picked = pickFallbackModel({ current: { providerId: 'evren', model: 'glm-5.3' }, PROVIDERS, MODEL_CATALOG, ACTIVE_PROVIDERS: new Set(['deepseek', 'evren']), env, isBusy });
  assert.equal(picked.model, 'qwen3.8-flash-next');
});

const groqModel = 'openai/gpt-oss-120b';
const evrenModel = 'deepseek-v4.1-flash';
const neverReplies = () => new Promise(() => {});
const sse = text => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
const quotaDay = '2026-11-21';

function groqChat(t, fetch, { groqMs = 1_000, evrenMs = 1_000, evrenEnabled = true, retryWaitMs = 12_000, ...options } = {}) {
  const env = {
    GROQ_API_KEY: 'test-key',
    CHAT_GROQ_FIRST_REPLY_TIMEOUT_MS: String(groqMs),
    CHAT_EVREN_FIRST_REPLY_TIMEOUT_MS: String(evrenMs),
    CHAT_GROQ_RETRY_MAX_WAIT_MS: String(retryWaitMs),
    CHAT_FALLBACK_MODELS: 'deepseek:deepseek-chat',
  };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const db = fakeFirestore();
  const quota = createQuota({
    firestoreDb: db,
    FieldValue: { serverTimestamp: () => 'ts' },
    env: { FREE_DAILY_CHAT_LIMIT: '3' },
    now: () => new Date(`${quotaDay}T12:00:00.000Z`),
  });
  const events = [];
  const app = fallbackApp(fetch, undefined, {
    enforceDailyQuota: quota.enforceDailyQuota,
    DEFAULT_MODEL: { id: groqModel, provider: 'groq' },
    ACTIVE_PROVIDERS: new Set(['groq', 'deepseek', ...(evrenEnabled ? ['evren'] : [])]),
    metrics: { track: event => events.push(event) },
    ...options,
  });
  return {
    app,
    send: (stream = false, body = {}) => request(app).post('/chat').send({ message: 'Selam', stream, tools: false, ...body }).timeout({ deadline: 60_000 }),
    count: () => db.docs.get(`usage_daily/u1_${quotaDay}`)?.chat ?? 0,
    settleQuota: () => db.runTransaction(async () => {}),
    events,
  };
}

const limitReply = headers => ({ ok: false, status: 429, headers: new Headers(headers) });
const toolNames = payload => payload.tools?.map(tool => tool.function.name);
const nextTurn = () => new Promise(resolve => setImmediate(resolve));
const mockTime = t => t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse(`${quotaDay}T12:00:00Z`) });
const emptyWebSearch = async () => ({ items: [] });

test('Groq genel soru, hava ve döviz için istek gövdesine sadece ilgili araçları ekler', async t => {
  const payloads = [];
  const skillStore = createSkillStore();
  const toolRegistry = createDefaultToolRegistry({ env: {}, skillStore, webSearch: emptyWebSearch });
  const chat = groqChat(t, async (_url, init) => {
    const payload = JSON.parse(init.body);
    payloads.push(payload);
    return answer(payload.model);
  }, { toolRegistry, skillStore });

  for (const message of ['Fotosentez nedir?', 'İSTANBUL’da hava durumu nasıl?', '100 DOLAR kaç TL?']) {
    assert.equal((await chat.send(false, { message, tools: true })).status, 200);
  }
  assert.deepEqual(payloads.map(toolNames), [
    ['web_search', 'calculate'],
    ['web_search', 'calculate', 'get_weather'],
    ['web_search', 'calculate', 'convert_currency'],
  ]);
});

test('Groq katalogdaki dilekçe işi için load_skill sunar, web_search tercihini korur', async t => {
  const skillStore = createSkillStore();
  const toolRegistry = createDefaultToolRegistry({ env: {}, skillStore, webSearch: emptyWebSearch });
  let payload;
  const chat = groqChat(t, async (_url, init) => {
    payload = JSON.parse(init.body);
    return answer(payload.model);
  }, { toolRegistry, skillStore });

  const reply = await chat.send(false, { message: 'DİLEKÇE hazırla.', tools: true, web_search: false });
  assert.equal(reply.status, 200);
  assert.match(payload.messages[0].content, /load_skill/);
  assert.deepEqual(toolNames(payload), ['calculate', 'load_skill', 'find_skills']);
});

test('Groq kısa sıfırlamada aynı isteği tek kez yeniden gönderir ve kota bir kez kullanılır', { timeout: 5_000 }, async t => {
  mockTime(t);
  const first = Promise.withResolvers();
  const attempts = [];
  const chat = groqChat(t, async (_url, init) => {
    const payload = JSON.parse(init.body);
    attempts.push({ payload, at: Date.now(), signal: init.signal });
    if (attempts.length > 1) return answer(payload.model);
    first.resolve();
    return limitReply({
      'retry-after': '2',
      'x-ratelimit-reset-tokens': '2s500ms',
      'x-ratelimit-remaining-requests': '32',
      'x-ratelimit-reset-requests': '2h30m',
    });
  });

  const response = chat.send().then(reply => reply);
  await first.promise;
  await nextTurn();
  assert.equal(attempts[0].signal.aborted, true);
  t.mock.timers.tick(2499);
  assert.equal(attempts.length, 1);
  t.mock.timers.tick(1);

  const reply = await response;
  assert.equal(reply.status, 200);
  assert.equal(reply.headers['x-kocamind-provider'], 'groq');
  assert.equal(reply.headers['x-kocamind-fallback-from'], undefined);
  assert.deepEqual(attempts.map(attempt => attempt.payload.model), [groqModel, groqModel]);
  assert.deepEqual(attempts[1].payload, attempts[0].payload);
  assert.equal(attempts[1].at - attempts[0].at, 2500);
  assert.equal(chat.count(), 1);
});

test('Groq ikinci 429 sonrası tekrar beklemez, EVREN mevcut araç listesini alır', { timeout: 5_000 }, async t => {
  mockTime(t);
  const first = Promise.withResolvers();
  const payloads = [];
  const skillStore = createSkillStore();
  const toolRegistry = createDefaultToolRegistry({ env: {}, skillStore, webSearch: emptyWebSearch });
  const busyModels = createBusyModels();
  const chat = groqChat(t, async (_url, init) => {
    const payload = JSON.parse(init.body);
    payloads.push(payload);
    if (payloads.length === 1) {
      first.resolve();
      return limitReply({ 'retry-after': new Date(Date.now() + 2000).toUTCString() });
    }
    if (payload.model === groqModel) return limitReply({ 'x-ratelimit-reset-tokens': '4s' });
    return answer(payload.model);
  }, { skillStore, toolRegistry, busyModels });

  const response = chat.send(false, { tools: true }).then(reply => reply);
  await first.promise;
  await nextTurn();
  t.mock.timers.tick(2000);

  const reply = await response;
  assert.equal(reply.status, 200);
  assert.equal(reply.headers['x-kocamind-provider'], 'evren');
  assert.deepEqual(payloads.map(payload => payload.model), [groqModel, groqModel, evrenModel]);
  assert.deepEqual(toolNames(payloads[0]), ['web_search', 'calculate']);
  assert.deepEqual(payloads[1], payloads[0]);
  assert.deepEqual(payloads[2].tools, toolRegistry.toChatCompletionsTools({ userId: 'u1' }));
  assert.equal(chat.count(), 1);
  const target = { providerId: 'groq', model: groqModel };
  t.mock.timers.tick(3999);
  assert.equal(busyModels.isBusy(target), true);
  t.mock.timers.tick(1);
  assert.equal(busyModels.isBusy(target), false);
});

for (const [name, headers, cooldownMs, retryWaitMs] of [
  ['uzun token sıfırlaması', { 'x-ratelimit-reset-tokens': '12.001s' }, 12_001, 12_000],
  ['tükenen günlük kota', { 'retry-after': '1', 'x-ratelimit-remaining-requests': '0', 'x-ratelimit-reset-requests': '1m30s', 'x-ratelimit-reset-tokens': '1s' }, 90_000, 12_000],
  ['env ile düşürülen bekleme sınırı', { 'retry-after': '1.001' }, 1_001, 1_000],
]) {
  test(`Groq ${name} için EVREN'e hemen geçer ve başlık süresi kadar meşgul kalır`, { timeout: 5_000 }, async t => {
    mockTime(t);
    const attempts = [];
    const chat = groqChat(t, async (_url, init) => {
      const { model } = JSON.parse(init.body);
      attempts.push(model);
      return attempts.length === 1 ? limitReply(headers) : answer(model);
    }, { retryWaitMs });

    assert.equal((await chat.send()).headers['x-kocamind-provider'], 'evren');
    t.mock.timers.tick(cooldownMs - 1);
    assert.equal((await chat.send()).headers['x-kocamind-provider'], 'evren');
    t.mock.timers.tick(1);
    assert.equal((await chat.send()).headers['x-kocamind-provider'], 'groq');
    assert.deepEqual(attempts, [groqModel, evrenModel, evrenModel, groqModel]);
    assert.equal(chat.count(), 3);
  });
}

test('Groq ilk çağrı, bekleme ve yeniden denemede ilk yanıt bütçesini en çok 30 saniye kullanır', { timeout: 5_000 }, async t => {
  mockTime(t);
  const first = Promise.withResolvers();
  const second = Promise.withResolvers();
  const attempts = [];
  const chat = groqChat(t, async (_url, init) => {
    const { model } = JSON.parse(init.body);
    attempts.push({ model, at: Date.now(), signal: init.signal });
    if (attempts.length === 1) {
      first.resolve();
      await new Promise(resolve => setTimeout(resolve, 19_000));
      return limitReply({ 'x-ratelimit-reset-tokens': '10s' });
    }
    if (model === groqModel) {
      second.resolve();
      return neverReplies();
    }
    return answer(model);
  }, { groqMs: 20_000 });

  const response = chat.send().then(reply => reply);
  await first.promise;
  t.mock.timers.tick(19_000);
  await nextTurn();
  t.mock.timers.tick(10_000);
  await second.promise;
  assert.equal(attempts[1].at - attempts[0].at, 29_000);
  t.mock.timers.tick(999);
  assert.equal(attempts[1].signal.aborted, false);
  t.mock.timers.tick(1);

  assert.equal((await response).headers['x-kocamind-provider'], 'evren');
  assert.equal(attempts[1].signal.aborted, true);
  assert.equal(attempts[2].at - attempts[0].at, 30_000);
  assert.deepEqual(attempts.map(attempt => attempt.model), [groqModel, groqModel, evrenModel]);
});

for (const searched of [false, true]) {
  test(`Groq sıfırlaması beklenirken bağlantı kapanırsa retry iptal edilir, ön arama ${searched ? 'yapıldıysa kota korunur' : 'yapılmadıysa kota iade edilir'}`, { timeout: 5_000 }, async t => {
    mockTime(t);
    const first = Promise.withResolvers();
    const closed = Promise.withResolvers();
    const attempts = [];
    let searches = 0;
    const toolRegistry = createDefaultToolRegistry({ env: {}, webSearch: async () => { searches++; return { items: [] }; } });
    const chat = groqChat(t, async (_url, init) => {
      attempts.push(JSON.parse(init.body).model);
      first.resolve();
      return limitReply({ 'x-ratelimit-reset-tokens': '2s' });
    }, { toolRegistry });
    const server = chat.app.listen(0, '127.0.0.1');
    server.prependListener('request', (_req, res) => res.once('close', closed.resolve));
    t.after(() => server.close());
    await new Promise(resolve => server.once('listening', resolve));
    const client = http.request({ host: '127.0.0.1', port: server.address().port, path: '/chat', method: 'POST', headers: { 'Content-Type': 'application/json' } });
    t.after(() => client.destroy());
    client.on('error', () => {});
    client.end(JSON.stringify({ message: 'Bugün İstanbul’da hava nasıl?', tools: true, web_search: searched }));

    await first.promise;
    await nextTurn();
    assert.equal(chat.count(), 1);
    assert.equal(searches, Number(searched));
    client.destroy();
    await closed.promise;
    t.mock.timers.tick(2000);
    await nextTurn();
    await chat.settleQuota();
    assert.deepEqual(attempts, [groqModel]);
    assert.equal(chat.count(), Number(searched));
  });
}

for (const [name, groqFailure, status] of [
  ['429', async () => ({ ok: false, status: 429 }), 429],
  ['500', async () => ({ ok: false, status: 500 }), 500],
  ['ağ hatası', async () => { throw new Error('ECONNRESET'); }, 502],
]) {
  test(`Groq ${name} verirse aynı mesaj EVREN'e bir kez gider ve kota bir kez kullanılır`, async t => {
    const calls = [];
    const chat = groqChat(t, async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url, body });
      return body.model === groqModel ? groqFailure() : answer(body.model);
    });

    const response = await chat.send();
    assert.equal(response.status, 200);
    assert.deepEqual(calls.map(call => call.url), [PROVIDERS.groq.baseUrl, PROVIDERS.evren.baseUrl]);
    assert.deepEqual(calls[1].body, { ...calls[0].body, model: evrenModel });
    assert.equal(response.headers['x-kocamind-model'], evrenModel);
    assert.equal(response.headers['x-kocamind-model-label'], 'DeepSeek V4.1 Flash');
    assert.equal(response.headers['x-kocamind-provider'], 'evren');
    assert.equal(response.headers['x-kocamind-fallback-from'], groqModel);
    assert.equal(response.body.model, evrenModel);
    assert.equal(response.headers['x-daily-remaining'], '2');
    assert.equal(chat.count(), 1);
    assert.deepEqual(chat.events.map(event => [event.route, event.model, event.status]), [
      ['chat_model_fallback', groqModel, status], ['chat', evrenModel, 200],
    ]);
  });
}

test('Groq başlıkları gönderip ilk akış parçasını bekletirse istek iptal edilir ve EVREN bir kez denenir', async t => {
  const stalled = new PassThrough();
  t.after(() => stalled.destroy());
  const attempts = [];
  const chat = groqChat(t, async (_url, init) => {
    const { model } = JSON.parse(init.body);
    attempts.push({ model, signal: init.signal });
    if (model === groqModel) {
      init.signal.addEventListener('abort', () => stalled.destroy(), { once: true });
      return { ok: true, status: 200, body: stalled };
    }
    return { ok: true, status: 200, body: Readable.from([sse('EVREN yanıtı'), 'data: [DONE]\n\n']) };
  }, { groqMs: 25 });

  const reply = await chat.send(true);
  assert.equal(reply.status, 200);
  assert.match(reply.text, /EVREN yanıtı/);
  assert.equal(reply.headers['x-kocamind-model'], evrenModel);
  assert.deepEqual(attempts.map(attempt => [attempt.model, attempt.signal.aborted]), [[groqModel, true], [evrenModel, false]]);
  assert.equal(chat.events.find(event => event.route === 'chat_model_fallback').status, 504);
  assert.equal(chat.count(), 1);
});

test('Groq ve EVREN beklerse ikinci yedeğe geçilmez, 504 döner ve kota iade edilir', async t => {
  const attempts = [];
  const chat = groqChat(t, (_url, init) => {
    attempts.push({ model: JSON.parse(init.body).model, signal: init.signal });
    return neverReplies();
  }, { groqMs: 25, evrenMs: 25 });

  const reply = await chat.send();
  assert.equal(reply.status, 504);
  assert.match(reply.body.error.message, /zamanında yanıt vermedi/);
  assert.deepEqual(attempts.map(attempt => [attempt.model, attempt.signal.aborted]), [[groqModel, true], [evrenModel, true]]);
  await chat.settleQuota();
  assert.equal(chat.count(), 0);
});

test('İstemci ilk bayttan önce koparsa Groq iptal edilir, EVREN çağrılmaz ve kota iade edilir', { timeout: 5_000 }, async t => {
  let onStarted;
  let onCancelled;
  const started = new Promise(resolve => { onStarted = resolve; });
  const cancelled = new Promise(resolve => { onCancelled = resolve; });
  const attempts = [];
  const chat = groqChat(t, (_url, init) => {
    attempts.push(JSON.parse(init.body).model);
    init.signal.addEventListener('abort', onCancelled, { once: true });
    onStarted(init.signal);
    return neverReplies();
  }, { groqMs: 4_000 });

  const server = chat.app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise(resolve => server.once('listening', resolve));
  const client = http.request({ host: '127.0.0.1', port: server.address().port, path: '/chat', method: 'POST', headers: { 'Content-Type': 'application/json' } });
  t.after(() => client.destroy());
  client.on('error', () => {});
  client.end(JSON.stringify({ message: 'Selam', stream: true, tools: false }));

  const signal = await started;
  assert.equal(chat.count(), 1);
  client.destroy();
  await cancelled;
  await chat.settleQuota();
  assert.equal(signal.reason.name, 'AbortError');
  assert.deepEqual(attempts, [groqModel]);
  assert.equal(chat.count(), 0);
});

for (const [status, evrenEnabled] of [[400, true], [429, false]]) {
  test(`Groq ${status} ve EVREN ${evrenEnabled ? 'açık' : 'kapalı'} iken yedek kullanılmaz`, async t => {
    const attempts = [];
    const chat = groqChat(t, async (_url, init) => {
      attempts.push(JSON.parse(init.body).model);
      return { ok: false, status, json: async () => ({}) };
    }, { evrenEnabled });

    const reply = await chat.send();
    assert.equal(reply.status, status === 400 ? 503 : 429);
    assert.equal(reply.headers['x-kocamind-fallback-from'], undefined);
    assert.deepEqual(attempts, [groqModel]);
  });
}

test('Groq akışına ilk bayt geldikten sonra zaman aşımı uzun yanıtı kesmez', async t => {
  const attempts = [];
  const chat = groqChat(t, async (_url, init) => {
    attempts.push(JSON.parse(init.body).model);
    return { ok: true, status: 200, body: Readable.from((async function* () {
      yield sse('İlk parça');
      await delay(80);
      assert.equal(init.signal.aborted, false);
      yield sse('Son parça');
      yield 'data: [DONE]\n\n';
    })()) };
  }, { groqMs: 25 });

  const reply = await chat.send(true);
  assert.equal(reply.status, 200);
  assert.match(reply.text, /İlk parça/);
  assert.match(reply.text, /Son parça/);
  assert.deepEqual(attempts, [groqModel]);
});

test('Groq akışında istemciye parça yazıldıktan sonra bağlantı hatası EVREN çağrısı doğurmaz', async t => {
  const attempts = [];
  const chat = groqChat(t, async (_url, init) => {
    attempts.push(JSON.parse(init.body).model);
    return { ok: true, status: 200, body: Readable.from((async function* () {
      yield sse('İlk parça');
      await delay(10);
      throw new Error('ECONNRESET');
    })()) };
  });

  const reply = await chat.send(true);
  assert.equal(reply.status, 200);
  assert.equal(reply.headers['x-kocamind-model'], groqModel);
  assert.match(reply.text, /İlk parça/);
  assert.match(reply.text, /Yanıt akışı kesildi/);
  assert.deepEqual(attempts, [groqModel]);
  assert.equal(chat.count(), 1);
});
