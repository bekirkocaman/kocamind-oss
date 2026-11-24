const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const request = require('supertest');
const { createFeedbackStore } = require('../learning/feedbackStore');
const { registerLearningRoutes } = require('../routes/learning');
const { registerAccountRoutes } = require('../routes/account');
const { fakeFirestore } = require('./fakeFirestore');

const day = '2026-11-19';

function setup({ admin = false, enforceDailyQuota } = {}) {
  const db = fakeFirestore();
  const collection = db.collection;
  // Paylaşılan fakeFirestore yalnızca açıkça verilen belge kimliklerini destekler.
  db.collection = name => {
    const ref = collection(name);
    if (name === 'bug_reports') return { ...ref, doc: (id = randomUUID()) => ref.doc(id) };
    return ref;
  };
  let time = new Date(`${day}T10:00:00.000Z`);
  const store = createFeedbackStore({ firestoreDb: db, now: () => time });
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { uid: 'u1', admin }; next(); });
  registerLearningRoutes(app, {
    feedbackStore: store,
    requireAdmin: (req, res, next) => (req.user.admin ? next() : res.status(403).end()),
    firestoreDb: db,
    enforceDailyQuota,
  });
  return { db, app, store, setTime: iso => { time = new Date(iso); } };
}

test('olumsuz oy ayrıntıları kaydedilir, olumluya geçince neden ve not silinir, skorlar güncellenir', async () => {
  const { app, db, store } = setup();
  const vote = input => request(app).post('/feedback').send({ messageId: 'm1', model: 'm', ...input });
  const context = { platform: 'web', appVersion: '1.2', finishReason: 'stop', latencyMs: 600000, deepThink: false, tools: ['search'] };
  assert.equal((await vote({ type: 'down', reason: 'wrong', note: 'Hatalı sonuç', context })).status, 202);
  const saved = db.docs.get('feedback/u1_temp_m1');
  assert.equal(saved.reason, 'wrong');
  assert.equal(saved.note, 'Hatalı sonuç');
  assert.deepEqual(saved.context, context);
  const counts = async () => (await store.listScores()).map(({ up, down }) => ({ up, down }));
  assert.deepEqual(await counts(), [{ up: 0, down: 1 }]);

  assert.equal((await vote({ type: 'up', reason: 'slow', note: 'Gereksiz not', context })).status, 202);
  const updated = db.docs.get('feedback/u1_temp_m1');
  assert.equal(Object.hasOwn(updated, 'reason'), false);
  assert.equal(Object.hasOwn(updated, 'note'), false);
  assert.deepEqual(updated.context, context);
  assert.deepEqual(await counts(), [{ up: 1, down: 0 }]);
  assert.equal((await vote({ type: null })).status, 202);
  assert.equal(db.docs.has('feedback/u1_temp_m1'), false);
  assert.deepEqual(await counts(), [{ up: 0, down: 0 }]);
});

test('neden ve bağlam doğrulanır, not ve bağlam dizeleri sınırlandırılır', async () => {
  const { db, store } = setup();
  await store.record('u1', {
    type: 'down', messageId: 'm1', reason: 'unknown', note: '\u0000\u0085' + 'n'.repeat(501),
    context: {
      platform: 'desktop', appVersion: 'v'.repeat(41), finishReason: 'f'.repeat(41),
      latencyMs: 600001, deepThink: 'true', extra: 'sil', tools: [123, ...Array(11).fill('t'.repeat(61))],
    },
  });
  const saved = db.docs.get('feedback/u1_temp_m1');
  assert.equal(Object.hasOwn(saved, 'reason'), false);
  assert.equal(saved.note, 'n'.repeat(500));
  assert.deepEqual(saved.context, { appVersion: 'v'.repeat(40), finishReason: 'f'.repeat(40), tools: Array(10).fill('t'.repeat(60)) });
});

