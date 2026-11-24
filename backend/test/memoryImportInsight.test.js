const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const memoryStore = require('../memoryStore');
const { registerMemoryRoutes } = require('../routes/memory');
const { fakeFirestore } = require('./fakeFirestore');

function assistFetch(contents, calls = []) {
  return async (url, options) => {
    calls.push(JSON.parse(options.body));
    const content = contents[Math.min(calls.length - 1, contents.length - 1)];
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }], usage: {} }) };
  };
}

function appWith({ firestoreDb, fetch }) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => { req.user = { uid: 'u1' }; next(); });
  registerMemoryRoutes(app, { firestoreDb, fetch });
  return app;
}

test.beforeEach(() => { process.env.DEEPSEEK_API_KEY = 'test'; });

test('içe aktarma: başka uygulamanın hafıza dökümü kaydedilir, hassas veri atılır', async () => {
  const db = fakeFirestore();
  const calls = [];
  const parsed = JSON.stringify({ memories: [
    { key: 'isim', value: 'Bekir', category: 'kisisel' },
    { key: 'meslek', value: 'Bilgisayar mühendisliği öğrencisi', category: 'is' },
    { key: 'kart', value: '4111 1111 1111 1111', category: 'genel' },
  ] });
  const app = appWith({ firestoreDb: db, fetch: assistFetch([parsed], calls) });
  const res = await request(app).post('/memory/import').send({ text: '- [Kişisel] isim: Bekir\n- [İş] meslek: öğrenci' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.saved.map(m => m.key).sort(), ['isim', 'meslek']);
  assert.equal(calls.length, 1);
  assert.match(calls[0].messages[1].content, /isim: Bekir/);
  const stored = await memoryStore.listMemories(db, 'u1');
  assert.equal(stored.length, 2);
});

test('içe aktarma: boş metin reddedilir, model çağrılmaz', async () => {
  const calls = [];
  const app = appWith({ firestoreDb: fakeFirestore(), fetch: assistFetch(['{}'], calls) });
  const res = await request(app).post('/memory/import').send({ text: '   ' });
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test('içe aktarma: 100 kayıt sınırı aşılmaz', async () => {
  const db = fakeFirestore();
  for (let i = 0; i < 99; i++) await memoryStore.saveMemory(db, 'u1', { key: `not ${i}`, value: 'x' });
  const parsed = JSON.stringify({ memories: [
    { key: 'a', value: '1' }, { key: 'b', value: '2' }, { key: 'c', value: '3' },
  ] });
  const app = appWith({ firestoreDb: db, fetch: assistFetch([parsed]) });
  const res = await request(app).post('/memory/import').send({ text: 'a: 1\nb: 2\nc: 3' });
  assert.equal(res.status, 200);
  assert.equal(res.body.saved.length, 1);
  assert.equal(res.body.skippedForLimit, 2);
});

test('yorum: az bilgiyle üretilmez', async () => {
  const db = fakeFirestore();
  await memoryStore.saveMemory(db, 'u1', { key: 'isim', value: 'Bekir' });
  const calls = [];
  const app = appWith({ firestoreDb: db, fetch: assistFetch(['yorum'], calls) });
  const res = await request(app).post('/memory/insight').send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.insight, null);
  assert.equal(res.body.reason, 'few');
  assert.equal(calls.length, 0);
});

test('yorum: üretilir, değişmeyen hafızada önbellekten gelir, değişince yenilenir', async () => {
  const db = fakeFirestore();
  for (const [key, value] of [['isim', 'Bekir'], ['şehir', 'Üsküp'], ['bölüm', 'Bilgisayar bilimleri'], ['hedef', 'Kendi şirketini kurmak']]) {
    await memoryStore.saveMemory(db, 'u1', { key, value });
  }
  const calls = [];
  const app = appWith({ firestoreDb: db, fetch: assistFetch(['Teknolojiye yönelmiş bir öğrenci.', 'Güncel yorum.'], calls) });
  const first = await request(app).post('/memory/insight').send({});
  assert.equal(first.body.insight, 'Teknolojiye yönelmiş bir öğrenci.');
  assert.equal(first.body.basedOn, 4);
  assert.match(calls[0].messages[1].content, /hedef: Kendi şirketini kurmak/);
  const second = await request(app).post('/memory/insight').send({});
  assert.equal(second.body.insight, 'Teknolojiye yönelmiş bir öğrenci.');
  assert.equal(calls.length, 1);
  await memoryStore.saveMemory(db, 'u1', { key: 'hobi', value: 'Video çekmek' });
  const third = await request(app).post('/memory/insight').send({});
  assert.equal(third.body.insight, 'Güncel yorum.');
  assert.equal(calls.length, 2);
});

test('yorum: refresh=true önbelleği atlar', async () => {
  const db = fakeFirestore();
  for (const key of ['a', 'b', 'c']) await memoryStore.saveMemory(db, 'u1', { key, value: key });
  const calls = [];
  const app = appWith({ firestoreDb: db, fetch: assistFetch(['bir', 'iki'], calls) });
  await request(app).post('/memory/insight').send({});
  const res = await request(app).post('/memory/insight').send({ refresh: true });
  assert.equal(res.body.insight, 'iki');
  assert.equal(calls.length, 2);
});

test('yorum: elle yenileme kotadan düşer, normal açılış düşmez', async () => {
  const db = fakeFirestore();
  for (const key of ['a', 'b', 'c']) await memoryStore.saveMemory(db, 'u1', { key, value: key });
  const quota = [];
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { uid: 'u1' }; next(); });
  registerMemoryRoutes(app, { firestoreDb: db, fetch: assistFetch(['yorum']), enforceDailyQuota: kind => (req, res, next) => { quota.push(kind); next(); } });
  await request(app).post('/memory/insight').send({});
  assert.deepEqual(quota, []);
  await request(app).post('/memory/insight').send({ refresh: true });
  assert.deepEqual(quota, ['assist']);
});

