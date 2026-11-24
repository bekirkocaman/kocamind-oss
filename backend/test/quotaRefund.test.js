const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const express = require('express');
const request = require('supertest');
const { createQuota } = require('../quota');
const { registerChatRoutes } = require('../routes/chat');
const { buildOpenAIResponsesPayload, pipeResponsesAsChatCompletions, toChatCompletion } = require('../openaiResponses');
const { createDefaultToolRegistry } = require('../agent/tools');
const { fakeFirestore } = require('./fakeFirestore');

const FieldValue = { serverTimestamp: () => 'ts' };

async function waitForRefundQueue(db) {
  await new Promise(resolve => setTimeout(resolve, 20));
  await db.runTransaction(async () => {});
}

function usageCount(db, uid, day, kind = 'chat') {
  return db.docs.get(`usage_daily/${uid}_${day}`)?.[kind] ?? 0;
}

function quotaResponse(statusCode = 200, headersSent = false, cancelsOnClose = false) {
  return Object.assign(new EventEmitter(), {
    statusCode,
    headersSent,
    locals: { quotaCancelsOnClose: cancelsOnClose },
    setHeader() {},
  });
}

function allowCloseRefund(_req, res, next) {
  res.locals.quotaCancelsOnClose = true;
  next();
}

function appWith({
  db = fakeFirestore(),
  env = { FREE_DAILY_CHAT_LIMIT: '5' },
  uid = 'u1',
  now = () => new Date('2026-11-19T12:00:00.000Z'),
  kind = 'chat',
} = {}) {
  const quota = createQuota({ firestoreDb: db, FieldValue, env, now });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { uid }; next(); });
  app.post('/ok', quota.enforceDailyQuota(kind), (_req, res) => res.json({ ok: true }));
  app.post('/status/:code', quota.enforceDailyQuota(kind), (req, res) => {
    res.status(Number(req.params.code)).json({ status: Number(req.params.code) });
  });
  app.post('/stream-abort', quota.enforceDailyQuota(kind), (_req, res) => {
    res.status(200);
    res.write('partial');
    res.destroy();
  });
  app.post('/stream-abort-head', allowCloseRefund, quota.enforceDailyQuota(kind), (req, res) => {
    if (!req.get('X-Test-Disconnect')) return res.json({ ok: true });
    res.writeHead(200);
    res.write('x');
    res.destroy();
  });
  return { app, db, quota };
}

function disconnect(app, key, body = {}) {
  return () => request(app).post('/stream-abort-head').set('Idempotency-Key', key).set('X-Test-Disconnect', '1').send(body);
}

test('503, 502 ve 504 dönen route sonrası sayaç eski haline döner', async () => {
  const db = fakeFirestore();
  const day = '2026-11-19';
  const { app } = appWith({ db });

  assert.equal((await request(app).post('/ok')).status, 200);
  await waitForRefundQueue(db);
  assert.equal(usageCount(db, 'u1', day), 1);

  for (const code of [503, 502, 504]) {
    const res = await request(app).post(`/status/${code}`);
    assert.equal(res.status, code);
    await waitForRefundQueue(db);
    assert.equal(usageCount(db, 'u1', day), 1);
  }
});

test('500 dönen route sonrası iade yapılır; 400, 429 ve 200 sonrası iade YOK', async () => {
  const db = fakeFirestore();
  const day = '2026-11-19';
  const { app } = appWith({ db });

  assert.equal((await request(app).post('/status/500')).status, 500);
  await waitForRefundQueue(db);
  assert.equal(usageCount(db, 'u1', day), 0);

  assert.equal((await request(app).post('/status/400')).status, 400);
  await waitForRefundQueue(db);
  assert.equal(usageCount(db, 'u1', day), 1);

  assert.equal((await request(app).post('/status/429')).status, 429);
  await waitForRefundQueue(db);
  assert.equal(usageCount(db, 'u1', day), 2);

  assert.equal((await request(app).post('/ok')).status, 200);
  await waitForRefundQueue(db);
  assert.equal(usageCount(db, 'u1', day), 3);
});

