const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { registerTelemetryRoutes, clientErrorFingerprint } = require('../routes/telemetry');
const { registerAdminRoutes } = require('../routes/admin');
const { fakeFirestore } = require('./fakeFirestore');

test('istemci parmak izi sayıları, UUID ve uzun hex değerlerini normalleştirir', () => {
  const first = 'İstek 23 başarısız: 550e8400-e29b-41d4-a716-446655440000 ve a0413bceba2345ff';
  const second = '  İstek 987\tbaşarısız: f47ac10b-58cc-4372-a567-0e02b2c3d479 ve ddbc33a19854cabf ';
  const fingerprint = clientErrorFingerprint(first, 'v1');
  assert.match(fingerprint, /^[a-f0-9]{16}$/);
  assert.equal(clientErrorFingerprint(second, 'v1'), fingerprint);
  assert.notEqual(clientErrorFingerprint(second, 'v2'), fingerprint);
  assert.notEqual(clientErrorFingerprint('Yanıt okunamadı', 'v1'), fingerprint);
});

test('telemetri mevcut alanlarla birlikte day ve fingerprint yazar ve 202 döner', async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { uid: 'test-user' }; next(); });
  const writes = [];
  const serverTimestamp = Symbol('serverTimestamp');
  registerTelemetryRoutes(app, {
    firestoreDb: {
      collection(name) {
        assert.equal(name, 'client_errors');
        return { add: async data => writes.push(data) };
      },
    },
    FieldValue: { serverTimestamp: () => serverTimestamp },
  });
  const before = new Date().toISOString().slice(0, 10);
  const response = await request(app).post('/telemetry/error').send({
    message: '<İstek> 42', release: 'v1', stack: 'trace', componentStack: 'component',
    url: '/test', userAgent: 'test-agent',
  }).expect(202);
  const after = new Date().toISOString().slice(0, 10);
  assert.deepEqual(response.body, { accepted: true });
  assert.equal(writes.length, 1);
  const [{ day, ...data }] = writes;
  assert.ok([before, after].includes(day));
  assert.deepEqual(data, {
    uid: 'test-user', message: 'İstek 42', stack: 'trace', componentStack: 'component',
    url: '/test', userAgent: 'test-agent', release: 'v1', createdAt: serverTimestamp,
    fingerprint: clientErrorFingerprint('İstek 42', 'v1'),
  });
});

test('rapor kimliği eşzamanlı tekrarları tekilleştirir ve doğrulanmış hesaba göre ayrılır', async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { uid: req.get('X-Test-User') }; next(); });
  const documents = new Map();
  const createAttempts = [];
  registerTelemetryRoutes(app, {
    firestoreDb: {
      collection(name) {
        assert.equal(name, 'client_errors');
        return {
          doc(id) {
            return {
              async create(data) {
                createAttempts.push(id);
                if (id === 'owner-a_unavailable') throw Object.assign(new Error('unavailable'), { code: 14 });
                if (documents.has(id)) throw Object.assign(new Error('already exists'), { code: 6 });
                documents.set(id, data);
              },
            };
          },
        };
      },
    },
    FieldValue: { serverTimestamp: () => 'created' },
  });
  const send = (uid, body) => request(app).post('/telemetry/error').set('X-Test-User', uid).send(body);
  const reportId = 'Report_123-ABC';
  const body = { message: 'original', reportId, uid: 'body-spoof' };
  const responses = await Promise.all([send('owner-a', body).expect(202), send('owner-a', body).expect(202)]);
  for (const response of responses) assert.deepEqual(response.body, { accepted: true });
  assert.equal(documents.size, 1);
  const original = documents.get(`owner-a_${reportId}`);
  assert.equal(original.uid, 'owner-a');
  assert.deepEqual((await send('owner-a', { ...body, message: 'changed' }).expect(202)).body, { accepted: true });
  assert.equal(documents.get(`owner-a_${reportId}`).message, 'original');
  assert.deepEqual((await send('owner-b', body).expect(202)).body, { accepted: true });
  assert.equal(documents.get(`owner-b_${reportId}`).uid, 'owner-b');

  for (const acceptedId of ['a'.repeat(8), 'Z'.repeat(64)]) {
    assert.deepEqual((await send('owner-a', { reportId: acceptedId }).expect(202)).body, { accepted: true });
  }
  const validAttempts = createAttempts.length;
  for (const invalidId of ['', 'a'.repeat(7), 'a'.repeat(65), 'report/123', 'report123\n', 'report12İ', 12345678, null]) {
    await send('owner-a', { reportId: invalidId }).expect(400);
  }
  assert.equal(createAttempts.length, validAttempts);
  assert.deepEqual((await send('owner-a', { reportId: 'unavailable' }).expect(202)).body, { accepted: false });
  assert.equal(documents.size, 4);
});

const DAY = '2026-11-19';

function adminFixture() {
  const db = fakeFirestore();
  const limits = [];
  const getCollection = db.collection;
  db.collection = name => {
    const collection = getCollection(name);
    const where = collection.where;
    // Ortak Firestore taklidinde bulunmayan üst tarih sınırını ve limit takibini ekle.
    collection.where = (field, operator, value) => {
      const query = where(field, operator, value);
      if (operator !== '>=') {
        const origLimit = query.limit;
        return {
          ...query,
          limit: n => {
            limits.push({ field, operator, limit: n });
            return origLimit(n);
          },
        };
      }
      return {
        where(upperField, upperOperator, upperValue) {
          assert.equal(upperField, field);
          assert.equal(upperOperator, '<');
          const makeRange = (max = Infinity) => ({
            limit: n => {
              limits.push({ field, operator: '>=,<', limit: n });
              return makeRange(n);
            },
            async get() {
              const { docs } = await query.get();
              return { docs: docs.filter(doc => doc.data()[field] < upperValue).slice(0, max) };
            },
          });
          return makeRange();
        },
      };
    };
    return collection;
  };
  const app = express();
  registerAdminRoutes(app, {
    requireAdmin(req, res, next) {
      if (req.get('X-Test-Role') !== 'admin') return res.status(403).json({ error: 'Yetkisiz.' });
      next();
    },
    firestoreDb: db,
  });
  return { app, db, limits };
}

