const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createAlerts, registerAlertCronRoute, cleanClientErrorText } = require('../alerts');
const { clientErrorFingerprint } = require('../routes/telemetry');
const { createMetrics } = require('../metrics');
const { fakeFirestore } = require('./fakeFirestore');

const TODAY = '2026-11-19';
const FIXED_NOW = () => new Date(`${TODAY}T12:00:00.000Z`);

function fakeMetrics(rows) {
  return {
    listDailyMetrics: async () => rows,
  };
}

test('eşik altı ve calls < ALERT_MIN_CALLS durumunda uyarı üretilmez', async () => {
  const db = fakeFirestore();
  const calls = [];
  const alerts = createAlerts({
    firestoreDb: db,
    metrics: fakeMetrics([
      { day: TODAY, provider: 'openai', model: 'gpt-4o', calls: 100, errors: 10, avgLatencyMs: 1500 },
      { day: TODAY, provider: 'groq', model: 'llama-3', calls: 19, errors: 19, avgLatencyMs: 45000 },
    ]),
    fetch: async url => { calls.push(url); return { ok: true, status: 200 }; },
    env: { ALERT_WEBHOOK_URL: 'https://hooks.example.com/test' },
    now: FIXED_NOW,
  });

  const health = await alerts.checkModelHealth();
  assert.equal(health.length, 0);

  const result = await alerts.runAlerts();
  assert.equal(result.alerts, 0);
  assert.equal(result.sent, 0);
  assert.equal(calls.length, 0);
});

test('%30 hata oranında uyarı üretilir, webhook bir kez çağrılır ve gövdesinde model adı vardır', async () => {
  const db = fakeFirestore();
  const requests = [];
  const alerts = createAlerts({
    firestoreDb: db,
    metrics: fakeMetrics([
      { day: TODAY, provider: 'openai', model: 'gpt-5-mini', calls: 30, errors: 9, avgLatencyMs: 1200 },
    ]),
    fetch: async (url, opts) => {
      requests.push({ url, body: JSON.parse(opts.body) });
      return { ok: true, status: 200 };
    },
    env: { ALERT_WEBHOOK_URL: 'https://hooks.example.com/secret' },
    now: FIXED_NOW,
  });

  const result = await alerts.runAlerts();
  assert.equal(result.alerts, 1);
  assert.equal(result.sent, 1);
  assert.deepEqual(result.errors, []);
  assert.equal(requests.length, 1);
  assert.match(requests[0].body.text, /gpt-5-mini/);
});

test('aynı gün ikinci runAlerts çağrısında tekrar bildirim gönderilmez', async () => {
  const db = fakeFirestore();
  let fetchCount = 0;
  const alerts = createAlerts({
    firestoreDb: db,
    metrics: fakeMetrics([
      { day: TODAY, provider: 'deepseek', model: 'deepseek-chat', calls: 25, errors: 10, avgLatencyMs: 900 },
    ]),
    fetch: async () => { fetchCount += 1; return { ok: true, status: 200 }; },
    env: { ALERT_WEBHOOK_URL: 'https://hooks.example.com/secret' },
    now: FIXED_NOW,
  });

  const first = await alerts.runAlerts();
  const second = await alerts.runAlerts();
  assert.equal(first.sent, 1);
  assert.equal(second.sent, 0);
  assert.equal(fetchCount, 1);
});

test('yüksek ortalama gecikmede reason: latency uyarısı üretilir', async () => {
  const db = fakeFirestore();
  const alerts = createAlerts({
    firestoreDb: db,
    metrics: fakeMetrics([
      { day: TODAY, provider: 'anthropic', model: 'claude-sonnet', calls: 20, errors: 0, latencyMsTotal: 700000 },
    ]),
    fetch: async () => ({ ok: true, status: 200 }),
    env: { ALERT_AVG_LATENCY_MS: '30000' },
    now: FIXED_NOW,
  });

  const health = await alerts.checkModelHealth();
  assert.equal(health.length, 1);
  assert.equal(health[0].reason, 'latency');
  assert.equal(health[0].avgLatencyMs, 35000);
});