test('200 ile başlayıp akış ortasında kopan yanıtta iade yapılmaz', async () => {
  const db = fakeFirestore();
  const day = '2026-11-19';
  const { app } = appWith({ db });

  const key = 'non-cancelled-stream';
  await assert.rejects(() => request(app).post('/stream-abort').set('Idempotency-Key', key));
  await waitForRefundQueue(db);
  assert.equal(usageCount(db, 'u1', day), 1);
  assert.equal(db.docs.get(`usage_keys/u1_chat_${key}`).interrupted, false);
});

test('başlıklar öncesi bağlantı kapanışında yalnızca iptal bayraklı rota iade alır', async () => {
  const db = fakeFirestore();
  const { app, quota } = appWith({ db });
  const mw = quota.enforceDailyQuota('chat');
  app.post('/drop', mw, (_req, res) => res.destroy());
  app.post('/cancel', allowCloseRefund, mw, (_req, res) => res.destroy());

  await assert.rejects(() => request(app).post('/drop'));
  await waitForRefundQueue(db);
  assert.equal(usageCount(db, 'u1', '2026-11-19'), 1);

  await assert.rejects(() => request(app).post('/cancel'));
  await waitForRefundQueue(db);
  assert.equal(usageCount(db, 'u1', '2026-11-19'), 1);
});

test('kota işlemi sürerken kapanan yanıtta iş başlamaz ve iade rotaya göre yapılır', async () => {
  for (const [kind, route, flag, expected] of [
    ['chat', '/chat', true, 0],
    ['agent', '/agent/run', false, 0],
    ['agent', '/agent/unrelated', false, 1],
    ['upload', '/documents/upload', false, 1],
  ]) {
    const db = fakeFirestore();
    const { quota } = appWith({ db });
    const res = quotaResponse(200, false, flag);
    const runTransaction = db.runTransaction;
    db.runTransaction = fn => {
      res.destroyed = true;
      res.emit('close');
      return runTransaction(fn);
    };
    const req = { user: { uid: 'u1' }, route: { path: route } };
    await quota.enforceDailyQuota(kind)(req, res, () => assert.fail('Kapanan isteğin rotası çalıştı'));
    await waitForRefundQueue(db);
    assert.equal(usageCount(db, 'u1', '2026-11-19', kind), expected, route);
  }
});

test('finish, close ve açık iade çağrısı birlikte gelse bile tek iade yapılır ve sayaç negatife inmez', async () => {
  const db = fakeFirestore();
  const day = '2026-11-19';
  const { quota } = appWith({ db });

  // Önce 1 adet geçerli kullanım oluştur (200), ardından 1 adet 503 oluştur.
  const mw = quota.enforceDailyQuota('chat');

  // 1. istek: normal tamamlanır -> sayaç = 1
  const res1 = quotaResponse(200, true);
  await mw({ user: { uid: 'u1' }, headers: {} }, res1, () => {});
  assert.equal(usageCount(db, 'u1', day), 1);

  // 2. istek: sayaç = 2 olur, ardından 503 ile hem finish hem close tetiklenir -> sayaç = 1 olmalı (0 değil).
  const res2 = quotaResponse(503, true);
  await mw({ user: { uid: 'u1' }, headers: {} }, res2, () => {});
  assert.equal(usageCount(db, 'u1', day), 2);
  res2.emit('finish');
  res2.emit('close');
  await res2.locals.quotaRefund();
  await waitForRefundQueue(db);
  assert.equal(usageCount(db, 'u1', day), 1);

  // 3. istek: yanıt gönderilmeden bağlantı kapanır (headersSent=false, sadece close) -> tek iade ile sayaç = 1 kalır.
  const res3 = quotaResponse(200, false, true);
  await mw({ user: { uid: 'u1' }, headers: {} }, res3, () => {});
  assert.equal(usageCount(db, 'u1', day), 2);
  res3.emit('close');
  res3.emit('close');
  await waitForRefundQueue(db);
  assert.equal(usageCount(db, 'u1', day), 1);

  // Negatife düşmeme kontrolü
  await quota.refundDailyQuota('u1', 'chat', day);
  assert.equal(usageCount(db, 'u1', day), 0);
  await quota.refundDailyQuota('u1', 'chat', day);
  assert.equal(usageCount(db, 'u1', day), 0);
});

