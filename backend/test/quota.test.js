const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createQuota } = require('../quota');
const { fakeFirestore } = require('./fakeFirestore');

const FieldValue = { serverTimestamp: () => 'ts' };

function appWith({ db = fakeFirestore(), env = {}, uid = 'u1' } = {}) {
  const quota = createQuota({ firestoreDb: db, FieldValue, env });
  const app = express();
  app.use((req, res, next) => { req.user = { uid }; next(); });
  app.post('/agent/run', quota.enforceDailyQuota('agent'), (req, res) => res.json({ ok: true }));
  app.post('/chat', quota.enforceDailyQuota('chat'), (req, res) => res.json({ ok: true }));
  return { app, db, quota };
}

test('agent kotası sohbetten ayrı ve daha düşüktür', () => {
  const { quota } = appWith();
  assert.ok(quota.FREE_DAILY_QUOTAS.agent > 0);
  assert.ok(quota.FREE_DAILY_QUOTAS.agent < quota.FREE_DAILY_QUOTAS.chat);
  assert.ok(quota.PRO_DAILY_QUOTAS.agent > quota.FREE_DAILY_QUOTAS.agent);
  assert.ok(quota.PRO_DAILY_QUOTAS.agent < quota.PRO_DAILY_QUOTAS.chat);
});

test('agent sınırı dolunca 429 döner, sohbet kotası etkilenmez', async () => {
  const { app } = appWith({ env: { FREE_DAILY_AGENT_LIMIT: '2' } });
  assert.equal((await request(app).post('/agent/run')).status, 200);
  assert.equal((await request(app).post('/agent/run')).status, 200);
  const blocked = await request(app).post('/agent/run');
  assert.equal(blocked.status, 429);
  assert.match(blocked.body.error, /agent/);
  const chat = await request(app).post('/chat');
  assert.equal(chat.status, 200);
  assert.equal(chat.headers['x-daily-remaining'], '49');
});

test('aynı günün sayaçları tek belgede birlikte tutulur', async () => {
  const { app, db } = appWith();
  await request(app).post('/chat');
  await request(app).post('/agent/run');
  const [doc] = [...db.docs.values()];
  assert.equal(doc.chat, 1);
  assert.equal(doc.agent, 1);
});

test('Pro kullanıcı Pro agent sınırını alır', async () => {
  const db = fakeFirestore();
  await db.collection('users').doc('u1').set({ billing: { plan: 'pro', status: 'active' } });
  const { app } = appWith({ db });
  const response = await request(app).post('/agent/run');
  assert.equal(response.headers['x-daily-limit'], '200');
});

test('kota okunamazsa maliyetli işlem çalışmaz', async () => {
  const db = fakeFirestore();
  db.runTransaction = async () => { throw new Error('firestore kapalı'); };
  const { app } = appWith({ db });
  assert.equal((await request(app).post('/agent/run')).status, 503);
});

test('sınır dolunca 429 kalan hakkı 0 ve daily_limit koduyla bildirir', async () => {
  const { app } = appWith({ env: { FREE_DAILY_CHAT_LIMIT: '1' } });
  assert.equal((await request(app).post('/chat')).status, 200);
  const blocked = await request(app).post('/chat');
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers['x-daily-remaining'], '0');
  assert.equal(blocked.body.code, 'daily_limit');
});

test('consumeDailyQuota: limit yokken izin verir, sınır altında sayacı artırır, sınırda allowed false döner', async () => {
  const db = fakeFirestore();
  const quota = createQuota({ firestoreDb: db, FieldValue, env: { FREE_DAILY_ASSIST_LIMIT: '2' } });

  const unlimited = await quota.consumeDailyQuota('u1', 'tanimsiz_tur');
  assert.deepEqual(unlimited, { allowed: true, limit: 0, remaining: null });
  assert.equal(db.docs.size, 0);

  const first = await quota.consumeDailyQuota('u1', 'assist');
  assert.deepEqual(first, { allowed: true, limit: 2, remaining: 1 });

  const second = await quota.consumeDailyQuota('u1', 'assist');
  assert.deepEqual(second, { allowed: true, limit: 2, remaining: 0 });

  const third = await quota.consumeDailyQuota('u1', 'assist');
  assert.deepEqual(third, { allowed: false, limit: 2, remaining: 0 });
});

test('ide kotası sınır altında izin verir, sınırda 429 ile reddedilir', async () => {
  const db = fakeFirestore();
  const quota = createQuota({ firestoreDb: db, FieldValue, env: { FREE_DAILY_IDE_LIMIT: '2' } });
  assert.equal(quota.FREE_DAILY_QUOTAS.ide, 2);
  assert.equal(quota.PRO_DAILY_QUOTAS.ide, 3000);

  const app = express();
  app.use((req, _res, next) => { req.user = { uid: 'u1' }; next(); });
  app.post('/ide/complete', quota.enforceDailyQuota('ide'), (_req, res) => res.json({ ok: true }));

  const first = await request(app).post('/ide/complete');
  assert.equal(first.status, 200);
  assert.equal(first.headers['x-daily-limit'], '2');
  assert.equal(first.headers['x-daily-remaining'], '1');

  const second = await request(app).post('/ide/complete');
  assert.equal(second.status, 200);
  assert.equal(second.headers['x-daily-remaining'], '0');

  const third = await request(app).post('/ide/complete');
  assert.equal(third.status, 429);
  assert.equal(third.body.code, 'daily_limit');
  assert.match(third.body.error, /ide/);
});