async function addChat(db, id, messages, updatedAt = Date.now()) {
  await db.collection('users').doc('u1').collection('chats').doc(id).set({ title: id, updatedAt, messages });
}

test('yorum: hafıza azken bile yeterli sohbet varsa sohbetlerden üretilir', async () => {
  const db = fakeFirestore();
  const userMsgs = Array.from({ length: 8 }, (_, i) => ({ role: 'user', content: `Kotlin ile Android uygulamamda şu hatayı nasıl çözerim ${i}` }));
  await addChat(db, 'c1', [...userMsgs, { role: 'model', content: 'GİZLİ ASİSTAN CEVABI' }]);
  const calls = [];
  const app = appWith({ firestoreDb: db, fetch: assistFetch(['Android geliştirmeyle uğraşıyorsun.'], calls) });
  const res = await request(app).post('/memory/insight').send({});
  assert.equal(res.body.insight, 'Android geliştirmeyle uğraşıyorsun.');
  assert.equal(res.body.chats, 1);
  assert.equal(res.body.basedOn, 0);
  const prompt = calls[0].messages[1].content;
  assert.match(prompt, /Kotlin ile Android/);
  assert.doesNotMatch(prompt, /GİZLİ ASİSTAN CEVABI/);
});

test('yorum: yeni sohbet mesajı önbelleği geçersiz kılar', async () => {
  const db = fakeFirestore();
  for (const key of ['a', 'b', 'c']) await memoryStore.saveMemory(db, 'u1', { key, value: key });
  await addChat(db, 'c1', [{ role: 'user', content: 'ilk soru burada' }], 1);
  const calls = [];
  const app = appWith({ firestoreDb: db, fetch: assistFetch(['bir', 'iki'], calls) });
  await request(app).post('/memory/insight').send({});
  await request(app).post('/memory/insight').send({});
  assert.equal(calls.length, 1);
  await addChat(db, 'c1', [{ role: 'user', content: 'ilk soru burada' }, { role: 'user', content: 'yeni bir soru daha' }], 2);
  const res = await request(app).post('/memory/insight').send({});
  assert.equal(res.body.insight, 'iki');
  assert.equal(calls.length, 2);
});

test('yorum: başka uygulamadan taşınan bilgiler yoruma girmez', async () => {
  const db = fakeFirestore();
  const imported = JSON.stringify({ memories: [
    { key: 'meslek', value: 'Pilot', category: 'is' },
    { key: 'şehir', value: 'Ankara', category: 'kisisel' },
    { key: 'hobi', value: 'Dalış', category: 'genel' },
  ] });
  const calls = [];
  const app = appWith({ firestoreDb: db, fetch: assistFetch([imported, 'yorum'], calls) });
  await request(app).post('/memory/import').send({ text: 'meslek: Pilot' });
  const stored = await memoryStore.listMemories(db, 'u1');
  assert.ok(stored.every(m => m.source === 'import'));
  const few = await request(app).post('/memory/insight').send({});
  assert.equal(few.body.reason, 'few');
  assert.equal(few.body.basedOn, 0);
  assert.equal(calls.length, 1);

  for (const [key, value] of [['isim', 'Bekir'], ['bölüm', 'Bilgisayar bilimleri'], ['hedef', 'Şirket kurmak']]) {
    await memoryStore.saveMemory(db, 'u1', { key, value });
  }
  const res = await request(app).post('/memory/insight').send({});
  assert.equal(res.body.basedOn, 3);
  const prompt = calls[1].messages[1].content;
  assert.match(prompt, /bölüm: Bilgisayar bilimleri/);
  assert.doesNotMatch(prompt, /Pilot|Ankara|Dalış/);
});

test('içe aktarma: kaynak uygulama son satırdan okunur', async () => {
  const parsed = JSON.stringify({ memories: [{ key: 'isim', value: 'Bekir', category: 'kisisel' }] });
  const app = appWith({ firestoreDb: fakeFirestore(), fetch: assistFetch([parsed]) });
  const text = '1. Demografik Bilgiler\nKullanıcının adı Bekir.\n* Kanıt: Kullanıcı, "Bana Bekir de" dedi. Tarih: [2026-05-01].\n\nŞuradan içe aktarıldı: ChatGPT';
  const res = await request(app).post('/memory/import').send({ text });
  assert.equal(res.body.from, 'ChatGPT');
});

test('sohbetten gelen güncelleme içe aktarma işaretini kaldırır', async () => {
  const db = fakeFirestore();
  await memoryStore.saveMemory(db, 'u1', { key: 'şehir', value: 'Ankara', source: 'import' });
  await memoryStore.saveMemory(db, 'u1', { key: 'şehir', value: 'İstanbul' });
  const [memory] = await memoryStore.listMemories(db, 'u1');
  assert.equal(memory.source, 'chat');
});
