const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { registerDocumentsRoutes } = require('../routes/documents');

const LONG_TEXT = Array.from({ length: 1200 }, (_, i) => `kelime${i}`).join(' ');

function createApp({ embed, upsert, scrollPoints = [], uid = 'u1' } = {}) {
  const calls = { upserts: [], deletes: [], scrolls: [] };
  const qdrantClient = {
    getCollection: async () => ({}),
    createCollection: async () => ({}),
    upsert: async (collection, body) => {
      calls.upserts.push(body.points.length);
      if (upsert) await upsert(calls.upserts.length);
    },
    delete: async (collection, body) => { calls.deletes.push(body.filter); },
    scroll: async (collection, body) => {
      calls.scrolls.push(body);
      const userFilter = body.filter?.must?.find(rule => rule.key === 'userId')?.match?.value;
      const filtered = userFilter
        ? scrollPoints.filter(p => p.payload?.userId === userFilter)
        : scrollPoints;
      const start = typeof body.offset === 'number' ? body.offset : 0;
      const limit = body.limit || 100;
      const page = filtered.slice(start, start + limit);
      const nextOffset = start + limit < filtered.length ? start + limit : null;
      return { points: page, next_page_offset: nextOffset };
    },
  };
  let embedCount = 0;
  const fetch = async () => {
    embedCount += 1;
    const result = embed ? embed(embedCount) : { ok: true, values: [0.1, 0.2] };
    return {
      ok: result.ok,
      status: result.ok ? 200 : 500,
      json: async () => ({ embedding: result.values ? { values: result.values } : undefined }),
    };
  };
  let idCounter = 0;
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use((req, res, next) => { req.user = { uid }; next(); });
  registerDocumentsRoutes(app, {
    fetch,
    qdrantClient,
    QDRANT_COLLECTION: 'test',
    enforceDailyQuota: () => (req, res, next) => next(),
    uuidv4: () => `id-${++idCounter}`,
  });
  return { app, calls };
}

test('RAG yükleme metin parçası çıkmazsa başarı saymaz', async () => {
  const { app, calls } = createApp();
  const response = await request(app).post('/rag/upload').send({ fileName: 'a.txt', content: 'kısa metin' });
  assert.equal(response.status, 422);
  assert.equal(calls.upserts.length, 0);
});

test('RAG yükleme embedding servisi hata verirse başarı saymaz', async () => {
  const { app, calls } = createApp({ embed: () => ({ ok: false }) });
  const response = await request(app).post('/rag/upload').send({ fileName: 'a.txt', content: LONG_TEXT });
  assert.equal(response.status, 503);
  assert.equal(calls.upserts.length, 0);
});

test('RAG yükleme bir parçanın embedding\'i boş dönerse yarım belge kaydetmez', async () => {
  const { app, calls } = createApp({ embed: (n) => (n === 2 ? { ok: true, values: [] } : { ok: true, values: [0.1] }) });
  const response = await request(app).post('/rag/upload').send({ fileName: 'a.txt', content: LONG_TEXT });
  assert.equal(response.status, 503);
  assert.equal(calls.upserts.length, 0);
});

test('RAG yükleme kayıt yarıda kalırsa yazılan parçaları temizler', async () => {
  const words = Array.from({ length: 50000 }, (_, i) => `kelime${i}`).join(' ');
  const { app, calls } = createApp({
    upsert: async (n) => { if (n === 2) throw new Error('qdrant düştü'); },
  });
  const response = await request(app).post('/rag/upload').send({ fileName: 'a.txt', content: words });
  assert.equal(response.status, 503);
  assert.equal(calls.upserts.length, 2);
  assert.equal(calls.deletes.length, 1);
  const values = calls.deletes[0].must.map(rule => rule.match.value);
  assert.ok(values.includes('u1'));
});

test('RAG yükleme bütün parçalar indekslenince başarı döner', async () => {
  const { app, calls } = createApp();
  const response = await request(app).post('/rag/upload').send({ fileName: 'a.txt', content: LONG_TEXT });
  assert.equal(response.status, 200);
  assert.equal(response.body.documentId, 'id-1');
  assert.equal(response.body.fileName, 'a.txt');
  assert.equal(response.body.chunksCount, 3);
  assert.deepEqual(calls.upserts, [3]);
});

