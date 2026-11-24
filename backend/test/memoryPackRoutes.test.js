const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { registerMemoryRoutes } = require('../routes/memory');
const { createPackStore } = require('../memory/packStore');
const { fakeFirestore } = require('./fakeFirestore');

function setup({
  uid = 'u1',
  packStore,
  useDefaultPackStore = true,
  serverLearn = false,
  fetch = async () => ({ ok: true, json: async () => ({}) }),
} = {}) {
  const db = fakeFirestore();
  const resolvedPackStore = packStore !== undefined
    ? packStore
    : (useDefaultPackStore ? createPackStore({ firestoreDb: db, now: () => new Date('2026-11-10T12:00:00.000Z') }) : undefined);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const headerUid = req.headers['x-test-uid'];
    req.user = { uid: headerUid || uid };
    next();
  });

  registerMemoryRoutes(app, {
    firestoreDb: db,
    fetch,
    packStore: resolvedPackStore,
    serverLearn,
  });

  return { app, db, packStore: resolvedPackStore };
}

test('kayıt eklenince paketin sürümü artar ve kayıt pakette görünür', async () => {
  const { app, packStore } = setup();

  const saveRes = await request(app)
    .post('/memory/save')
    .send({ key: 'isim', value: 'Bekir', category: 'kisisel' });
  assert.equal(saveRes.status, 200);

  const pack = await packStore.get('u1');
  assert.equal(pack.version, 1);
  assert.deepEqual(pack.core, [{ key: 'isim', value: 'Bekir' }]);

  await request(app)
    .post('/memory/save')
    .send({ key: 'şehir', value: 'İstanbul', category: 'kisisel' });

  const pack2 = await packStore.get('u1');
  assert.equal(pack2.version, 2);
  assert.equal(pack2.core.length, 2);
});

test('kayıt silinince paketten çıkar', async () => {
  const { app, packStore } = setup();

  await request(app).post('/memory/save').send({ key: 'isim', value: 'Bekir', category: 'kisisel' });
  await request(app).post('/memory/save').send({ key: 'şehir', value: 'İstanbul', category: 'kisisel' });

  const delRes = await request(app).delete('/memory/delete').send({ key: 'şehir' });
  assert.equal(delRes.status, 200);

  const pack = await packStore.get('u1');
  assert.equal(pack.version, 3);
  assert.deepEqual(pack.core, [{ key: 'isim', value: 'Bekir' }]);
});

test('tümünü silince paket boşalır', async () => {
  const { app, packStore } = setup();

  await request(app).post('/memory/save').send({ key: 'isim', value: 'Bekir', category: 'kisisel' });
  await request(app).post('/memory/save').send({ key: 'proje', value: 'KocaMind', category: 'genel' });

  const delRes = await request(app).delete('/memory/delete').send({});
  assert.equal(delRes.status, 200);

  const pack = await packStore.get('u1');
  assert.equal(pack.version, 3);
  assert.deepEqual(pack.core, []);
  assert.deepEqual(pack.optional, []);
});

test('GET /memory/pack çekirdek metni ve sürümü döndürür', async () => {
  const { app } = setup();

  await request(app).post('/memory/save').send({ key: 'isim', value: 'Bekir', category: 'kisisel' });
  await request(app).post('/memory/save').send({ key: 'araba', value: 'Toyota', category: 'genel' });

  const res = await request(app).get('/memory/pack');
  assert.equal(res.status, 200);
  assert.equal(res.body.version, 2);
  assert.ok(res.body.text.includes('- isim: Bekir'));
  assert.ok(!res.body.text.includes('araba'));
  assert.equal(res.body.lastLearn, null);
  assert.equal(res.body.serverLearn, false);
});

test('GET /memory/pack başkasının paketini döndürmez', async () => {
  const { app } = setup({ uid: 'u1' });

  await request(app)
    .post('/memory/save')
    .set('x-test-uid', 'u1')
    .send({ key: 'isim', value: 'Bekir', category: 'kisisel' });

  await request(app)
    .post('/memory/save')
    .set('x-test-uid', 'u2')
    .send({ key: 'isim', value: 'Ayşe', category: 'kisisel' });

  const res = await request(app)
    .get('/memory/pack?uid=u2&userId=u2')
    .set('x-test-uid', 'u1');

  assert.equal(res.status, 200);
  assert.ok(res.body.text.includes('- isim: Bekir'));
  assert.ok(!res.body.text.includes('Ayşe'));
});

test('packStore yokken GET /memory/pack boş paket ve 200 döndürür', async () => {
  const { app } = setup({ packStore: null, useDefaultPackStore: false });

  const res = await request(app).get('/memory/pack');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    version: 0,
    text: '',
    lastLearn: null,
    serverLearn: false,
  });
});

test('paket derleme hata verse de /memory/save 200 döner', async () => {
  let rebuildCalled = false;
  const failingPackStore = {
    get: async () => null,
    rebuild: async () => {
      rebuildCalled = true;
      throw new Error('derleme başarısız');
    },
    remove: async () => {},
  };
  const { app } = setup({ packStore: failingPackStore });

  const res = await request(app)
    .post('/memory/save')
    .send({ key: 'isim', value: 'Bekir', category: 'kisisel' });

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.memory.key, 'isim');
  assert.equal(rebuildCalled, true);
});

test('içe aktarmada birden çok kayıt yazılınca paket bir kez yenilenir', async () => {
  const prevKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'test-key';
  try {
    const db = fakeFirestore();
    const basePackStore = createPackStore({ firestoreDb: db, now: () => new Date('2026-11-10T12:00:00.000Z') });
    let rebuildCount = 0;
    const countingPackStore = {
      ...basePackStore,
      rebuild: async (uid, opts) => {
        rebuildCount += 1;
        return basePackStore.rebuild(uid, opts);
      },
    };

    const fakeFetch = async () => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              from: 'ChatGPT',
              memories: [
                { key: 'isim', value: 'Bekir', category: 'kisisel' },
                { key: 'şehir', value: 'İstanbul', category: 'kisisel' },
                { key: 'meslek', value: 'Mühendis', category: 'is' },
              ],
            }),
          },
        }],
      }),
    });

    const { app } = setup({
      packStore: countingPackStore,
      fetch: fakeFetch,
    });
    // aynı db'yi kullanmak için yeniden kur
    const appWithDb = express();
    appWithDb.use(express.json());
    appWithDb.use((req, _res, next) => { req.user = { uid: 'u1' }; next(); });
    registerMemoryRoutes(appWithDb, {
      firestoreDb: db,
      fetch: fakeFetch,
      packStore: countingPackStore,
    });
    void app;

    const res = await request(appWithDb)
      .post('/memory/import')
      .send({ text: 'Demografik: İsim Bekir, İstanbul, Mühendis. Şuradan içe aktarıldı: ChatGPT' });

    assert.equal(res.status, 200);
    assert.equal(res.body.saved.length, 3);
    assert.equal(rebuildCount, 1);
  } finally {
    if (prevKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = prevKey;
  }
});

test('serverLearn alanı ayardan gelir', async () => {
  const { app } = setup({ serverLearn: true });
  const res = await request(app).get('/memory/pack');
  assert.equal(res.status, 200);
  assert.equal(res.body.serverLearn, true);
});
