const crypto = require('crypto');
const memoryStore = require('../memoryStore');
const memoryAssist = require('../memoryAssist');
const { renderCorePrompt } = require('../memory/select');
const { createLearner } = require('../memory/learn');

const noQuota = () => (req, res, next) => next();

// Kimlik her zaman doğrulanmış token'dan gelir; istekteki userId yok sayılır.
function registerMemoryRoutes(app, { firestoreDb, fetch, enforceDailyQuota = noQuota, metrics = { track() {} }, packStore = null, serverLearn = false, learner: injectedLearner = null }) {
  const learner = injectedLearner || createLearner({ firestoreDb, fetch, packStore, metrics });
  const refreshPack = async uid => {
    if (!packStore) return;
    try {
      await packStore.rebuild(uid);
    } catch (error) {
      console.warn('Hafıza paketi yenilenemedi:', error.message);
    }
  };

  const trackAssist = (req, route, ok, usage, startedAt, via = memoryAssist.primaryAssist()) => metrics.track({
    uid: req.user?.uid, route, provider: via.provider, model: via.model,
    ok, usage, status: ok ? 200 : 503, latencyMs: Date.now() - startedAt,
  });

  // Kişisel bilgi içermesi mümkün olmayan mesajlar kota ve model harcamadan geçilir.
  const skipImpersonalMessages = (req, res, next) => {
    const { message } = req.body || {};
    if (typeof message !== 'string') return res.status(400).json({ error: 'message metin olmalı.' });
    if (!memoryAssist.mightContainPersonalInfo(message)) return res.json({ success: true, saved: [], forgotten: [], skipped: true });
    if (!memoryAssist.isAssistAvailable()) return res.status(503).json({ error: 'Otomatik hafıza şu anda kullanılamıyor.' });
    return next();
  };

  app.post('/memory/extract', skipImpersonalMessages, enforceDailyQuota('assist'), async (req, res) => {
    try {
      const { saved, forgotten } = await learner.learn({ uid: req.user.uid, message: req.body.message });
      res.json({ success: true, saved, forgotten });
    } catch (e) {
      console.error('Otomatik hafıza çıkarılamadı:', e.message);
      res.status(503).json({ error: 'Otomatik hafıza şu anda kullanılamıyor.' });
    }
  });

  app.post('/memory/summarize', enforceDailyQuota('assist'), async (req, res) => {
    const startedAt = Date.now();
    const { previous_summary: previousSummary, messages } = req.body || {};
    const validMessages = Array.isArray(messages) && messages.length > 0 && messages.length <= 200
      && messages.every(msg => msg && ['user', 'ai', 'assistant'].includes(msg.role) && typeof msg.content === 'string');
    if (!validMessages || (previousSummary !== undefined && typeof previousSummary !== 'string')) {
      return res.status(400).json({ error: 'messages geçerli bir mesaj listesi olmalı.' });
    }
    if (!memoryAssist.isAssistAvailable()) return res.status(503).json({ error: 'Sohbet özeti şu anda kullanılamıyor.' });
    try {
      const { summary, usage, via } = await memoryAssist.summarizeConversation(fetch, {
        previousSummary: memoryAssist.cleanSummary(previousSummary),
        messages,
      });
      trackAssist(req, 'memory_summarize', true, usage, startedAt, via);
      if (!summary) return res.status(503).json({ error: 'Sohbet özeti şu anda kullanılamıyor.' });
      res.json({ success: true, summary });
    } catch (e) {
      trackAssist(req, 'memory_summarize', false, null, startedAt);
      console.error('Sohbet özetlenemedi:', e.message);
      res.status(503).json({ error: 'Sohbet özeti şu anda kullanılamıyor.' });
    }
  });

  // Başka bir yapay zekâ uygulamasından kopyalanan hafıza dökümünü içe aktarır.
  app.post('/memory/import', (req, res, next) => {
    const { text } = req.body || {};
    if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'Yapıştırılan metin boş.' });
    if (text.length > memoryAssist.MAX_IMPORT_CHARS) return res.status(400).json({ error: 'Metin çok uzun.' });
    if (!memoryAssist.isAssistAvailable()) return res.status(503).json({ error: 'Hafıza aktarımı şu anda kullanılamıyor.' });
    return next();
  }, enforceDailyQuota('assist'), async (req, res) => {
    const startedAt = Date.now();
    try {
      const uid = req.user.uid;
      const existing = await memoryStore.listMemories(firestoreDb, uid);
      const { memories, from, usage, via } = await memoryAssist.importMemories(fetch, { text: req.body.text, existing });
      trackAssist(req, 'memory_import', true, usage, startedAt, via);
      const existingKeys = new Set(existing.map(memory => memory.key));
      let count = existing.length;
      let skippedForLimit = 0;
      const saved = [];
      for (const memory of memories) {
        const isUpdate = existingKeys.has(memory.key);
        if (!isUpdate && count >= memoryAssist.MAX_MEMORIES_PER_USER) { skippedForLimit += 1; continue; }
        saved.push(await memoryStore.saveMemory(firestoreDb, uid, { ...memory, source: 'import' }));
        if (!isUpdate) { count += 1; existingKeys.add(memory.key); }
      }
      if (saved.length > 0) {
        await refreshPack(uid);
      }
      res.json({ success: true, saved, skippedForLimit, from });
    } catch (e) {
      trackAssist(req, 'memory_import', false, null, startedAt);
      console.error('Hafıza içe aktarılamadı:', e.message);
      res.status(503).json({ error: 'Hafıza aktarımı şu anda kullanılamıyor.' });
    }
  });

  // Hafızadaki kayıtlara dayanan kısa, objektif kullanıcı yorumu. Hafıza değişmedikçe önbellekten gelir.
  // Elle yenileme model çağırır; günlük yardımcı kotasından düşer. Önbellek ıskası yalnızca hafıza değişince olur.
  app.post('/memory/insight', (req, res, next) => (req.body?.refresh === true ? enforceDailyQuota('assist')(req, res, next) : next()), async (req, res) => {
    const startedAt = Date.now();
    try {
      const uid = req.user.uid;
      const userRef = firestoreDb.collection('users').doc(uid);
      // Başka uygulamadan taşınan bilgiler yoruma girmez; yorum yalnızca KocaMind'deki sohbetlere ve oradan öğrenilenlere dayanır.
      const [allMemories, chatsSnapshot] = await Promise.all([
        memoryStore.listMemories(firestoreDb, uid),
        userRef.collection('chats').get(),
      ]);
      const memories = allMemories.filter(memory => memory.source !== 'import');
      const chats = chatsSnapshot.docs.map(doc => doc.data() || {});
      const messages = memoryAssist.recentUserMessages(chats);
      const chatCount = chats.filter(chat => (chat.messages || []).some(m => m?.role === 'user')).length;
      if (memories.length < memoryAssist.MIN_INSIGHT_MEMORIES && messages.length < memoryAssist.MIN_INSIGHT_MESSAGES) {
        return res.json({ success: true, insight: null, reason: 'few', basedOn: memories.length, chats: chatCount });
      }
      const hash = crypto.createHash('sha256')
        .update(memories.map(m => `${m.key}\u0000${m.value}`).sort().join('\u0001'))
        .update('\u0002')
        .update(messages.join('\u0001'))
        .digest('hex');
      const cacheRef = firestoreDb.collection('users').doc(uid).collection('memory_meta').doc('insight');
      if (req.body?.refresh !== true) {
        const cached = await cacheRef.get();
        if (cached.exists && cached.data()?.hash === hash && cached.data()?.insight) {
          return res.json({ success: true, insight: cached.data().insight, basedOn: memories.length, chats: chatCount, createdAt: cached.data().createdAt || null });
        }
      }
      if (!memoryAssist.isAssistAvailable()) return res.status(503).json({ error: 'Yorum şu anda oluşturulamıyor.' });
      const { insight, usage, via } = await memoryAssist.describeUser(fetch, { memories, messages });
      trackAssist(req, 'memory_insight', true, usage, startedAt, via);
      if (!insight) return res.status(503).json({ error: 'Yorum şu anda oluşturulamıyor.' });
      const createdAt = new Date().toISOString();
      await cacheRef.set({ hash, insight, createdAt });
      res.json({ success: true, insight, basedOn: memories.length, chats: chatCount, createdAt });
    } catch (e) {
      trackAssist(req, 'memory_insight', false, null, startedAt);
      console.error('Hafıza yorumu oluşturulamadı:', e.message);
      res.status(503).json({ error: 'Yorum şu anda oluşturulamıyor.' });
    }
  });

  app.post('/memory/save', async (req, res) => {
    try {
      const { key, value, category } = req.body || {};
      if (typeof key !== 'string' || !key.trim() || typeof value !== 'string' || !value.trim()
        || (category !== undefined && typeof category !== 'string')) {
        return res.status(400).json({ error: 'key ve value metin olmalı.' });
      }
      const memory = await memoryStore.saveMemory(firestoreDb, req.user.uid, { key, value, category });
      await refreshPack(req.user.uid);
      res.json({ success: true, memory });
    } catch (e) {
      console.error('Hafıza kaydedilemedi:', e.message);
      res.status(500).json({ error: 'Hafıza kaydedilemedi.' });
    }
  });

  app.post('/memory/recall', async (req, res) => {
    try {
      const { query, category } = req.body || {};
      let memories = await memoryStore.listMemories(firestoreDb, req.user.uid);
      if (category) memories = memories.filter(m => m.category === category);
      if (query) {
        const q = String(query).toLocaleLowerCase('tr');
        memories = memories.filter(m =>
          m.key.toLocaleLowerCase('tr').includes(q)
          || m.value.toLocaleLowerCase('tr').includes(q)
        );
      }
      res.json({ success: true, memories });
    } catch (e) {
      console.error('Hafıza okunamadı:', e.message);
      res.status(500).json({ error: 'Hafıza okunamadı.' });
    }
  });

  app.delete('/memory/delete', async (req, res) => {
    try {
      const { key } = req.body || {};
      if (key !== undefined && (typeof key !== 'string' || !key.trim())) {
        return res.status(400).json({ error: 'key metin olmalı.' });
      }
      if (key) await memoryStore.deleteMemory(firestoreDb, req.user.uid, key);
      else await memoryStore.deleteAllMemories(firestoreDb, req.user.uid);
      await refreshPack(req.user.uid);
      res.json({ success: true });
    } catch (e) {
      console.error('Hafıza silinemedi:', e.message);
      res.status(500).json({ error: 'Hafıza silinemedi.' });
    }
  });

  app.get('/memory/pack', async (req, res) => {
    const pack = packStore ? await packStore.get(req.user.uid) : null;
    if (!pack) {
      return res.json({ version: 0, text: '', lastLearn: null, serverLearn: Boolean(serverLearn) });
    }
    return res.json({
      version: Number(pack.version) || 0,
      text: renderCorePrompt(pack),
      lastLearn: pack.lastLearn ?? null,
      serverLearn: Boolean(serverLearn),
    });
  });

  app.get('/memory/list/:userId', async (req, res) => {
    try {
      const memories = await memoryStore.listMemories(firestoreDb, req.user.uid);
      res.json({ success: true, memories, count: memories.length });
    } catch (e) {
      console.error('Hafıza listelenemedi:', e.message);
      res.status(500).json({ error: 'Hafıza listelenemedi.' });
    }
  });
}

module.exports = { registerMemoryRoutes };