test('gece yarısı geçişinde iade düşürme anındaki günü kullanır', async () => {
  const db = fakeFirestore();
  let currentTime = new Date('2026-11-19T23:59:59.000Z');
  const { quota } = appWith({ db, now: () => currentTime });
  const mw = quota.enforceDailyQuota('chat');

  const res = new EventEmitter();
  res.statusCode = 503;
  res.headersSent = true;
  res.setHeader = () => {};

  await mw({ user: { uid: 'u1' }, headers: {} }, res, () => {});
  assert.equal(usageCount(db, 'u1', '2026-11-19'), 1);

  // Yanıt bitmeden gece yarısı geçer
  currentTime = new Date('2026-11-20T00:00:01.000Z');
  res.emit('finish');
  await waitForRefundQueue(db);

  assert.equal(usageCount(db, 'u1', '2026-11-19'), 0);
  assert.equal(usageCount(db, 'u1', '2026-11-20'), 0);
});

test('aynı Idempotency-Key ile iki başarılı istek sayacı 2 artırır (artık bedava değil)', async () => {
  const db = fakeFirestore();
  const day = '2026-11-19';
  const { app } = appWith({ db, env: { FREE_DAILY_CHAT_LIMIT: '5' } });
  const key = 'req-key-123456';

  const first = await request(app).post('/ok').set('Idempotency-Key', key);
  assert.equal(first.status, 200);
  assert.equal(first.headers['x-daily-remaining'], '4');

  const second = await request(app).post('/ok').set('Idempotency-Key', key);
  assert.equal(second.status, 200);
  assert.equal(second.headers['x-daily-remaining'], '3');

  await waitForRefundQueue(db);
  assert.equal(usageCount(db, 'u1', day), 2);
});

test('aynı Idempotency-Key ile ilk istek 503 (iade), ikinci istek 200: sayaç 1 olur', async () => {
  const db = fakeFirestore();
  const day = '2026-11-19';
  const { app } = appWith({ db });
  const key = 'retry_after_503_key';

  const first = await request(app).post('/status/503').set('Idempotency-Key', key);
  assert.equal(first.status, 503);
  await waitForRefundQueue(db);
  assert.equal(usageCount(db, 'u1', day), 0);

  const keyDocAfterRefund = db.docs.get(`usage_keys/u1_chat_${key}`);
  assert.equal(keyDocAfterRefund.refunded, true);

  const second = await request(app).post('/ok').set('Idempotency-Key', key);
  assert.equal(second.status, 200);
  await waitForRefundQueue(db);
  assert.equal(usageCount(db, 'u1', day), 1);
});

test('süresi geçmiş Idempotency-Key (11 dk ileri) kotayı tekrar düşürür', async () => {
  const db = fakeFirestore();
  const day = '2026-11-19';
  let currentTime = new Date('2026-11-19T12:00:00.000Z');
  const { app } = appWith({ db, now: () => currentTime });
  const key = 'expiring_key_1234';

  await assert.rejects(disconnect(app, key));
  await waitForRefundQueue(db);
  assert.equal(usageCount(db, 'u1', day), 1);

  currentTime = new Date(currentTime.getTime() + 11 * 60 * 1000);
  assert.equal((await request(app).post('/stream-abort-head').set('Idempotency-Key', key).send({})).status, 200);
  await waitForRefundQueue(db);
  assert.equal(usageCount(db, 'u1', day), 2);
});

test('geçersiz Idempotency-Key değerleri yok sayılır ve her istek kotadan düşer', async () => {
  const db = fakeFirestore();
  const day = '2026-11-19';
  const { app } = appWith({ db, env: { FREE_DAILY_CHAT_LIMIT: '10' } });

  const invalidKeys = ['a b', 'abc', 'x'.repeat(129)];
  let expected = 0;
  for (const badKey of invalidKeys) {
    assert.equal((await request(app).post('/ok').set('Idempotency-Key', badKey)).status, 200);
    expected += 1;
    assert.equal((await request(app).post('/ok').set('Idempotency-Key', badKey)).status, 200);
    expected += 1;
  }

  await waitForRefundQueue(db);
  assert.equal(usageCount(db, 'u1', day), expected);
});