test('yönetici olumsuz oyları güne, modele ve nedene göre filtreleyebilir', async () => {
  const { app, db, store, setTime } = setup({ admin: true });
  const record = (messageId, type, model, reason) => store.record('u1', { messageId, type, model, reason });
  await record('m1', 'down', 'a', 'wrong');
  setTime(`${day}T11:00:00Z`);
  await record('m2', 'down', 'a', 'slow');
  await record('m3', 'up', 'a');
  setTime(`${day}T12:00:00Z`);
  await record('m4', 'down', 'b', 'slow');
  setTime('2026-11-18T10:00:00Z');
  await record('yesterday', 'down', 'a', 'slow');
  setTime(`${day}T13:00:00Z`);

  const list = async (query = {}) => {
    const res = await request(app).get('/admin/feedback/bad').query(query);
    assert.equal(res.status, 200);
    for (const entry of res.body.feedback) {
      assert.equal(entry.type, 'down');
      assert.equal(Object.hasOwn(entry, 'uid'), false);
      assert.equal(Object.hasOwn(entry, 'id'), false);
    }
    return res.body.feedback.map(entry => entry.messageId);
  };
  assert.deepEqual(await list(), ['m4', 'm2', 'm1']);
  assert.deepEqual(await list({ day: '2026-11-18' }), ['yesterday']);
  assert.deepEqual(await list({ model: 'a' }), ['m2', 'm1']);
  assert.deepEqual(await list({ reason: 'slow', limit: 1 }), ['m4']);
  assert.deepEqual(await list({ model: 'a', reason: 'slow' }), ['m2']);
  for (let i = 0; i < 200; i += 1) db.docs.set(`feedback/legacy-${i}`, { type: 'down', day });
  assert.equal((await list()).length, 50);
  assert.equal((await list({ limit: 1000 })).length, 200);
  assert.equal((await request(setup().app).get('/admin/feedback/bad')).status, 403);
});

test('hata bildirimi doğrulanır, otomatik kimlikle kaydedilir ve yönetici listesi uid içermez', async () => {
  const { app, db } = setup({ admin: true });
  const submit = body => request(app).post('/feedback/bug').send(body);
  assert.equal((await submit({ text: '123456789' })).status, 400);
  assert.equal((await submit({ text: 'x'.repeat(4001) })).status, 400);
  const response = await submit({ text: 'Buton çalışmıyor', chatId: 'c1', messageId: 'm1', context: { platform: 'android', latencyMs: 0, extra: 'sil' }, uid: 'u2' });
  assert.equal(response.status, 201);
  const { id } = response.body;
  assert.ok(id);
  const { uid, ...report } = db.docs.get(`bug_reports/${id}`);
  assert.equal(uid, 'u1');
  assert.deepEqual(report, {
    text: 'Buton çalışmıyor', chatId: 'c1', messageId: 'm1', context: { platform: 'android', latencyMs: 0 },
    day, createdAt: `${day}T10:00:00.000Z`, status: 'open',
  });
  const another = await submit({ text: '1234567890' });
  assert.equal(another.status, 201);
  assert.notEqual(another.body.id, id);
  db.docs.set(`bug_reports/${another.body.id}`, { ...db.docs.get(`bug_reports/${another.body.id}`), status: 'closed' });

  const list = await request(app).get('/admin/bugs?status=open&limit=1');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.bugs, [{ id, ...report }]);
  assert.equal((await request(setup().app).get('/admin/bugs')).status, 403);
});

test('oy ve hata bildirimi aynı günlük geri bildirim kotasını kullanır', async () => {
  let used = 0;
  const { app, db } = setup({
    enforceDailyQuota: kind => (req, res, next) => {
      assert.equal(kind, 'feedback');
      used += 1;
      return used > 1 ? res.sendStatus(429) : next();
    },
  });
  assert.equal((await request(app).post('/feedback').send({ type: 'up', messageId: 'm1' })).status, 202);
  assert.equal((await request(app).post('/feedback/bug').send({ text: 'Buton çalışmıyor' })).status, 429);
  assert.equal((await db.collection('bug_reports').get()).size, 0);
});

