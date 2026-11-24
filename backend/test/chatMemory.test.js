const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const express = require('express');
const request = require('supertest');
const { z } = require('zod');
const { registerChatRoutes } = require('../routes/chat');
const {
  buildOpenAIResponsesPayload,
  pipeResponsesAsChatCompletions,
  toChatCompletion,
} = require('../openaiResponses');
const { ToolRegistry, objectSchema } = require('../agent/toolRegistry');

const samplePack = {
  version: 2,
  builtAt: '2026-11-10T12:00:00.000Z',
  core: [{ key: 'isim', value: 'Bekir' }],
  optional: [{ key: 'araba', value: 'Kırmızı Toyota' }],
  lastLearn: null,
};

function chatMemoryApp(fetch, {
  uid = 'u1',
  packStore = null,
  learner = null,
  serverLearn = false,
  consumeDailyQuota = null,
  metrics = { track() {} },
  toolRegistry = null,
} = {}) {
  process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'test-key';
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = uid ? { uid } : undefined;
    next();
  });
  registerChatRoutes(app, {
    enforceDailyQuota: () => (_req, _res, next) => next(),
    hasActivePlus: async () => false,
    DEFAULT_MODEL: { id: 'deepseek-chat', provider: 'deepseek' },
    PROVIDERS: {
      deepseek: {
        name: 'DeepSeek',
        envKey: 'DEEPSEEK_API_KEY',
        baseUrl: 'https://deepseek.test/v1/chat/completions',
      },
    },
    MODEL_CATALOG: [{ id: 'deepseek-chat', provider: 'deepseek' }],
    ACTIVE_PROVIDERS: new Set(['deepseek']),
    ASSISTANT_PROMPTS: { tiger: 'Türkçe cevap ver.' },
    buildOpenAIResponsesPayload,
    pipeResponsesAsChatCompletions,
    toChatCompletion,
    fetch,
    metrics,
    toolRegistry,
    packStore,
    learner,
    serverLearn,
    consumeDailyQuota,
  });
  return app;
}

const okFetch = (payloads = []) => async (_url, init) => {
  if (init?.body) payloads.push(JSON.parse(init.body));
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { role: 'assistant', content: 'Tamam' }, finish_reason: 'stop' }] }),
  };
};

function waitWithTimeout(promise, ms = 200) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('learn çağrısı zaman aşımına uğradı')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

test('memory: "server" ile paket system prompt\'a girer', async () => {
  const payloads = [];
  const packStore = { get: async () => samplePack };
  const app = chatMemoryApp(okFetch(payloads), { packStore });

  const res = await request(app)
    .post('/chat')
    .send({ message: 'Merhaba', memory: 'server', stream: false, tools: false });

  assert.equal(res.status, 200);
  const systemPrompt = payloads[0].messages[0].content;
  assert.match(systemPrompt, /Kullanıcı hakkında hafızandaki bilgiler/);
  assert.match(systemPrompt, /- isim: Bekir/);
  assert.match(systemPrompt, /- araba: Kırmızı Toyota/);
});

test('memory alanı yoksa hafıza eklenmez ve packStore.get çağrılmaz', async () => {
  const payloads = [];
  let getCalls = 0;
  const packStore = {
    get: async () => {
      getCalls += 1;
      return samplePack;
    },
  };
  const app = chatMemoryApp(okFetch(payloads), { packStore });

  const res = await request(app)
    .post('/chat')
    .send({ message: 'Merhaba', stream: false, tools: false });

  assert.equal(res.status, 200);
  assert.equal(getCalls, 0);
  const systemPrompt = payloads[0].messages[0].content;
  assert.doesNotMatch(systemPrompt, /Kullanıcı hakkında hafızandaki bilgiler/);
});

test('paket null dönerse sohbet hafızasız 200 döner', async () => {
  const payloads = [];
  const packStore = { get: async () => null };
  const app = chatMemoryApp(okFetch(payloads), { packStore });

  const res = await request(app)
    .post('/chat')
    .send({ message: 'Merhaba', memory: 'server', stream: false, tools: false });

  assert.equal(res.status, 200);
  const systemPrompt = payloads[0].messages[0].content;
  assert.doesNotMatch(systemPrompt, /Kullanıcı hakkında hafızandaki bilgiler/);
});

test('packStore.get fırlatsa bile sohbet 200 döner', async () => {
  const payloads = [];
  const packStore = {
    get: async () => {
      throw new Error('beklenmedik hata');
    },
  };
  const app = chatMemoryApp(okFetch(payloads), { packStore });

  const res = await request(app)
    .post('/chat')
    .send({ message: 'Merhaba', memory: 'server', stream: false, tools: false });

  assert.equal(res.status, 200);
});

test('memory_learn ile 200 cevaptan sonra learn doğru uid ve mesajla çağrılır', async () => {
  const learnCalls = [];
  let resolveLearn;
  const learnPromise = new Promise(resolve => { resolveLearn = resolve; });
  const learner = {
    learn: async args => {
      learnCalls.push(args);
      resolveLearn();
      return { saved: [], forgotten: [], skipped: false, usage: null };
    },
  };
  const app = chatMemoryApp(okFetch(), { learner, serverLearn: true });

  const res = await request(app)
    .post('/chat')
    .send({ message: 'Benim adım Bekir', memory_learn: true, stream: false, tools: false });

  assert.equal(res.status, 200);
  await waitWithTimeout(learnPromise);
  assert.equal(learnCalls.length, 1);
  assert.equal(learnCalls[0].uid, 'u1');
  assert.equal(learnCalls[0].message, 'Benim adım Bekir');
});

