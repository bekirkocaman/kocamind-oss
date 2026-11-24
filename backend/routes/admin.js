const memoryStore = require('../memoryStore');
const { clientErrorFingerprint } = require('./telemetry');
const { cleanClientErrorText, CLIENT_ERROR_READ_LIMIT } = require('../alerts');
const { disabledProviders } = require('../learning/providerAvailability');

function clientErrorDate(timestamp) {
  const date = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp ?? NaN);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function registerAdminRoutes(app, { requireAdmin, firestoreDb, fetch, metrics }) {
  // Model başına günlük çağrı, hata oranı, ortalama gecikme, token ve tahmini maliyet.
  app.get('/admin/metrics', requireAdmin, async (req, res) => {
    try {
      const days = Number.parseInt(req.query.days, 10) || 7;
      const rows = await metrics.listDailyMetrics(days);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ days, pricingConfigured: metrics.pricingConfigured, metrics: rows });
    } catch (e) {
      console.error('Metrikler okunamadı:', e.message);
      res.status(500).json({ error: 'Metrikler okunamadı.' });
    }
  });

  app.get('/admin/client-errors', requireAdmin, async (req, res) => {
    const day = req.query.day ?? new Date().toISOString().slice(0, 10);
    const start = typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(day) : null;
    if (!start || clientErrorDate(start)?.slice(0, 10) !== day) {
      return res.status(400).json({ error: 'Geçerli bir gün girin (YYYY-MM-DD).' });
    }
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));

    try {
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      const collection = firestoreDb.collection('client_errors');
      const [daily, byTimestamp] = await Promise.all([
        collection.where('day', '==', day).limit(CLIENT_ERROR_READ_LIMIT).get(),
        collection.where('createdAt', '>=', start).where('createdAt', '<', end).limit(CLIENT_ERROR_READ_LIMIT).get(),
      ]);
      const seenIds = new Set();
      const rows = [];
      for (const doc of daily.docs) {
        if (doc.id !== undefined) seenIds.add(doc.id);
        rows.push(doc.data());
      }
      for (const doc of byTimestamp.docs) {
        if (doc.id !== undefined && seenIds.has(doc.id)) continue;
        const row = doc.data();
        if (row.day) continue;
        if (doc.id !== undefined) seenIds.add(doc.id);
        rows.push(row);
      }

      const groups = new Map();
      for (const row of rows) {
        const rawMessage = String(row.message ?? '');
        const rawRelease = String(row.release ?? '');
        const fingerprint = row.fingerprint || clientErrorFingerprint(rawMessage, rawRelease);
        const lastSeen = clientErrorDate(row.createdAt);
        const previous = groups.get(fingerprint);
        if (previous && (!lastSeen || (previous.lastSeen && lastSeen <= previous.lastSeen))) {
          previous.count += 1;
          continue;
        }
        groups.set(fingerprint, {
          fingerprint,
          count: (previous?.count ?? 0) + 1,
          message: cleanClientErrorText(rawMessage, row, 500),
          release: cleanClientErrorText(rawRelease, row, 100),
          lastSeen,
          sampleStack: cleanClientErrorText(
            row.stack,
            { uid: row.uid, url: row.url, componentStack: row.componentStack },
            1000,
          ),
        });
      }
      const errors = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, limit);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ day, errors });
    } catch (e) {
      console.error('İstemci hataları okunamadı:', e.message);
      res.status(500).json({ error: 'İstemci hataları okunamadı.' });
    }
  });

  const PROFILE_PROMPT = `Sen bir kullanıcı davranış analistisin. Aşağıdaki sohbet mesajlarını analiz et ve şu başlıklarda profil çıkar:

  1. İLGİ ALANLARI: En sık sorduğu konular (3-5 madde)
  2. KİŞİLİK: Karakter özellikleri, her biri için kanıt alıntı (3-5 madde)
  3. İLETİŞİM TARZI: Nasıl yazıyor, soru soruyor (2-3 madde)
  4. TEKNİK SEVİYE: Hangi konularda bilgili (2-3 madde)
  5. DUYGUSAL DURUM: Mutlu, stresli, meraklı mı?

  Her başlık altında sohbetlerden KANIT alıntı yap. Alıntıları tırnak içinde italik yaz.
  Türkçe yaz. Toplam 15-20 cümle.`

  app.get('/admin/users', requireAdmin, async (req, res) => {
    try {
      const usersSnapshot = await firestoreDb.collection('users').get();
      const users = await Promise.all(usersSnapshot.docs.map(async userDoc => {
        const chatsSnapshot = await userDoc.ref.collection('chats').get();
        const chats = chatsSnapshot.docs.map(doc => doc.data());
        const messages = chats.flatMap(chat => (chat.messages || [])
          .filter(message => typeof message.content === 'string' && message.content.length > 5)
          .map(message => ({ role: message.role, content: message.content })));
        return {
          uid: userDoc.id,
          messageCount: messages.length,
          chatCount: chats.length,
          lastActive: chats.reduce((max, chat) => Math.max(max, chat.updatedAt || 0), 0),
          messages,
        };
      }));
      res.json({ users });
    } catch (e) {
      res.status(500).json({ error: 'Kullanıcılar alınamadı: ' + e.message });
    }
  });

  app.post('/profile/analyze', requireAdmin, async (req, res) => {
    try {
      const { targetUserId: userId, messages } = req.body;
      if (!userId || !messages?.length) return res.status(400).json({ error: 'userId ve messages gerekli' });
      if (disabledProviders().has('deepseek')) {
        return res.status(503).json({ error: 'Profil analizi şu anda kullanılamıyor.' });
      }

      const userText = messages.map(m => `[${m.role}]: ${m.content}`).join('\n');

      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: PROFILE_PROMPT },
            { role: 'user', content: userText },
          ],
          max_tokens: 1500,
        }),
      });

      if (!response.ok) throw new Error('DeepSeek hatası');

      const data = await response.json();
      const analysis = data.choices?.[0]?.message?.content || 'Analiz tamamlanamadı.';

      const profile = await memoryStore.saveProfile(firestoreDb, String(userId), {
        analysis,
        messageCount: messages.length,
        analyzedAt: new Date().toISOString(),
      });

      res.json({ success: true, profile });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/profile/:userId', requireAdmin, async (req, res) => {
    try {
      const profile = await memoryStore.getProfile(firestoreDb, req.params.userId);
      if (!profile) return res.status(404).json({ error: 'Profil bulunamadı' });
      res.json({ profile });
    } catch (e) {
      res.status(500).json({ error: 'Profil okunamadı.' });
    }
  });

  app.get('/profiles', requireAdmin, async (req, res) => {
    try {
      res.json({ profiles: await memoryStore.listProfiles(firestoreDb) });
    } catch (e) {
      res.status(500).json({ error: 'Profiller okunamadı.' });
    }
  });
}

module.exports = { registerAdminRoutes };