test('iade sırasında Firestore hata atarsa istek yine tamamlanır ve warn loglanır', async () => {
  const db = fakeFirestore();
  const baseRunTransaction = db.runTransaction;
  let txCount = 0;
  db.runTransaction = async fn => {
    txCount += 1;
    if (txCount === 2) {
      throw new Error('iade yazma hatası');
    }
    return baseRunTransaction(fn);
  };

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const { app } = appWith({ db });
    const res = await request(app).post('/status/503');
    assert.equal(res.status, 503);
    assert.deepEqual(res.body, { status: 503 });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(warnings.some(msg => msg.includes('Kota iadesi yapılamadı') && msg.includes('iade yazma hatası')));
  } finally {
    console.warn = originalWarn;
  }
});

test('yanıt başlıkları gönderildikten sonra kopan istek için tek bedava tekrar hakkı verilir', async () => {
  const db = fakeFirestore();
  const day = '2026-11-19';
  const { app } = appWith({ db, env: { FREE_DAILY_CHAT_LIMIT: '5' } });
  const key = 'interrupted-key-1';

  await assert.rejects(disconnect(app, key, { message: 'aynı gövde' }));
  await waitForRefundQueue(db);
  assert.equal(usageCount(db, 'u1', day), 1);
  assert.equal(db.docs.get(`usage_keys/u1_chat_${key}`)?.interrupted, true);

  // İkinci istek: bedava tekrar -> sayaç 1 kalır
  const second = await request(app).post('/stream-abort-head').set('Idempotency-Key', key).send({ message: 'aynı gövde' });
  assert.equal(second.status, 200);
  await waitForRefundQueue(db);
  assert.equal(usageCount(db, 'u1', day), 1);
  assert.equal(db.docs.get(`usage_keys/u1_chat_${key}`)?.replayUsed, true);

  // Üçüncü istek: artık normal düşer -> sayaç 2 olur
  const third = await request(app).post('/stream-abort-head').set('Idempotency-Key', key).send({ message: 'aynı gövde' });
  assert.equal(third.status, 200);
  await waitForRefundQueue(db);
  assert.equal(usageCount(db, 'u1', day), 2);
});

test('bedava tekrar da akış ortasında koparsa ikinci bedava tekrar hakkı verilmez', async () => {
  const db = fakeFirestore();
  const day = '2026-11-19';
  const { app } = appWith({ db, env: { FREE_DAILY_CHAT_LIMIT: '5' } });
  const key = 'interrupted-twice-1';

  await assert.rejects(disconnect(app, key));
  await waitForRefundQueue(db);
  assert.equal(usageCount(db, 'u1', day), 1);

  // Bedava tekrar da kesiliyor
  await assert.rejects(disconnect(app, key));
  await waitForRefundQueue(db);
  assert.equal(usageCount(db, 'u1', day), 1);

  // Üçüncü istek kota düşürür -> sayaç 2
  const third = await request(app).post('/stream-abort-head').set('Idempotency-Key', key).send({});
  assert.equal(third.status, 200);
  await waitForRefundQueue(db);
  assert.equal(usageCount(db, 'u1', day), 2);
});

test('tekrar hakkı aynı anahtarlı farklı rotayı veya farklı gövdeyi kapsamaz', async () => {
  for (const [path, body] of [['/ok', { message: 'ilk' }], ['/stream-abort-head', { message: 'ikinci' }]]) {
    const key = 'route-and-body-key';
    const { db, app } = appWith();
    await assert.rejects(disconnect(app, key, { message: 'ilk' }));
    await waitForRefundQueue(db);

    assert.equal((await request(app).post(path).set('Idempotency-Key', key).send(body)).status, 200);
    assert.equal(usageCount(db, 'u1', '2026-11-19'), 2);
  }
});