test('sağlayıcı 503 dönerse learn çağrılmaz', async () => {
  let learnCalled = false;
  const learner = {
    learn: async () => {
      learnCalled = true;
    },
  };
  const failingFetch = async () => ({
    ok: false,
    status: 503,
    json: async () => ({ error: { message: 'yoğun' } }),
  });
  const app = chatMemoryApp(failingFetch, { learner, serverLearn: true });

  const res = await request(app)
    .post('/chat')
    .send({ message: 'Benim adım Bekir', memory_learn: true, stream: false, tools: false });

  assert.equal(res.status, 503);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(learnCalled, false);
});

test('serverLearn kapalıyken learn çağrılmaz', async () => {
  let learnCalled = false;
  const learner = {
    learn: async () => {
      learnCalled = true;
    },
  };
  const app = chatMemoryApp(okFetch(), { learner, serverLearn: false });

  const res = await request(app)
    .post('/chat')
    .send({ message: 'Benim adım Bekir', memory_learn: true, stream: false, tools: false });

  assert.equal(res.status, 200);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(learnCalled, false);
});

test('memory_learn yokken learn çağrılmaz', async () => {
  let learnCalled = false;
  const learner = {
    learn: async () => {
      learnCalled = true;
    },
  };
  const app = chatMemoryApp(okFetch(), { learner, serverLearn: true });

  const res = await request(app)
    .post('/chat')
    .send({ message: 'Benim adım Bekir', stream: false, tools: false });

  assert.equal(res.status, 200);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(learnCalled, false);
});

test('akışlı cevapta (stream: true) learn cevap bittikten sonra çağrılır', async () => {
  let streamEnded = false;
  let learnCalledAfterStreamEnd = false;
  let resolveLearn;
  const learnPromise = new Promise(resolve => { resolveLearn = resolve; });

  const streamFetch = async () => {
    const body = Readable.from([
      'data: {"choices":[{"delta":{"content":"Mer"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"haba"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    body.on('end', () => {
      streamEnded = true;
    });
    return { ok: true, status: 200, body };
  };

  const learner = {
    learn: async () => {
      learnCalledAfterStreamEnd = streamEnded;
      resolveLearn();
    },
  };

  const app = chatMemoryApp(streamFetch, { learner, serverLearn: true });
  const res = await request(app)
    .post('/chat')
    .send({ message: 'Benim adım Bekir', memory_learn: true, stream: true, tools: false });

  assert.equal(res.status, 200);
  await waitWithTimeout(learnPromise);
  assert.equal(learnCalledAfterStreamEnd, true);
});

test('consumeQuota kota doluyken false döndürür', async () => {
  let capturedConsumeQuota = null;
  let resolveLearn;
  const learnPromise = new Promise(resolve => { resolveLearn = resolve; });

  const learner = {
    learn: async ({ consumeQuota }) => {
      capturedConsumeQuota = consumeQuota;
      resolveLearn();
    },
  };

  const consumeDailyQuota = async (uid, kind) => {
    assert.equal(uid, 'u1');
    assert.equal(kind, 'assist');
    return { allowed: false, limit: 60, remaining: 0 };
  };

  const app = chatMemoryApp(okFetch(), { learner, serverLearn: true, consumeDailyQuota });
  const res = await request(app)
    .post('/chat')
    .send({ message: 'Benim adım Bekir', memory_learn: true, stream: false, tools: false });

  assert.equal(res.status, 200);
  await waitWithTimeout(learnPromise);
  assert.equal(typeof capturedConsumeQuota, 'function');
  assert.equal(await capturedConsumeQuota(), false);
});

test('memory_pack_read metriği yazılır', async () => {
  const tracked = [];
  const metrics = {
    track: entry => tracked.push(entry),
  };
  const packStore = { get: async () => samplePack };
  const app = chatMemoryApp(okFetch(), { packStore, metrics });

  const res = await request(app)
    .post('/chat')
    .send({ message: 'Merhaba', memory: 'server', stream: false, tools: false });

  assert.equal(res.status, 200);
  const packMetric = tracked.find(item => item.route === 'memory_pack_read');
  assert.ok(packMetric);
  assert.equal(packMetric.uid, 'u1');
  assert.equal(packMetric.ok, true);
  assert.equal(typeof packMetric.latencyMs, 'number');
  assert.ok(packMetric.latencyMs >= 0);
});

test('toolContext packStore taşır', async () => {
  let receivedPackStore = null;
  const registry = new ToolRegistry();
  registry.register({
    name: 'inspect_context',
    description: 'Test aracı',
    inputSchema: z.object({}).strict(),
    jsonSchema: objectSchema({}, []),
    execute: async (_args, context) => {
      receivedPackStore = context.packStore;
      return { ok: true };
    },
  });

  let callCount = 0;
  const toolFetch = async () => {
    callCount += 1;
    if (callCount === 1) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'inspect_context', arguments: '{}' } }],
            },
            finish_reason: 'tool_calls',
          }],
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { role: 'assistant', content: 'Bitti' }, finish_reason: 'stop' }],
      }),
    };
  };

  const packStore = { get: async () => samplePack };
  const app = chatMemoryApp(toolFetch, { packStore, toolRegistry: registry });

  const res = await request(app)
    .post('/chat')
    .send({ message: 'Aracı çalıştır', stream: false, web_search: false });

  assert.equal(res.status, 200);
  assert.equal(receivedPackStore, packStore);
});