test('webhook 500 ve timeout hatalarında throw etmez, errors dolu döner', async () => {
  const db = fakeFirestore();
  const alerts500 = createAlerts({
    firestoreDb: db,
    metrics: fakeMetrics([
      { day: TODAY, provider: 'openai', model: 'gpt-4o', calls: 25, errors: 10, avgLatencyMs: 500 },
    ]),
    fetch: async () => ({ ok: false, status: 500 }),
    env: { ALERT_WEBHOOK_URL: 'https://hooks.example.com/secret' },
    now: FIXED_NOW,
  });

  const res500 = await alerts500.runAlerts();
  assert.equal(res500.sent, 0);
  assert.ok(res500.errors.length > 0);
  assert.ok(!res500.errors.some(e => e.includes('hooks.example.com')));

  const alertsTimeout = createAlerts({
    firestoreDb: db,
    metrics: fakeMetrics([
      { day: TODAY, provider: 'openai', model: 'gpt-4o', calls: 25, errors: 10, avgLatencyMs: 500 },
    ]),
    fetch: async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    },
    env: { ALERT_WEBHOOK_URL: 'https://hooks.example.com/secret' },
    now: FIXED_NOW,
  });

  const resTimeout = await alertsTimeout.runAlerts();
  assert.equal(resTimeout.sent, 0);
  assert.ok(resTimeout.errors.length > 0);
});

test('http:// webhook adresine istek gönderilmez', async () => {
  const db = fakeFirestore();
  let called = false;
  const alerts = createAlerts({
    firestoreDb: db,
    metrics: fakeMetrics([
      { day: TODAY, provider: 'openai', model: 'gpt-4o', calls: 25, errors: 10, avgLatencyMs: 500 },
    ]),
    fetch: async () => { called = true; return { ok: true, status: 200 }; },
    env: { ALERT_WEBHOOK_URL: 'http://insecure.example.com/hook' },
    now: FIXED_NOW,
  });

  const res = await alerts.runAlerts();
  assert.equal(called, false);
  assert.equal(res.sent, 0);
  assert.equal(res.skippedNoChannel, true);
});

test('bildirim kanalı yoksa skippedNoChannel: true döner', async () => {
  const db = fakeFirestore();
  const alerts = createAlerts({
    firestoreDb: db,
    metrics: fakeMetrics([
      { day: TODAY, provider: 'openai', model: 'gpt-4o', calls: 25, errors: 10, avgLatencyMs: 500 },
    ]),
    fetch: async () => ({ ok: true, status: 200 }),
    env: {},
    now: FIXED_NOW,
  });

  const res = await alerts.runAlerts();
  assert.equal(res.sent, 0);
  assert.equal(res.skippedNoChannel, true);
});

test('/cron/alerts route eksik veya yanlış CRON_SECRET ile 401, doğru secret ile 200 döner', async () => {
  const app = express();
  const alerts = { runAlerts: async () => ({ checked: 1, alerts: 0, sent: 0, errors: [] }) };
  registerAlertCronRoute(app, alerts, { cronSecret: 'cok-gizli' });

  const missing = await request(app).get('/cron/alerts');
  assert.equal(missing.status, 401);

  const wrong = await request(app).get('/cron/alerts').set('Authorization', 'Bearer yanlis');
  assert.equal(wrong.status, 401);

  const ok = await request(app).get('/cron/alerts').set('Authorization', 'Bearer cok-gizli');
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { checked: 1, alerts: 0, sent: 0, errors: [] });
});

function seedClientErrors(db, fingerprint, count, data = {}) {
  for (let index = 0; index < count; index += 1) {
    db.docs.set(`client_errors/${fingerprint}-${index}`, {
      day: TODAY, fingerprint, message: 'İstek hatası', release: 'v1', ...data,
    });
  }
}

test('istemci uyarısı toplam eşiğini aştığında veya bir hata spike eşiğine ulaştığında oluşur', async () => {
  const db = fakeFirestore();
  const alerts = createAlerts({
    firestoreDb: db,
    metrics: fakeMetrics([]),
    env: { ALERT_CLIENT_ERRORS: '5', ALERT_CLIENT_ERROR_SPIKE: '3' },
    now: FIXED_NOW,
  });
  seedClientErrors(db, 'a', 2);
  seedClientErrors(db, 'b', 2);
  seedClientErrors(db, 'c', 1);
  seedClientErrors(db, 'yesterday', 10, { day: '2026-11-18' });
  assert.equal(await alerts.checkClientErrors(), null);

  seedClientErrors(db, 'd', 1);
  const totalAlert = await alerts.checkClientErrors();
  assert.equal(totalAlert.reason, 'client_errors');
  assert.equal(totalAlert.total, 6);
  assert.deepEqual(totalAlert.top.map(({ count }) => count), [2, 2, 1]);

  db.docs.clear();
  seedClientErrors(db, 'spike', 3);
  assert.deepEqual(await alerts.checkClientErrors(), {
    reason: 'client_errors', total: 3,
    top: [{ fingerprint: 'spike', count: 3, message: 'İstek hatası', release: 'v1' }],
  });
});