test('RAG listeleme 300 noktayı next_page_offset ile okuyup doğru chunksCount ve sıralama döner', async () => {
  const scrollPoints = [];
  // 3 belge: doc-1 (120 parça), doc-2 (100 parça), doc-3 (80 parça) => toplam 300 nokta
  const specs = [
    { documentId: 'doc-1', fileName: 'eski.txt', uploadedAt: '2026-01-01T10:00:00.000Z', count: 120 },
    { documentId: 'doc-2', fileName: 'yeni.txt', uploadedAt: '2026-03-01T10:00:00.000Z', count: 100 },
    { documentId: 'doc-3', fileName: 'orta.txt', uploadedAt: '2026-02-01T10:00:00.000Z', count: 80 },
  ];
  for (const spec of specs) {
    for (let i = 0; i < spec.count; i += 1) {
      scrollPoints.push({
        id: `${spec.documentId}-${i}`,
        payload: {
          userId: 'u1',
          documentId: spec.documentId,
          fileName: spec.fileName,
          uploadedAt: spec.uploadedAt,
          chunkIndex: i,
        },
      });
    }
  }

  const { app, calls } = createApp({ scrollPoints });
  const response = await request(app).get('/rag/documents/u1');
  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.total, 3);
  assert.equal(response.body.nextCursor, null);
  assert.equal(response.body.truncated, undefined);
  assert.equal(calls.scrolls.length, 2);
  assert.equal(calls.scrolls[0].limit, 256);
  assert.deepEqual(calls.scrolls[0].with_payload, { include: ['documentId', 'fileName', 'uploadedAt', 'userId'] });
  assert.equal(calls.scrolls[1].offset, 256);
  assert.ok(response.body.documents.every(d => d.partial === undefined));
  assert.deepEqual(
    response.body.documents.map(d => ({ id: d.documentId, chunks: d.chunksCount })),
    [
      { id: 'doc-2', chunks: 100 },
      { id: 'doc-3', chunks: 80 },
      { id: 'doc-1', chunks: 120 },
    ]
  );
});

test('RAG listeleme limit ve cursor ile sayfalar, geçersiz cursor 0 olur', async () => {
  const scrollPoints = Array.from({ length: 25 }, (_, i) => ({
    id: `p-${i}`,
    payload: {
      userId: 'u1',
      documentId: `doc-${i + 1}`,
      fileName: `f-${i + 1}.txt`,
      uploadedAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
      chunkIndex: 0,
    },
  }));

  const { app } = createApp({ scrollPoints });

  // Parametresiz: varsayılan 20 + nextCursor 20
  const defRes = await request(app).get('/rag/documents/u1');
  assert.equal(defRes.status, 200);
  assert.equal(defRes.body.documents.length, 20);
  assert.equal(defRes.body.nextCursor, 20);
  assert.equal(defRes.body.total, 25);
  assert.equal(defRes.body.documents[0].documentId, 'doc-25');

  // Özel limit ve cursor
  const page1 = await request(app).get('/rag/documents/u1?limit=10&cursor=0');
  assert.equal(page1.body.documents.length, 10);
  assert.equal(page1.body.nextCursor, 10);

  const page2 = await request(app).get('/rag/documents/u1?limit=10&cursor=10');
  assert.equal(page2.body.documents.length, 10);
  assert.equal(page2.body.nextCursor, 20);
  assert.equal(page2.body.documents[0].documentId, 'doc-15');

  const page3 = await request(app).get('/rag/documents/u1?limit=10&cursor=20');
  assert.equal(page3.body.documents.length, 5);
  assert.equal(page3.body.nextCursor, null);

  // Geçersiz cursor -> 0
  const badCursor = await request(app).get('/rag/documents/u1?limit=5&cursor=abc');
  assert.equal(badCursor.body.documents.length, 5);
  assert.equal(badCursor.body.documents[0].documentId, 'doc-25');
  assert.equal(badCursor.body.nextCursor, 5);
});

test('RAG listeleme 5000 nokta sınırında truncated: true döner', async () => {
  const scrollPoints = Array.from({ length: 5050 }, (_, i) => ({
    id: `p-${i}`,
    payload: {
      userId: 'u1',
      documentId: `doc-${i % 10}`,
      fileName: `file-${i % 10}.txt`,
      uploadedAt: '2026-04-01T00:00:00.000Z',
      chunkIndex: i,
    },
  }));

  const { app } = createApp({ scrollPoints });
  const response = await request(app).get('/rag/documents/u1?limit=100');
  assert.equal(response.status, 200);
  assert.equal(response.body.truncated, true);
  assert.ok(response.body.documents.length > 0);
  assert.ok(response.body.documents.every(d => d.partial === true));
  const totalChunks = response.body.documents.reduce((sum, d) => sum + d.chunksCount, 0);
  assert.equal(totalChunks, 5000);
});

test('RAG listeleme path parametresi farklı olsa bile başka kullanıcının noktalarını döndürmez', async () => {
  const scrollPoints = [
    {
      id: 'p-1',
      payload: { userId: 'u1', documentId: 'doc-u1', fileName: 'benim.txt', uploadedAt: '2026-04-01T00:00:00.000Z', chunkIndex: 0 },
    },
    {
      id: 'p-2',
      payload: { userId: 'u2', documentId: 'doc-u2', fileName: 'baskasi.txt', uploadedAt: '2026-04-02T00:00:00.000Z', chunkIndex: 0 },
    },
  ];

  const { app, calls } = createApp({ scrollPoints, uid: 'u1' });
  const response = await request(app).get('/rag/documents/u2');
  assert.equal(response.status, 200);
  assert.equal(response.body.total, 1);
  assert.deepEqual(response.body.documents.map(d => d.documentId), ['doc-u1']);
  assert.equal(calls.scrolls[0].filter.must[0].match.value, 'u1');
});