test('iki eşzamanlı tekrardan en fazla biri kota sınırını aşmadan çalışır', async () => {
  const { app, db } = appWith({ env: { FREE_DAILY_CHAT_LIMIT: '1' } });
  const key = 'one-concurrent-retry';
  await assert.rejects(disconnect(app, key));
  await waitForRefundQueue(db);

  const retry = () => request(app).post('/stream-abort-head').set('Idempotency-Key', key).send({});
  const results = await Promise.all([retry(), retry()]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 429]);
});

test('eski kesilme ve iade yeni denemenin kaydını veya sayacını değiştirmez', async () => {
  for (const end of ['close', 'finish']) {
    const { quota, db } = appWith();
    const checkQuota = quota.enforceDailyQuota('chat');
    const req = { user: { uid: 'u1' }, method: 'POST', path: '/chat', headers: { 'idempotency-key': 'shared-attempt-key' } };
    const docPath = 'usage_keys/u1_chat_shared-attempt-key';
    const old = quotaResponse(end === 'finish' ? 503 : 200, true, true);

    await checkQuota(req, old, () => {});
    const oldAttemptId = db.docs.get(docPath).attemptId;
    await checkQuota(req, quotaResponse(), () => {});
    const currentDoc = db.docs.get(docPath);
    assert.ok(oldAttemptId);
    assert.notEqual(currentDoc.attemptId, oldAttemptId);

    old.emit(end);
    await waitForRefundQueue(db);
    assert.deepEqual(db.docs.get(docPath), currentDoc);
    assert.equal(usageCount(db, 'u1', '2026-11-19'), 2);
  }
});

test('akışın tekrar hakkı kullanılmışsa ilk deneme sonradan iade edilmez', async () => {
  const { quota, db } = appWith();
  const checkQuota = quota.enforceDailyQuota('chat');
  const req = { user: { uid: 'u1' }, method: 'POST', path: '/chat', headers: { 'idempotency-key': 'late-refund-key' } };
  const first = quotaResponse(200, true, true);
  const retry = quotaResponse();

  await checkQuota(req, first, () => {});
  first.emit('close');
  await waitForRefundQueue(db);
  await checkQuota(req, retry, () => {});
  assert.equal(retry.locals.quotaRefund, undefined);

  await first.locals.quotaRefund();
  assert.equal(usageCount(db, 'u1', '2026-11-19'), 1);
});

test('kimliği ve istek özeti olmayan eski Firestore anahtarı bedava tekrar vermez', async () => {
  const { db, app } = appWith();
  const key = 'legacy-interrupted-key';
  db.docs.set(`usage_keys/u1_chat_${key}`, { interrupted: true, expiresAt: new Date('2026-11-19T12:05:00Z') });

  assert.equal((await request(app).post('/ok').set('Idempotency-Key', key)).status, 200);
  assert.equal(usageCount(db, 'u1', '2026-11-19'), 1);
});

