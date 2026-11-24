const test = require('node:test');
const assert = require('node:assert/strict');
const memoryAssist = require('../memoryAssist');

const OK_BODY = JSON.stringify({ memories: [{ key: 'isim', value: 'Bekir', category: 'kisisel' }], forget: [] });

function scriptedFetch(script, calls = []) {
  return async (url, options) => {
    const host = new URL(url).host;
    calls.push({ host, model: JSON.parse(options.body).model });
    const step = script[host];
    if (step instanceof Error) throw step;
    if (step.status && step.status !== 200) {
      return { ok: false, status: step.status, json: async () => ({ error: { message: 'hata' } }) };
    }
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: OK_BODY } }], usage: { prompt_tokens: 1 } }) };
  };
}

function setup(keys) {
  delete process.env.MEMORY_ASSIST_URL;
  delete process.env.MEMORY_ASSIST_MODEL;
  delete process.env.MEMORY_ASSIST_CHAIN;
  delete process.env.MEMORY_ASSIST_KEY_ENV;
  delete process.env.DISABLED_PROVIDERS;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.EVREN_LLM_API_KEY;
  Object.assign(process.env, keys);
  memoryAssist.resetAssistProviderState();
}

const DEEPSEEK = 'api.deepseek.com';
const EVREN = 'evren-llmapi.ssyz.org.tr';

test('bayrakla kapanan DeepSeek özel URL üzerinden de çağrılmaz, EVREN seçilir', async () => {
  setup({
    DISABLED_PROVIDERS: ' DEEPSeek , OPENAI , evren-preview ',
    DEEPSEEK_API_KEY: 'a', EVREN_LLM_API_KEY: 'b',
    MEMORY_ASSIST_URL: 'https://proxy.example/chat/completions',
  });
  const calls = [];
  const result = await memoryAssist.extractMemories(scriptedFetch({ [EVREN]: { status: 200 } }, calls), { message: 'Adım Bekir' });
  assert.deepEqual(calls, [{ host: EVREN, model: 'qwen3.8-flash-next' }]);
  assert.deepEqual(result.via, { provider: 'evren', model: 'qwen3.8-flash-next' });
  assert.deepEqual(memoryAssist.primaryAssist(), result.via);
});

test('kapalı sağlayıcının alan adı farklı anahtar kullanılsa bile atlanır', async () => {
  setup({
    DISABLED_PROVIDERS: 'deepseek', DEEPSEEK_API_KEY: 'a', EVREN_LLM_API_KEY: 'b',
    MEMORY_ASSIST_URL: 'https://api.deepseek.com/v1/chat/completions', MEMORY_ASSIST_KEY_ENV: 'EVREN_LLM_API_KEY',
    MEMORY_ASSIST_CHAIN: 'deepseek:deepseek-chat',
  });
  assert.equal(memoryAssist.isAssistAvailable(), false);
  const calls = [];
  await assert.rejects(memoryAssist.extractMemories(scriptedFetch({}, calls), { message: 'Adım Bekir' }), { unavailable: true });
  assert.deepEqual(calls, []);
});

test('özel URL alan adı sağlayıcı adını yalnızca metin olarak içeriyorsa engellenmez', async () => {
  const customHost = 'api.deepseek.com.example.test';
  setup({
    DISABLED_PROVIDERS: 'deepseek',
    MEMORY_ASSIST_URL: `https://${customHost}/chat/completions`,
    MEMORY_ASSIST_KEY_ENV: 'EVREN_LLM_API_KEY', EVREN_LLM_API_KEY: 'b',
  });
  const calls = [];
  await memoryAssist.extractMemories(scriptedFetch({ [customHost]: { status: 200 } }, calls), { message: 'Adım Bekir' });
  assert.deepEqual(calls.map(call => call.host), [customHost]);
});

test('DeepSeek 402 verirse EVREN denenir ve sonuç oradan gelir', async () => {
  setup({ DEEPSEEK_API_KEY: 'a', EVREN_LLM_API_KEY: 'b' });
  const calls = [];
  const result = await memoryAssist.extractMemories(scriptedFetch({ [DEEPSEEK]: { status: 402 }, [EVREN]: { status: 200 } }, calls), { message: 'Adım Bekir' });
  assert.deepEqual(calls.map(call => call.host), [DEEPSEEK, EVREN]);
  assert.equal(calls[1].model, 'qwen3.8-flash-next');
  assert.deepEqual(result.memories.map(memory => memory.key), ['isim']);
  assert.deepEqual(result.via, { provider: 'evren', model: 'qwen3.8-flash-next' });
});

