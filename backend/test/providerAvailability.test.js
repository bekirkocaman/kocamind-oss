const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { fakeFirestore } = require('./fakeFirestore');

const defaultEnv = {
  FIREBASE_SERVICE_ACCOUNT: '',
  FIREBASE_PROJECT_ID: 'provider-test',
  OPENAI_API_KEY: 'oa-test',
  DEEPSEEK_API_KEY: 'ds-test',
  EVREN_LLM_API_KEY: 'ev-test',
  GROQ_API_KEY: '',
  GEMINI_CHAT_ENABLED: 'false',
  DISABLED_PROVIDERS: ' OpenAI, DEEPSEEK, evren-preview, , ',
  QDRANT_URL: '',
  AUTO_ROUTER_MODELS: '',
  IDE_MODELS: 'openai:gpt-5.6-luna,deepseek:deepseek-chat,evren:qwen3.8-flash-next',
};

function startApp(t, env = {}) {
  const config = { ...defaultEnv, ...env };
  const previous = Object.fromEntries(Object.keys(config).map(key => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  Object.assign(process.env, config);
  t.mock.method(require('dotenv'), 'config', () => ({}));

  const routerModule = require('../learning/router');
  const createAutoRouter = routerModule.createAutoRouter;
  let autoRouter;
  t.mock.method(routerModule, 'createAutoRouter', options => {
    autoRouter = createAutoRouter(options);
    return autoRouter;
  });

  const calls = [];
  require('node-fetch');
  const fetchModule = require.cache[require.resolve('node-fetch')];
  const realFetch = fetchModule.exports;
  const serverPath = require.resolve('../server');
  let app;
  try {
    fetchModule.exports = async (url, { body }) => {
      const { model } = JSON.parse(body);
      calls.push({ url, model });
      const data = new URL(url).pathname === '/v1/responses'
        ? { model, output: [{ type: 'message', content: [{ type: 'output_text', text: 'Merhaba' }] }] }
        : { model, choices: [{ message: { content: 'Merhaba' } }] };
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => data };
    };
    app = require('../server');
  } finally {
    fetchModule.exports = realFetch;
    delete require.cache[serverPath];
  }

  const db = fakeFirestore();
  const firestoreDb = require('firebase-admin/firestore').getFirestore();
  t.mock.method(firestoreDb, 'collection', db.collection);
  t.mock.method(firestoreDb, 'runTransaction', db.runTransaction);
  t.mock.method(require('firebase-admin/auth').getAuth(), 'verifyIdToken', async () => ({ uid: 'u1', admin: true }));
  return { app, calls, autoRouter };
}

test('kapalı sağlayıcılar model listelerinden ve otomatik seçimden çıkar, varsayılan EVREN olur', async t => {
  const { app, calls, autoRouter } = startApp(t);
  const api = request(app);
  const auth = 'Bearer test';
  const models = await api.get('/models').set('Authorization', auth);
  assert.equal(models.status, 200);
  assert.ok(!models.body.models.some(model => ['openai', 'deepseek'].includes(model.provider) || model.id === 'mimo-v2.6-pro'));
  assert.equal(models.body.models.find(model => model.id === 'auto').available, true);
  assert.equal(models.body.models.find(model => model.id === 'deepseek-v4.1-flash').available, true);
  assert.deepEqual(models.body.models.filter(model => model.provider === 'groq').map(model => [model.id, model.available]), [
    ['openai/gpt-oss-120b', false],
    ['qwen/qwen3.8-27b', false],
  ]);
  assert.deepEqual(autoRouter.candidates().find(model => model.id === 'deepseek-v4.1-flash').prior, { up: 4, down: 1 });
  const ide = await api.get('/ide/models').set('Authorization', auth);
  assert.equal(ide.status, 200);
  assert.deepEqual(ide.body.models.map(model => model.id), ['qwen3.8-flash-next']);

  const send = body => api.post('/chat').set('Authorization', auth).send({ message: 'Merhaba', tools: false, ...body });
  const defaultReply = await send({});
  assert.equal(defaultReply.status, 200);
  assert.equal(defaultReply.headers['x-kocamind-model'], 'deepseek-v4.1-flash');
  const autoReply = await send({ model: 'auto' });
  assert.equal(autoReply.status, 200);
  assert.equal(autoReply.headers['x-kocamind-provider'], 'evren');
  assert.equal((await send({ provider: 'openai', model: 'gpt-5.6-luna' })).status, 400);
  assert.equal((await send({ provider: 'deepseek', model: 'deepseek-chat' })).status, 400);

  for (const path of ['/agent/run', '/agent/runs/example/confirm']) {
    const agent = await api.post(path).set('Authorization', auth).send({ message: 'Merhaba' });
    assert.equal(agent.status, 503);
    assert.deepEqual(agent.body, { error: 'OpenAI şu an kullanılamıyor.' });
  }
  const profile = await api.post('/profile/analyze').set('Authorization', auth).send({ targetUserId: 'u1', messages: [{ role: 'user', content: 'Merhaba' }] });
  assert.equal(profile.status, 503);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => new URL(call.url).hostname === 'evren-llmapi.ssyz.org.tr'));
});

