const RAG_UNAVAILABLE = 'Doküman özelliği şu anda kullanılamıyor. Biraz sonra tekrar dene.';
const RAG_NO_TEXT = 'Dokümanda indekslenecek kadar metin bulunamadı.';
const RAG_INDEX_FAILED = 'Doküman indekslenemedi. Biraz sonra tekrar dene.';

function registerDocumentsRoutes(app, { fetch, qdrantClient, QDRANT_COLLECTION, enforceDailyQuota, uuidv4, ragEnabled = true }) {
  async function getEmbedding(text) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY || '' },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        taskType: 'RETRIEVAL_DOCUMENT',
      }),
    });
    if (!response.ok) throw new Error(`Embedding servisi ${response.status} döndü`);
    const data = await response.json();
    return data.embedding?.values || [];
  }

  function chunkText(text, chunkSize = 500, overlap = 50) {
    const words = text.split(/\s+/);
    const chunks = [];
    for (let i = 0; i < words.length; i += chunkSize - overlap) {
      const chunk = words.slice(i, i + chunkSize).join(' ');
      if (chunk.trim().length > 20) chunks.push(chunk);
    }
    return chunks;
  }

  async function ensureCollection() {
    if (!qdrantClient) throw new Error('Qdrant bağlı değil');
    try {
      await qdrantClient.getCollection(QDRANT_COLLECTION);
    } catch {
      await qdrantClient.createCollection(QDRANT_COLLECTION, {
        vectors: { size: 768, distance: 'Cosine' },
      });
      console.log('✅ Qdrant collection oluşturuldu:', QDRANT_COLLECTION);
    }
  }

  app.post('/rag/upload', enforceDailyQuota('upload'), async (req, res) => {
    try {
      const userId = req.user.uid;
      const { fileName, content } = req.body || {};
      if (typeof content !== 'string' || !content.trim()) {
        return res.status(400).json({ error: 'Doküman içeriği gerekli.' });
      }

      const chunks = chunkText(content);
      if (chunks.length === 0) {
        return res.status(422).json({ error: RAG_NO_TEXT });
      }

      await ensureCollection();

      const documentId = uuidv4();
      const uploadedAt = new Date().toISOString();
      const resolvedFileName = fileName || 'Adsız Dosya';
      const points = [];

      for (let i = 0; i < chunks.length; i++) {
        let embedding;
        try {
          embedding = await getEmbedding(chunks[i]);
        } catch (e) {
          console.error('RAG embedding hatası:', e.message);
          embedding = [];
        }
        if (embedding.length === 0) {
          return res.status(503).json({ error: RAG_INDEX_FAILED });
        }

        points.push({
          id: uuidv4(),
          vector: embedding,
          payload: {
            userId,
            documentId,
            fileName: resolvedFileName,
            chunkIndex: i,
            content: chunks[i],
            uploadedAt,
          },
        });
      }

      try {
        for (let i = 0; i < points.length; i += 100) {
          const batch = points.slice(i, i + 100);
          await qdrantClient.upsert(QDRANT_COLLECTION, { points: batch });
        }
      } catch (e) {
        console.error('RAG kayıt hatası:', e.message);
        await qdrantClient.delete(QDRANT_COLLECTION, {
          filter: {
            must: [
              { key: 'documentId', match: { value: documentId } },
              { key: 'userId', match: { value: userId } },
            ],
          },
        }).catch(cleanupError => console.error('RAG yarım kayıt temizlenemedi:', cleanupError.message));
        return res.status(503).json({ error: RAG_INDEX_FAILED });
      }

      res.json({
        success: true,
        documentId,
        fileName: resolvedFileName,
        chunksCount: points.length,
        uploadedAt,
        message: `${points.length} parça başarıyla indekslendi.`,
      });
    } catch (e) {
      console.error('RAG upload hatası:', e.message);
      res.status(503).json({ error: RAG_UNAVAILABLE });
    }
  });

  app.post('/rag/query', async (req, res) => {
    // Qdrant tanımlı değilse bağlanmayı deneyip hata beklemek her mesajı geciktirir;
    // istemci `disabled` görünce bu oturumda tekrar sormaz.
    if (!ragEnabled) return res.json({ success: true, disabled: true, contexts: [], contextString: '', totalResults: 0 });
    try {
      const userId = req.user.uid;
      const { query } = req.body || {};
      const topK = Math.min(Math.max(Number.parseInt(req.body?.topK, 10) || 5, 1), 10);
      if (typeof query !== 'string' || !query.trim()) {
        return res.status(400).json({ error: 'Soru gerekli.' });
      }

      await ensureCollection();

      const queryEmbedding = await getEmbedding(query);
      if (queryEmbedding.length === 0) {
        return res.status(400).json({ error: 'Query embedding oluşturulamadı' });
      }

      const results = await qdrantClient.search(QDRANT_COLLECTION, {
        vector: queryEmbedding,
        limit: topK,
        filter: {
          must: [{ key: 'userId', match: { value: userId } }],
        },
      });

      const contexts = results.map(r => ({
        content: r.payload.content,
        fileName: r.payload.fileName,
        score: r.score,
        chunkIndex: r.payload.chunkIndex,
      }));

      // Build context string for AI
      const contextString = contexts
        .map((c, i) => `[Kaynak ${i + 1}: ${c.fileName} (skor: ${c.score.toFixed(2)})]\n${c.content}`)
        .join('\n\n---\n\n');

      res.json({
        success: true,
        contexts,
        contextString,
        totalResults: contexts.length,
      });
    } catch (e) {
      console.error('RAG query hatası:', e.message);
      res.status(503).json({ error: RAG_UNAVAILABLE });
    }
  });

  app.get('/rag/documents/:userId', async (req, res) => {
    if (!ragEnabled) return res.json({ success: true, disabled: true, documents: [], nextCursor: null, total: 0 });
    try {
      await ensureCollection();

      // Güvenlik: path'teki :userId parametresi bilinçli olarak yok sayılır;
      // başka kullanıcının belgeleri listelenmesin diye her zaman doğrulanmış req.user.uid kullanılır.
      const userId = req.user.uid;
      const rawLimit = Number.parseInt(req.query?.limit, 10);
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 20;
      const rawCursor = Number.parseInt(req.query?.cursor, 10);
      const cursor = Number.isFinite(rawCursor) && rawCursor >= 0 ? rawCursor : 0;

      const SCROLL_PAGE_SIZE = 256;
      const MAX_SCROLL_POINTS = 5000;
      let offset;
      let scannedPoints = 0;
      let truncated = false;
      const docs = {};

      while (true) {
        const remaining = MAX_SCROLL_POINTS - scannedPoints;
        if (remaining <= 0) {
          truncated = true;
          break;
        }
        const pageLimit = Math.min(SCROLL_PAGE_SIZE, remaining);
        const scrollParams = {
          filter: {
            must: [{ key: 'userId', match: { value: userId } }],
          },
          limit: pageLimit,
          with_payload: { include: ['documentId', 'fileName', 'uploadedAt', 'userId'] },
          with_vector: false,
        };
        if (offset !== undefined && offset !== null) {
          scrollParams.offset = offset;
        }

        const results = await qdrantClient.scroll(QDRANT_COLLECTION, scrollParams);
        const points = Array.isArray(results?.points) ? results.points : [];

        for (const point of points) {
          if (scannedPoints >= MAX_SCROLL_POINTS) {
            truncated = true;
            break;
          }
          scannedPoints += 1;
          const payload = point?.payload;
          if (!payload || !payload.documentId) continue;
          if (payload.userId && payload.userId !== userId) continue;

          const docId = payload.documentId;
          if (!docs[docId]) {
            docs[docId] = {
              documentId: docId,
              fileName: payload.fileName,
              uploadedAt: payload.uploadedAt,
              chunksCount: 0,
            };
          } else if (payload.uploadedAt && (!docs[docId].uploadedAt || Date.parse(payload.uploadedAt) > Date.parse(docs[docId].uploadedAt))) {
            docs[docId].uploadedAt = payload.uploadedAt;
          }
          docs[docId].chunksCount += 1;
        }

        const nextOffset = results?.next_page_offset;
        if (nextOffset === undefined || nextOffset === null || points.length === 0) {
          break;
        }
        if (scannedPoints >= MAX_SCROLL_POINTS) {
          truncated = true;
          break;
        }
        offset = nextOffset;
      }

      const sortedDocs = Object.values(docs).sort((a, b) => {
        const ta = Date.parse(a.uploadedAt || '') || 0;
        const tb = Date.parse(b.uploadedAt || '') || 0;
        return tb - ta;
      });

      const total = sortedDocs.length;
      const page = sortedDocs
        .slice(cursor, cursor + limit)
        .map(doc => (truncated ? { ...doc, partial: true } : doc));
      const nextCursor = cursor + limit < total ? cursor + limit : null;

      const body = {
        success: true,
        documents: page,
        nextCursor,
        total,
      };
      if (truncated) body.truncated = true;

      res.json(body);
    } catch (e) {
      console.error('RAG documents hatası:', e.message);
      res.status(503).json({ error: RAG_UNAVAILABLE });
    }
  });

  app.delete('/rag/document/:documentId', async (req, res) => {
    try {
      await ensureCollection();
      
      await qdrantClient.delete(QDRANT_COLLECTION, {
        filter: {
          must: [
            { key: 'documentId', match: { value: req.params.documentId } },
            { key: 'userId', match: { value: req.user.uid } },
          ],
        },
      });

      res.json({ success: true, message: 'Doküman silindi.' });
    } catch (e) {
      console.error('RAG delete hatası:', e.message);
      res.status(503).json({ error: RAG_UNAVAILABLE });
    }
  });
}

module.exports = { registerDocumentsRoutes };