test('istemci uyarısı 5000 belge okur ve daha fazla kayıt olduğunda truncated döner', async () => {
  for (const total of [5000, 5001]) {
    const alerts = createAlerts({
      firestoreDb: {
        collection: name => {
          assert.equal(name, 'client_errors');
          return {
            where: (field, operator, day) => {
              assert.deepEqual([field, operator, day], ['day', '==', TODAY]);
              return {
                limit: limit => {
                  assert.equal(limit, 5000);
                  const doc = { data: () => ({ fingerprint: 'a', message: 'İstek hatası' }) };
                  return { get: async () => ({ docs: Array(limit).fill(doc) }) };
                },
                count: () => ({ get: async () => ({ data: () => ({ count: total }) }) }),
              };
            },
          };
        },
      },
      env: {},
      now: FIXED_NOW,
    });
    const alert = await alerts.checkClientErrors();
    assert.equal(alert.total, total);
    assert.equal(alert.top[0].count, 5000);
    assert.equal(Boolean(alert.truncated), total > 5000);
  }
});

test('istemci ve model uyarıları birlikte çalışır, istemci bildirimi aynı gün bir kez gönderilir', async () => {
  const db = fakeFirestore();
  const requests = [];
  seedClientErrors(db, 'spike', 20, {
    uid: 'private-user-id',
    stack: 'private-stack',
    componentStack: 'private-component-stack',
    url: '/private-page',
    message: 'İstek hatası\n <tag> private-user-id private-stack private-component-stack /private-page https://private.example.org/path',
  });
  const alerts = createAlerts({
    firestoreDb: db,
    metrics: fakeMetrics([
      { day: TODAY, provider: 'openai', model: 'gpt-4o', calls: 25, errors: 10, avgLatencyMs: 500 },
    ]),
    fetch: async (_url, opts) => {
      requests.push(JSON.parse(opts.body));
      return { ok: true };
    },
    env: { ALERT_WEBHOOK_URL: 'https://hooks.example.com/test' },
    now: FIXED_NOW,
  });

  const first = await alerts.runAlerts();
  const second = await alerts.runAlerts();
  assert.equal(first.alerts, 2);
  assert.equal(first.sent, 2);
  assert.equal(first.clientErrors.total, 20);
  assert.equal(second.sent, 0);
  assert.ok(db.docs.has(`alert_state/${TODAY}_client_errors`));
  assert.equal(requests.length, 2);
  assert.match(requests[0].text, /gpt-4o/);
  assert.match(requests[1].text, /20 istemci hatası.*\n.*20 kez · İstek hatası.*v1/);
  assert.doesNotMatch(requests[1].text, /private-|<tag>/);
});

test('başarısız istemci webhook çağrısı tekrar denenebilir', async () => {
  const db = fakeFirestore();
  seedClientErrors(db, 'spike', 20);
  let attempts = 0;
  const alerts = createAlerts({
    firestoreDb: db,
    metrics: fakeMetrics([]),
    fetch: async () => ({ ok: ++attempts > 1, status: 503 }),
    env: { ALERT_WEBHOOK_URL: 'https://hooks.example.com/test' },
    now: FIXED_NOW,
  });
  assert.equal((await alerts.runAlerts()).sent, 0);
  assert.equal(db.docs.has(`alert_state/${TODAY}_client_errors`), false);
  const results = await Promise.all([alerts.runAlerts(), alerts.runAlerts()]);
  assert.equal(results[0].sent + results[1].sent, 1);
  assert.equal(attempts, 2);
});

test('iki paralel runAlerts çağrısı aynı model uyarısı için tek webhook gönderir', async () => {
  const db = fakeFirestore();
  let fetchCount = 0;
  const alerts = createAlerts({
    firestoreDb: db,
    metrics: fakeMetrics([
      { day: TODAY, provider: 'openai', model: 'gpt-5-mini', calls: 30, errors: 12, avgLatencyMs: 800 },
    ]),
    fetch: async () => {
      fetchCount += 1;
      await new Promise(resolve => setTimeout(resolve, 15));
      return { ok: true, status: 200 };
    },
    env: { ALERT_WEBHOOK_URL: 'https://hooks.example.com/secret' },
    now: FIXED_NOW,
  });

  const [first, second] = await Promise.all([alerts.runAlerts(), alerts.runAlerts()]);
  assert.equal(first.sent + second.sent, 1);
  assert.equal(fetchCount, 1);
  assert.ok(db.docs.has(`alert_state/${TODAY}_openai_gpt-5-mini_errors`));
});