for (const [name, disabled, expectedModel] of [
  ['Luna açıksa öncelikli kalır', 'deepseek', 'gpt-5.6-luna'],
  ['Luna kapalıysa Groq GPT-OSS 120B varsayılan olur', 'openai,deepseek', 'openai/gpt-oss-120b'],
  ['Groq açıkça kapatıldığında Groq modelleri çıkar ve EVREN varsayılan olur', 'openai,deepseek, GrOQ ', 'deepseek-v4.1-flash'],
]) {
  test(name, async t => {
    const { app, calls, autoRouter } = startApp(t, { GROQ_API_KEY: 'groq-test', DISABLED_PROVIDERS: disabled });
    const api = request(app);
    const models = await api.get('/models').set('Authorization', 'Bearer test');
    assert.equal(models.status, 200);
    const groqModels = models.body.models.filter(model => model.provider === 'groq');
    const groqDisabled = expectedModel === 'deepseek-v4.1-flash';
    assert.deepEqual(groqModels.map(model => [model.id, model.label, model.available]), groqDisabled ? [] : [
      ['openai/gpt-oss-120b', 'GPT-OSS 120B', true],
      ['qwen/qwen3.8-27b', 'Qwen 3.8 27B', true],
    ]);
    const candidates = autoRouter.candidates();
    assert.deepEqual(candidates.filter(model => model.prior.up === 4).map(model => model.id), [expectedModel]);
    assert.equal(candidates.some(model => model.provider === 'groq'), !groqDisabled);

    const reply = await api.post('/chat').set('Authorization', 'Bearer test').send({ message: 'Merhaba', tools: false });
    assert.equal(reply.status, 200);
    assert.equal(reply.headers['x-kocamind-model'], expectedModel);
    assert.deepEqual(calls.map(call => call.model), [expectedModel]);
    if (groqDisabled) {
      const rejected = await api.post('/chat').set('Authorization', 'Bearer test')
        .send({ message: 'Merhaba', provider: 'groq', model: 'openai/gpt-oss-120b' });
      assert.equal(rejected.status, 400);
      assert.equal(calls.length, 1);
    }
  });
}

test('hiç kullanılabilir model kalmazsa /chat mevcut servis hatasıyla 503 döner', async t => {
  const { app, calls } = startApp(t, { DISABLED_PROVIDERS: 'openai,deepseek,evren' });
  const response = await request(app).post('/chat').set('Authorization', 'Bearer test').send({ message: 'Merhaba' });
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { error: { message: 'Yapay zekâ servisine şu anda ulaşılamıyor. Biraz sonra tekrar dene.' } });
  assert.deepEqual(calls, []);
});