test('admin istemci hataları sayıya göre sıralanır ve en güncel örnek uid alanı olmadan döner', async () => {
  const { app, db } = adminFixture();
  const common = { day: DAY, release: 'v1', uid: 'hidden-user' };
  const fingerprint = clientErrorFingerprint('İstek 42', 'v1');
  db.docs.set('client_errors/1', {
    ...common, fingerprint, message: 'İstek 42', stack: 'eski', createdAt: new Date(`${DAY}T10:00:00Z`),
  });
  db.docs.set('client_errors/2', {
    ...common, fingerprint, message: 'İstek 90', stack: 'a'.repeat(1200), createdAt: new Date(`${DAY}T12:00:00Z`),
  });
  db.docs.set('client_errors/legacy', {
    release: 'v1', message: 'İstek 7', createdAt: new Date(`${DAY}T11:00:00Z`),
  });
  db.docs.set('client_errors/3', { ...common, fingerprint: 'single', message: 'Bağlantı hatası' });
  db.docs.set('client_errors/tomorrow', { ...common, day: '2026-11-20', fingerprint });
  db.docs.set('client_errors/legacy-tomorrow', {
    release: 'v1', message: 'İstek 12', createdAt: new Date('2026-11-20T00:00:00Z'),
  });

  await request(app).get('/admin/client-errors').query({ day: DAY }).expect(403);
  const response = await request(app).get('/admin/client-errors').query({ day: DAY })
    .set('X-Test-Role', 'admin').expect('Cache-Control', 'no-store').expect(200);
  assert.equal(response.body.day, DAY);
  assert.deepEqual(response.body.errors.map(row => row.count), [3, 1]);
  assert.deepEqual(response.body.errors[0], {
    fingerprint, count: 3, message: 'İstek 90', release: 'v1',
    lastSeen: `${DAY}T12:00:00.000Z`, sampleStack: 'a'.repeat(1000),
  });
  assert.doesNotMatch(response.text, /"uid"|hidden-user/);

  const limited = await request(app).get('/admin/client-errors').query({ day: DAY, limit: 1 })
    .set('X-Test-Role', 'admin').expect(200);
  assert.deepEqual(limited.body.errors, response.body.errors.slice(0, 1));
});

test('admin istemci hataları varsayılan 20 ve en fazla 100 grup döndürür', async () => {
  const { app, db } = adminFixture();
  for (let index = 0; index < 105; index += 1) {
    db.docs.set(`client_errors/${index}`, { day: DAY, fingerprint: `error-${index}` });
  }
  const path = '/admin/client-errors';
  const defaults = await request(app).get(path).query({ day: DAY }).set('X-Test-Role', 'admin').expect(200);
  const capped = await request(app).get(path).query({ day: DAY, limit: 105 }).set('X-Test-Role', 'admin').expect(200);
  const invalid = await request(app).get(path).query({ day: '2026-02-30' }).set('X-Test-Role', 'admin');
  assert.equal(defaults.body.errors.length, 20);
  assert.equal(capped.body.errors.length, 100);
  assert.equal(invalid.status, 400);
});

test('admin istemci hataları iki sorguya da 5000 sınırı koyar, belge kimliğiyle tekilleştirir ve gizlilik temizliği yapar', async () => {
  const { app, db, limits } = adminFixture();
  db.docs.set('client_errors/doc-1', {
    day: DAY,
    release: 'v1',
    uid: 'secret-uid-9999',
    url: '/',
    message: 'Hata https://secret.example.com/p?token=gizli123&email=ali@ornek.com secret-uid-9999',
    stack: 'Error: Bearer sk-gizli-token-123 at secret-uid-9999 veli@ornek.com https://internal.example.org/x',
    createdAt: new Date(`${DAY}T10:00:00Z`),
  });
  // day alanı olmayan eski kayıt: yalnızca createdAt sorgusundan gelir, aynı belge tekrar sayılmaz
  db.docs.set('client_errors/doc-legacy', {
    release: 'v1',
    uid: 'secret-uid-8888',
    message: 'Hata https://secret.example.com/p?token=gizli123&email=ali@ornek.com secret-uid-8888',
    createdAt: new Date(`${DAY}T11:00:00Z`),
  });

  const res = await request(app).get('/admin/client-errors').query({ day: DAY })
    .set('X-Test-Role', 'admin').expect(200);

  assert.deepEqual(
    limits.map(entry => entry.limit),
    [5000, 5000],
  );
  // doc-1 her iki sorgudan dönse de tek kez sayılır + doc-legacy (farklı uid olduğu için mesajı farklı olabilir; toplam belge sayısı 2)
  const totalCount = res.body.errors.reduce((sum, item) => sum + item.count, 0);
  assert.equal(totalCount, 2);
  assert.doesNotMatch(res.text, /secret-uid-9999|secret-uid-8888|secret\.example\.com|internal\.example\.org|gizli123|ali@ornek\.com|veli@ornek\.com|sk-gizli-token-123/);
});