test('model uyarısı webhook başarısız olunca alert_state silinir ve tekrar denenebilir', async () => {
  const db = fakeFirestore();
  let attempts = 0;
  const alerts = createAlerts({
    firestoreDb: db,
    metrics: fakeMetrics([
      { day: TODAY, provider: 'openai', model: 'gpt-5-mini', calls: 30, errors: 12, avgLatencyMs: 800 },
    ]),
    fetch: async () => {
      attempts += 1;
      return { ok: attempts > 1, status: attempts > 1 ? 200 : 503 };
    },
    env: { ALERT_WEBHOOK_URL: 'https://hooks.example.com/secret' },
    now: FIXED_NOW,
  });

  const failed = await alerts.runAlerts();
  assert.equal(failed.sent, 0);
  assert.equal(db.docs.has(`alert_state/${TODAY}_openai_gpt-5-mini_errors`), false);

  const retried = await alerts.runAlerts();
  assert.equal(retried.sent, 1);
  assert.equal(attempts, 2);
  assert.equal(db.docs.has(`alert_state/${TODAY}_openai_gpt-5-mini_errors`), true);
});

test('webhook isteği redirect: manual ile gider ve 3xx yönlendirmesini hata sayar', async () => {
  const db = fakeFirestore();
  const seenOpts = [];
  const alerts = createAlerts({
    firestoreDb: db,
    metrics: fakeMetrics([
      { day: TODAY, provider: 'openai', model: 'gpt-4o', calls: 25, errors: 10, avgLatencyMs: 500 },
    ]),
    fetch: async (_url, opts) => {
      seenOpts.push(opts);
      return { ok: false, status: 302 };
    },
    env: { ALERT_WEBHOOK_URL: 'https://hooks.example.com/secret' },
    now: FIXED_NOW,
  });

  const res = await alerts.runAlerts();
  assert.equal(seenOpts.length, 1);
  assert.equal(seenOpts[0].redirect, 'manual');
  assert.equal(res.sent, 0);
  assert.ok(res.errors.some(e => e.includes('302')));
  assert.equal(db.docs.has(`alert_state/${TODAY}_openai_gpt-4o_errors`), false);
});

test('istemci kaynaklı 4xx ve yedek yönlendirmeleri hata oranından düşülür, 429/401/5xx korunur', async () => {
  const db = fakeFirestore();
  const alerts = createAlerts({
    firestoreDb: db,
    metrics: fakeMetrics([
      // 35 çağrı: 10 adet 400/499 istemci hatası + 5 adet chat_model_fallback -> 20 gerçek çağrı, 2 gerçek hata (%10 <= %20)
      {
        day: TODAY,
        provider: 'openai',
        model: 'gpt-clean',
        calls: 35,
        errors: 17,
        avgLatencyMs: 1000,
        routes: { chat: 30, chat_model_fallback: 5 },
        statusCodes: { s400: 6, s499: 4, s503: 7 },
      },
      // 429 sağlayıcı yoğunluğu düşülmez: 25 çağrı, 10 adet 429 -> %40 > %20 (uyarı üretmeli)
      {
        day: TODAY,
        provider: 'openai',
        model: 'gpt-ratelimited',
        calls: 25,
        errors: 10,
        avgLatencyMs: 1000,
        statusCodes: { s429: 10 },
      },
      // 401 API anahtarı hatası düşülmez: 20 çağrı, 6 adet 401 -> %30 > %20 (uyarı üretmeli)
      {
        day: TODAY,
        provider: 'anthropic',
        model: 'claude-auth',
        calls: 20,
        errors: 6,
        avgLatencyMs: 1000,
        statusCodes: { s401: 6 },
      },
      // provider/model olmayan iç metrik satırı yoksayılır
      {
        day: TODAY,
        calls: 50,
        errors: 50,
        avgLatencyMs: 50000,
        routes: { memory_pack_read: 50 },
      },
    ]),
    env: {},
    now: FIXED_NOW,
  });

  const found = await alerts.checkModelHealth();
  assert.deepEqual(found.map(a => a.model).sort(), ['claude-auth', 'gpt-ratelimited']);
});