test('401, 402 ve 403 alan sağlayıcı atlanır', async () => {
  for (const status of [401, 402, 403]) {
    setup({ DEEPSEEK_API_KEY: 'a', EVREN_LLM_API_KEY: 'b' });
    const result = await memoryAssist.extractMemories(scriptedFetch({ [DEEPSEEK]: { status }, [EVREN]: { status: 200 } }), { message: 'Adım Bekir' });
    assert.equal(result.via.provider, 'evren', `durum ${status}`);
  }
});

test('ağ hatası da sıradaki sağlayıcıya geçirir', async () => {
  setup({ DEEPSEEK_API_KEY: 'a', EVREN_LLM_API_KEY: 'b' });
  const result = await memoryAssist.extractMemories(scriptedFetch({ [DEEPSEEK]: new Error('ECONNRESET'), [EVREN]: { status: 200 } }), { message: 'Adım Bekir' });
  assert.equal(result.via.provider, 'evren');
});

test('anahtarı olmayan sağlayıcıya istek atılmaz', async () => {
  setup({ EVREN_LLM_API_KEY: 'b' });
  const calls = [];
  assert.equal(memoryAssist.isAssistAvailable(), true);
  const result = await memoryAssist.extractMemories(scriptedFetch({ [EVREN]: { status: 200 } }, calls), { message: 'Adım Bekir' });
  assert.deepEqual(calls.map(call => call.host), [EVREN]);
  assert.equal(result.via.provider, 'evren');
});

test('yetkisiz sağlayıcı bir süre atlanır; sonraki çağrı doğrudan EVREN a gider', async () => {
  setup({ DEEPSEEK_API_KEY: 'a', EVREN_LLM_API_KEY: 'b' });
  const script = { [DEEPSEEK]: { status: 402 }, [EVREN]: { status: 200 } };
  await memoryAssist.extractMemories(scriptedFetch(script), { message: 'Adım Bekir' });
  const calls = [];
  await memoryAssist.extractMemories(scriptedFetch(script, calls), { message: 'Adım Bekir' });
  assert.deepEqual(calls.map(call => call.host), [EVREN]);
});

test('hiçbir sağlayıcı çalışmazsa upstream hatası fırlatır', async () => {
  setup({ DEEPSEEK_API_KEY: 'a', EVREN_LLM_API_KEY: 'b' });
  await assert.rejects(
    memoryAssist.extractMemories(scriptedFetch({ [DEEPSEEK]: { status: 402 }, [EVREN]: { status: 401 } }), { message: 'Adım Bekir' }),
    error => error.upstream === true,
  );
});

test('hiç anahtar yoksa kullanılamaz sayılır ve istek atılmaz', async () => {
  setup({});
  const calls = [];
  assert.equal(memoryAssist.isAssistAvailable(), false);
  await assert.rejects(
    memoryAssist.extractMemories(scriptedFetch({}, calls), { message: 'Adım Bekir' }),
    error => error.unavailable === true,
  );
  assert.equal(calls.length, 0);
});

test('/memory/extract rotası DeepSeek düşünce EVREN ile hafızayı yine kaydeder', async () => {
  const express = require('express');
  const request = require('supertest');
  const { registerMemoryRoutes } = require('../routes/memory');
  const { fakeFirestore } = require('./fakeFirestore');
  setup({ DEEPSEEK_API_KEY: 'a', EVREN_LLM_API_KEY: 'b' });
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { uid: 'u1' }; next(); });
  const tracked = [];
  registerMemoryRoutes(app, {
    firestoreDb: fakeFirestore(),
    fetch: scriptedFetch({ [DEEPSEEK]: { status: 402 }, [EVREN]: { status: 200 } }),
    metrics: { track: entry => tracked.push(entry) },
  });
  const response = await request(app).post('/memory/extract').send({ message: 'Adım Bekir' });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.saved.map(memory => memory.key), ['isim']);
  assert.equal(tracked.at(-1).provider, 'evren');
});