test('OpenAI sağlayıcı hatası ancak akışta çıktı veya araç işi başlamadıysa iade edilir', async t => {
  process.env.QUOTA_REFUND_TEST_API_KEY = 'test-key';
  const previousTools = process.env.OPENAI_CHAT_TOOLS;
  process.env.OPENAI_CHAT_TOOLS = 'true';
  t.after(() => {
    delete process.env.QUOTA_REFUND_TEST_API_KEY;
    if (previousTools === undefined) delete process.env.OPENAI_CHAT_TOOLS;
    else process.env.OPENAI_CHAT_TOOLS = previousTools;
  });

  const failure = { type: 'response.failed', response: { error: { message: 'Test sağlayıcı hatası' } } };
  const delta = { type: 'response.output_text.delta', delta: 'Kısmi yanıt' };
  const reasoning = { type: 'response.reasoning_summary_text.delta', delta: 'Düşünce' };
  const webSearch = { type: 'response.output_item.added', item: { type: 'web_search_call' } };
  const model = { id: 'gpt-5.6-luna', provider: 'openai' };

  for (const tools of [false, true]) {
    for (const [events, expected] of [
      [[failure], 0], [[delta, failure], 1], [[reasoning, failure], 1], [[webSearch, failure], 1], [[], 1],
    ]) {
      const { app, db, quota } = appWith();
      registerChatRoutes(app, {
        enforceDailyQuota: quota.enforceDailyQuota,
        DEFAULT_MODEL: model,
        PROVIDERS: { openai: { name: 'OpenAI', envKey: 'QUOTA_REFUND_TEST_API_KEY', nativeResponses: true } },
        MODEL_CATALOG: [model],
        ACTIVE_PROVIDERS: new Set(['openai']),
        ASSISTANT_PROMPTS: { tiger: 'Türkçe cevap ver.' },
        buildOpenAIResponsesPayload,
        pipeResponsesAsChatCompletions,
        toChatCompletion,
        toolRegistry: createDefaultToolRegistry(),
        fetch: async (_url, { body }) => {
          assert.equal(JSON.parse(body).tools?.some(tool => tool.type === 'function') ?? false, tools);
          const sse = Buffer.from(events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join(''));
          return { ok: true, status: 200, body: Readable.from([sse.subarray(0, 16), sse.subarray(16)]) };
        },
      });

      const res = await request(app).post('/chat').send({ message: 'Selam', stream: true, tools });
      assert.equal(res.status, 200);
      assert.match(res.text, /data: \[DONE\]/);
      await waitForRefundQueue(db);
      assert.equal(usageCount(db, 'u1', '2026-11-19'), expected);
    }
  }
});

test('aynı Idempotency-Key ile eşzamanlı iki isteğin ikisi de kotadan düşer', async () => {
  const db = fakeFirestore();
  const day = '2026-11-19';
  const now = () => new Date('2026-11-19T12:00:00.000Z');
  const quota = createQuota({ firestoreDb: db, FieldValue, env: { FREE_DAILY_CHAT_LIMIT: '5' }, now });
  const app = express();
  app.use((req, _res, next) => { req.user = { uid: 'u1' }; next(); });

  let notifyFirstEntered;
  const firstEntered = new Promise(resolve => { notifyFirstEntered = resolve; });
  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });

  app.post('/slow', quota.enforceDailyQuota('chat'), async (_req, res) => {
    notifyFirstEntered();
    await firstGate;
    res.json({ ok: true });
  });
  app.post('/fast', quota.enforceDailyQuota('chat'), (_req, res) => {
    res.json({ ok: true });
  });

  const key = 'concurrent-key-1';
  const firstPromise = (async () => request(app).post('/slow').set('Idempotency-Key', key))();
  let second;
  try {
    await firstEntered;
    second = await request(app).post('/fast').set('Idempotency-Key', key);
  } finally {
    releaseFirst();
  }
  assert.equal(second.status, 200);
  const first = await firstPromise;
  assert.equal(first.status, 200);

  await waitForRefundQueue(db);
  assert.equal(usageCount(db, 'u1', day), 2);
});

test('usage_keys belgesinde expiresAt Date nesnesi olarak yazılır', async () => {
  const db = fakeFirestore();
  const currentTime = new Date('2026-11-19T12:00:00.000Z');
  const { app } = appWith({ db, now: () => currentTime });
  const key = 'expires-date-key-1';

  assert.equal((await request(app).post('/ok').set('Idempotency-Key', key)).status, 200);
  const keyDoc = db.docs.get(`usage_keys/u1_chat_${key}`);
  assert.ok(keyDoc);
  assert.ok(keyDoc.expiresAt instanceof Date);
  assert.equal(keyDoc.expiresAt.getTime(), currentTime.getTime() + 10 * 60 * 1000);
});

test('refundDailyQuota var olmayan anahtarla usage_keys belgesi oluşturmaz', async () => {
  const db = fakeFirestore();
  const day = '2026-11-19';
  const { quota } = appWith({ db });
  const missingKey = 'missing-key-123456';

  await quota.refundDailyQuota('u1', 'chat', day, missingKey);
  assert.equal(db.docs.has(`usage_keys/u1_chat_${missingKey}`), false);
});
