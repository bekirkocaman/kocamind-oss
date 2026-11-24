const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const memoryAssist = require('../memoryAssist');
const memoryStore = require('../memoryStore');
const { registerMemoryRoutes } = require('../routes/memory');
const { fakeFirestore } = require('./fakeFirestore');

function fakeAssistFetch(content, calls = []) {
  return async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) };
  };
}

function appWith({ firestoreDb, fetch }) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { uid: 'u1' }; next(); });
  registerMemoryRoutes(app, { firestoreDb, fetch });
  return app;
}

test('kişisel bilgi ön elemesi yalnızca birinci tekil şahıs mesajlarını geçirir', () => {
  assert.equal(memoryAssist.mightContainPersonalInfo('Adım Bekir, İzmir’de yaşıyorum'), true);
  assert.equal(memoryAssist.mightContainPersonalInfo('Bunu unutma: kahveyi şekersiz içerim'), true);
  assert.equal(memoryAssist.mightContainPersonalInfo('Türkiye’nin başkenti neresi?'), false);
  assert.equal(memoryAssist.mightContainPersonalInfo('selam'), false);
});

test('çıkarım sonucu temizlenir ve hassas değerler atılır', () => {
  const result = memoryAssist.sanitizeExtraction({
    memories: [
      { key: 'isim', value: 'Bekir', category: 'kisisel' },
      { key: 'tc', value: '10000000146', category: 'kisisel' },
      { key: 'kart', value: '4111 1111 1111 1111' },
      { key: 'şifre', value: 'şifrem abc123' },
      { key: 'şehir', value: 'İzmir', category: 'bilinmeyen' },
    ],
    forget: ['eski', 'olmayan'],
  }, ['eski']);
  assert.deepEqual(result.memories, [
    { key: 'isim', value: 'Bekir', category: 'kisisel' },
    { key: 'şehir', value: 'İzmir', category: 'genel' },
  ]);
  assert.deepEqual(result.forget, ['eski']);
});

test('geçmiş bütçeye sığacak kadar en yeni mesajlarla kırpılır', () => {
  const history = [
    { role: 'user', content: 'a'.repeat(50) },
    { role: 'ai', content: 'b'.repeat(50) },
    { role: 'user', content: 'c'.repeat(50) },
    { role: 'ai', content: 'd'.repeat(50) },
  ];
  assert.deepEqual(memoryAssist.trimHistory(history, 1000), history);
  assert.deepEqual(memoryAssist.trimHistory(history, 120).map(m => m.content[0]), ['c', 'd']);
  assert.deepEqual(memoryAssist.trimHistory(history, 60).map(m => m.content[0]), []);
});

test('sohbet özeti sistem talimatına eklenir', () => {
  assert.equal(memoryAssist.withConversationSummary('Sistem', ''), 'Sistem');
  assert.match(memoryAssist.withConversationSummary('Sistem', '- React projesi'), /ÖNCEKİ KISMININ ÖZETİ[\s\S]*React projesi/);
});

test('/memory/extract kişisel olmayan mesajda modeli çağırmaz', async () => {
  process.env.DEEPSEEK_API_KEY = 'test';
  const calls = [];
  const app = appWith({ firestoreDb: fakeFirestore(), fetch: fakeAssistFetch('{}', calls) });
  const response = await request(app).post('/memory/extract').send({ message: 'Hava durumu nasıl?' });
  assert.equal(response.status, 200);
  assert.equal(response.body.skipped, true);
  assert.equal(calls.length, 0);
});

test('/memory/extract bilgileri kaydeder, günceller ve unutur', async () => {
  process.env.DEEPSEEK_API_KEY = 'test';
  const firestoreDb = fakeFirestore();
  await memoryStore.saveMemory(firestoreDb, 'u1', { key: 'şehir', value: 'Ankara', category: 'kisisel' });
  await memoryStore.saveMemory(firestoreDb, 'u1', { key: 'eski iş', value: 'Garson', category: 'is' });
  const calls = [];
  const fetch = fakeAssistFetch(JSON.stringify({
    memories: [{ key: 'isim', value: 'Bekir', category: 'kisisel' }, { key: 'şehir', value: 'İzmir', category: 'kisisel' }],
    forget: ['eski iş'],
  }), calls);
  const app = appWith({ firestoreDb, fetch });

  const response = await request(app).post('/memory/extract').send({ message: 'Adım Bekir, artık İzmir’de yaşıyorum, eski işimi unut' });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.saved.map(m => m.key), ['isim', 'şehir']);
  assert.deepEqual(response.body.saved.map(m => m.isNew), [true, false]);
  assert.deepEqual(response.body.forgotten, ['eski iş']);
  assert.match(calls[0].body.messages[1].content, /şehir: Ankara/);

  const memories = await memoryStore.listMemories(firestoreDb, 'u1');
  assert.deepEqual(Object.fromEntries(memories.map(m => [m.key, m.value])), { isim: 'Bekir', şehir: 'İzmir' });
});

test('/memory/summarize geçersiz isteği reddeder ve özeti döndürür', async () => {
  process.env.DEEPSEEK_API_KEY = 'test';
  const app = appWith({ firestoreDb: fakeFirestore(), fetch: fakeAssistFetch('- Kullanıcı React öğreniyor') });

  const bad = await request(app).post('/memory/summarize').send({ messages: [{ role: 'system', content: 'x' }] });
  assert.equal(bad.status, 400);

  const ok = await request(app).post('/memory/summarize').send({
    previous_summary: '- Önceki',
    messages: [{ role: 'user', content: 'React öğreniyorum' }, { role: 'ai', content: 'Harika' }],
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.summary, '- Kullanıcı React öğreniyor');
});

test('özet kullanıcının söylediklerini asistanın doğrulanmamış cevaplarından ayırır', () => {
  assert.match(memoryAssist.SUMMARY_PROMPT, /Kullanıcının söyledikleri:/);
  assert.match(memoryAssist.SUMMARY_PROMPT, /Asistanın önceki cevapları \(doğrulanmamış\):/);
  const prompt = memoryAssist.withConversationSummary('Sistem', '- React projesi');
  assert.match(prompt, /doğrulanmış bilgi değildir/);
  assert.doesNotMatch(prompt, /biliyormuş gibi/);
});

test('özet başlığı web ve Android ile birebir aynı', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..', '..');
  const web = fs.readFileSync(path.join(root, 'kocamind-web/src/lib/memoryContext.js'), 'utf8');
  const android = fs.readFileSync(path.join(root, 'kocamind-android/app/src/main/java/com/tyler/kocamind/data/memory/MemoryContext.kt'), 'utf8');
  assert.ok(web.includes(memoryAssist.SUMMARY_HEADER));
  assert.ok(android.includes(memoryAssist.SUMMARY_HEADER.replace(/"/g, '\\"')));
});