test('kalıcı hesap silme yalnızca ilgili kullanıcının oylarını ve hata bildirimlerini temizler', async () => {
  const db = fakeFirestore();
  db.docs.set('feedback/u1_temp_m1', { uid: 'u1' });
  db.docs.set('bug_reports/b1', { uid: 'u1' });
  db.docs.set('bug_reports/b2', { uid: 'u2' });
  const app = express();
  app.use((req, res, next) => { req.user = { uid: 'u1', deletionPending: true }; next(); });
  registerAccountRoutes(app, { firestoreDb: db, firebaseAuth: { deleteUser: async () => {} } });

  assert.equal((await request(app).delete('/account/now')).status, 200);
  assert.equal(db.docs.has('feedback/u1_temp_m1'), false);
  assert.equal(db.docs.has('bug_reports/b1'), false);
  assert.equal(db.docs.has('bug_reports/b2'), true);
});

test('POST /feedback/bug kontrol karakterlerini temizler ve geçersiz bağlamda null yazar', async () => {
  const { app, db, store } = setup();
  const submit = body => request(app).post('/feedback/bug').send(body);

  // NUL baytları temizlenince 10 karakterden kısa kalır -> 400
  assert.equal((await submit({ text: `a${'\u0000'.repeat(15)}b` })).status, 400);

  const ok = await submit({
    text: 'Buton\u0000\u0007 çalışmıyor\u001f!',
    context: { extra: 1, platform: 'desktop', latencyMs: -5 },
  });
  assert.equal(ok.status, 201);
  const savedBug = db.docs.get(`bug_reports/${ok.body.id}`);
  assert.equal(savedBug.text, 'Buton çalışmıyor!');
  assert.equal(savedBug.context, null);

  // normalizeContext geçerli alanı olmayan nesne için undefined döner (feedback kaydında context oluşmaz)
  await store.record('u1', { type: 'down', messageId: 'm-empty-ctx', context: { extra: 1 } });
  assert.equal(Object.hasOwn(db.docs.get('feedback/u1_temp_m-empty-ctx'), 'context'), false);
});

test('listBugs ve listBad createdAt eksik belgelerde 500 vermez ve Firestore okumasını sınırlar', async () => {
  const { app, db } = setup({ admin: true });
  const seenLimits = [];
  const origCollection = db.collection;
  db.collection = name => {
    const col = origCollection(name);
    const wrap = q => ({
      ...q,
      where: (...args) => wrap(q.where(...args)),
      limit: n => {
        seenLimits.push({ name, limit: n });
        return wrap(q.limit(n));
      },
    });
    return wrap(col);
  };

  db.docs.set('bug_reports/missing-date', { uid: 'u1', text: 'Tarihsiz hata bildirimi', status: 'open' });
  db.docs.set('bug_reports/with-date', { uid: 'u1', text: 'Tarihli hata bildirimi', status: 'open', createdAt: `${day}T12:00:00.000Z` });
  db.docs.set('feedback/u1_c1_nodate', { uid: 'u1', type: 'down', day, messageId: 'nodate' });
  db.docs.set('feedback/u1_c1_dated', { uid: 'u1', type: 'down', day, messageId: 'dated', updatedAt: `${day}T12:00:00.000Z` });

  const bugsRes = await request(app).get('/admin/bugs?status=open');
  assert.equal(bugsRes.status, 200);
  assert.deepEqual(bugsRes.body.bugs.map(b => b.id), ['with-date', 'missing-date']);

  const badRes = await request(app).get(`/admin/feedback/bad?day=${day}`);
  assert.equal(badRes.status, 200);
  assert.deepEqual(badRes.body.feedback.map(f => f.messageId), ['dated', 'nodate']);

  assert.ok(seenLimits.some(item => item.name === 'bug_reports' && item.limit === 1000));
  assert.ok(seenLimits.some(item => item.name === 'feedback' && item.limit === 1000));
});