test('ölçülmeyen gecikmeler (latencyMs yok) ortalama gecikmeyi sıfıra çekmez', async () => {
  const docs = new Map();
  const INC = Symbol('inc');
  const FieldValue = { increment: n => ({ [INC]: n }), serverTimestamp: () => 'ts' };
  const apply = (target, data) => {
    for (const [key, value] of Object.entries(data)) {
      const path = key.split('.');
      let node = target;
      for (const part of path.slice(0, -1)) node = node[part] ??= {};
      const last = path.at(-1);
      node[last] = value && typeof value === 'object' && INC in value ? (Number(node[last]) || 0) + value[INC] : value;
    }
  };
  const firestoreDb = {
    collection: name => ({
      doc: id => ({ set: async data => { const k = `${name}/${id}`; const cur = docs.get(k) || {}; apply(cur, data); docs.set(k, cur); } }),
      where: (field, _op, value) => ({
        get: async () => ({
          docs: [...docs.entries()]
            .filter(([k, d]) => k.startsWith(`${name}/`) && d[field] >= value)
            .map(([k, d]) => ({ id: k.split('/')[1], data: () => d })),
        }),
      }),
    }),
  };

  const metrics = createMetrics({ firestoreDb, FieldValue, env: {}, now: FIXED_NOW });
  for (let i = 0; i < 20; i += 1) {
    await metrics.recordModelCall({ uid: 'u1', route: 'chat', provider: 'openai', model: 'gpt-slow', ok: true, latencyMs: 40000 });
  }
  for (let i = 0; i < 20; i += 1) {
    await metrics.recordModelCall({ uid: 'u1', route: 'chat_model_fallback', provider: 'openai', model: 'gpt-slow', ok: false, status: 503 });
  }

  const [row] = await metrics.listDailyMetrics(1);
  assert.equal(row.latencySamples, 20);
  assert.equal(row.avgLatencyMs, 40000);

  const alerts = createAlerts({
    firestoreDb: fakeFirestore(),
    metrics,
    env: { ALERT_AVG_LATENCY_MS: '30000' },
    now: FIXED_NOW,
  });
  const health = await alerts.checkModelHealth();
  assert.equal(health.length, 1);
  assert.equal(health[0].reason, 'latency');
  assert.equal(health[0].avgLatencyMs, 40000);
});

test('cleanClientErrorText url: / varken URL, e-posta, Bearer ve uzun tokenları maskeler; kısa değerleri bozmaz', async () => {
  const db = fakeFirestore();
  const requests = [];
  seedClientErrors(db, 'leak-check', 20, {
    uid: 'u1',
    url: '/',
    message: 'Fetch failed: https://secret.example.com/api?token=gizli123&email=ali@ornek.com',
  });
  const alerts = createAlerts({
    firestoreDb: db,
    metrics: fakeMetrics([]),
    fetch: async (_url, opts) => {
      requests.push(JSON.parse(opts.body));
      return { ok: true, status: 200 };
    },
    env: { ALERT_WEBHOOK_URL: 'https://hooks.example.com/test' },
    now: FIXED_NOW,
  });

  const result = await alerts.runAlerts();
  assert.equal(result.sent, 1);
  assert.equal(requests.length, 1);
  const webhookText = requests[0].text;
  assert.match(webhookText, /Fetch failed: \[bağlantı\]/);
  assert.doesNotMatch(webhookText, /secret\.example\.com|gizli123|ali@ornek\.com/);

  // Düz metinde e-posta, Bearer ve uzun karma token maskelenir; normal hata metni ve kısa url/uid korunur.
  const direct = cleanClientErrorText(
    'Kullanıcı ali@ornek.com Bearer sk-gizli-9999 token Abc123Def456Ghi789Jkl012Mn hatası (u1/test)',
    { uid: 'u1', url: '/' },
    200,
  );
  assert.doesNotMatch(direct, /ali@ornek\.com|sk-gizli-9999|Abc123Def456Ghi789Jkl012Mn/);
  assert.match(direct, /\(u1\/test\)/);
});

test('checkClientErrors fingerprint alanı olmayan belgeleri mesaj+release üzerinden gruplar', async () => {
  const db = fakeFirestore();
  for (let i = 0; i < 3; i += 1) {
    db.docs.set(`client_errors/legacy-${i}`, {
      day: TODAY,
      message: `İstek ${i} başarısız`,
      release: 'v2',
    });
  }
  const alerts = createAlerts({
    firestoreDb: db,
    metrics: fakeMetrics([]),
    env: { ALERT_CLIENT_ERRORS: '50', ALERT_CLIENT_ERROR_SPIKE: '3' },
    now: FIXED_NOW,
  });

  const alert = await alerts.checkClientErrors();
  assert.ok(alert);
  assert.equal(alert.total, 3);
  assert.equal(alert.top.length, 1);
  assert.equal(alert.top[0].count, 3);
  assert.equal(alert.top[0].fingerprint, clientErrorFingerprint('İstek 0 başarısız', 'v2'));
});
