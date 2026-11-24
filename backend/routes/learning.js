const crypto = require('node:crypto');
const { cleanText } = require('../learning/feedbackStore');

// Kendini geliştiren döngünün uçları: geri bildirim, kullanıcının yanıt tarzı ayarı,
// yönetici raporu ve gece işi.

function cronAuthorized(req, cronSecret) {
  const expected = Buffer.from(`Bearer ${cronSecret || ''}`);
  const received = Buffer.from(req.headers.authorization || '');
  return Boolean(cronSecret) && expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

// Vercel Cron her gece çağırır (vercel.json > crons); girişten önce kaydedilir.
function registerLearningCronRoute(app, { nightlyJob }, { cronSecret = process.env.CRON_SECRET } = {}) {
  app.get('/cron/self-improve', async (req, res) => {
    if (!cronAuthorized(req, cronSecret)) return res.status(401).json({ error: 'Yetkisiz.' });
    try {
      res.json(await nightlyJob.run());
    } catch (error) {
      console.error('Gece öğrenme işi hatası:', error.message);
      res.status(500).json({ error: 'Gece işi çalışmadı.' });
    }
  });
}

function registerLearningRoutes(app, { feedbackStore, userStyle, requireAdmin, firestoreDb, enforceDailyQuota }) {
  // Oylar herkes için Otomatik model seçimini etkiler; tek hesap sınırsız sahte
  // messageId ile oy basıp seçimi yönlendiremesin diye günlük oy sınırı var.
  const feedbackQuota = enforceDailyQuota ? enforceDailyQuota('feedback') : (req, res, next) => next();
  app.post('/feedback', feedbackQuota, async (req, res) => {
    const type = req.body?.type;
    if (type !== 'up' && type !== 'down' && type !== null) {
      return res.status(400).json({ error: "type 'up', 'down' veya null olmalı." });
    }
    try {
      const result = await feedbackStore.record(req.user.uid, {
        type,
        chatId: req.body.chatId,
        messageId: req.body.messageId,
        provider: req.body.provider,
        model: req.body.model,
        assistantType: req.body.assistantType,
        question: req.body.question,
        answer: req.body.answer,
        reason: req.body.reason,
        note: req.body.note,
        context: req.body.context,
      });
      res.status(202).json({ accepted: true, ...result });
    } catch (error) {
      if (/messageId/.test(error.message)) return res.status(400).json({ error: error.message });
      console.warn('Geri bildirim kaydedilemedi:', error.message);
      res.status(202).json({ accepted: false });
    }
  });

  app.post('/feedback/bug', (req, res, next) => {
    const { text } = req.body || {};
    if (typeof text !== 'string') {
      return res.status(400).json({ error: 'Hata bildirimi 10 ile 4000 karakter arasında olmalı.' });
    }
    const cleaned = cleanText(text, 4001);
    if (cleaned.length < 10 || cleaned.length > 4000) {
      return res.status(400).json({ error: 'Hata bildirimi 10 ile 4000 karakter arasında olmalı.' });
    }
    req.cleanedBugText = cleaned;
    next();
  }, feedbackQuota, async (req, res) => {
    try {
      const { chatId, messageId, context } = req.body;
      const id = await feedbackStore.recordBug(req.user.uid, { text: req.cleanedBugText, chatId, messageId, context });
      res.status(201).json({ id });
    } catch (error) {
      console.warn('Hata bildirimi kaydedilemedi:', error.message);
      res.status(500).json({ error: 'Hata bildirimi kaydedilemedi.' });
    }
  });

  app.get('/admin/feedback/bad', requireAdmin, async (req, res) => {
    try {
      const { day, model, reason, limit } = req.query;
      const feedback = await feedbackStore.listBad({ day, model, reason, limit });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ feedback });
    } catch (error) {
      console.warn('Olumsuz geri bildirimler okunamadı:', error.message);
      res.status(500).json({ error: 'Olumsuz geri bildirimler okunamadı.' });
    }
  });

  app.get('/admin/bugs', requireAdmin, async (req, res) => {
    try {
      const { status, limit } = req.query;
      const bugs = await feedbackStore.listBugs({ status, limit });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ bugs });
    } catch (error) {
      console.warn('Hata bildirimleri okunamadı:', error.message);
      res.status(500).json({ error: 'Hata bildirimleri okunamadı.' });
    }
  });

  app.get('/learning/style', async (req, res) => {
    const style = await userStyle.get(req.user.uid);
    res.json({ enabled: style?.enabled !== false, length: style?.length || null, basedOn: style?.basedOn || 0 });
  });

  app.post('/learning/style', async (req, res) => {
    if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'enabled true/false olmalı.' });
    try {
      const style = await userStyle.setEnabled(req.user.uid, req.body.enabled);
      res.json({ enabled: style.enabled, length: style.length || null, basedOn: style.basedOn || 0 });
    } catch (error) {
      console.warn('Yanıt tarzı ayarı kaydedilemedi:', error.message);
      res.status(500).json({ error: 'Ayar kaydedilemedi.' });
    }
  });

  app.get('/admin/learning/report', requireAdmin, async (req, res) => {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.day || '')) ? req.query.day : new Date().toISOString().slice(0, 10);
    const snapshot = await firestoreDb.collection('improvement_reports').doc(day).get();
    if (!snapshot.exists) return res.status(404).json({ error: `${day} için rapor yok.` });
    res.json(snapshot.data());
  });
}

module.exports = { registerLearningRoutes, registerLearningCronRoute, cronAuthorized };
