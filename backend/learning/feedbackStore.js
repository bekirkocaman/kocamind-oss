// Beğen/beğenme geri bildirimi: kendini geliştiren döngünün tek sinyal kaynağı.
//
// feedback/{uid}_{chatId}_{messageId}
//   { uid, chatId, messageId, type: 'up'|'down', provider, model, category,
//     assistantType, question, answer, answerLength, day: 'YYYY-MM-DD', createdAt, updatedAt }
//   İsteğe bağlı context ve olumsuz oylar için reason, note.
// bug_reports/{id}
//   { uid, text, chatId, messageId, context, day, createdAt, status }
// model_scores/{category}_{model}
//   { category, provider, model, up, down, updatedAt }
//
// Aynı mesaja ikinci tıklama yeni kayıt açmaz: belge kimliği mesajdan türetilir,
// fikir değişirse eski oy skordan düşülür, oy geri alınırsa (type: null) kayıt silinir.
// Kullanıcı verisi olduğu için hesap silmede `feedback` koleksiyonu uid ile temizlenir.

const { classifyMessage } = require('./categories');

const MAX_QUESTION = 1000;
const MAX_ANSWER = 2000;
const MAX_LIST_READ = 1000;
const FEEDBACK_REASONS = new Set(['wrong', 'incomplete', 'cut_off', 'language', 'unsafe', 'slow', 'other']);
const PLATFORMS = new Set(['web', 'android', 'ide']);

function cleanId(value, max = 120) {
  return String(value ?? '').replace(/[/\s]/g, '-').replace(/[^\w.:-]/g, '').slice(0, max);
}

function scoreDocId(category, model) {
  return `${category}_${cleanId(model, 200)}`;
}

function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\x00-\x1f\x7f-\x9f]/g, '').trim().slice(0, max);
}

function normalizeContext(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const context = {};
  const { platform, latencyMs, deepThink, tools } = input;
  if (PLATFORMS.has(platform)) context.platform = platform;
  const appVersion = cleanText(input.appVersion, 40);
  const finishReason = cleanText(input.finishReason, 40);
  if (appVersion) context.appVersion = appVersion;
  if (finishReason) context.finishReason = finishReason;
  if (typeof latencyMs === 'number' && latencyMs >= 0 && latencyMs <= 600000) context.latencyMs = latencyMs;
  if (typeof deepThink === 'boolean') context.deepThink = deepThink;
  if (Array.isArray(tools)) {
    context.tools = tools.map(tool => cleanText(tool, 60)).filter(Boolean).slice(0, 10);
  }
  return Object.keys(context).length > 0 ? context : undefined;
}

function normalizeFeedback(input) {
  const type = input.type === 'up' || input.type === 'down' ? input.type : null;
  const chatId = cleanId(input.chatId) || 'temp';
  const messageId = cleanId(input.messageId);
  if (!messageId) throw new Error('messageId gerekli.');
  const question = String(input.question || '').slice(0, MAX_QUESTION);
  const answer = String(input.answer || '').slice(0, MAX_ANSWER);
  const context = normalizeContext(input.context);
  const note = type === 'down' ? cleanText(input.note, 500) : '';
  return {
    type,
    chatId,
    messageId,
    provider: cleanId(input.provider, 40) || null,
    // "auto" gerçek bir model değil; cevabı veren model bilinmiyorsa skora yazılmaz.
    model: input.model === 'auto' ? null : cleanId(input.model, 120) || null,
    assistantType: cleanId(input.assistantType, 40) || null,
    question,
    answer,
    answerLength: String(input.answer || '').length,
    category: classifyMessage(question),
    ...(context && { context }),
    ...(type === 'down' && FEEDBACK_REASONS.has(input.reason) && { reason: input.reason }),
    ...(note && { note }),
  };
}

function listLimit(value) {
  const limit = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(limit) && limit >= 1 ? Math.min(200, Math.floor(limit)) : 50;
}

function createFeedbackStore({ firestoreDb, now = () => new Date() }) {
  async function record(uid, input) {
    const entry = normalizeFeedback(input);
    const ref = firestoreDb.collection('feedback').doc(`${cleanId(uid)}_${entry.chatId}_${entry.messageId}`);
    const timestamp = now().toISOString();

    await firestoreDb.runTransaction(async transaction => {
      const existingSnap = await transaction.get(ref);
      const existing = existingSnap.exists ? existingSnap.data() : null;
      // Skor değişiklikleri: eski oyu geri al, yenisini ekle. Model bilinmiyorsa skora yazılmaz.
      const deltas = new Map();
      const bump = (category, provider, model, field, by) => {
        if (!model) return;
        const id = scoreDocId(category, model);
        const delta = deltas.get(id) || { category, provider, model, up: 0, down: 0 };
        delta[field] += by;
        deltas.set(id, delta);
      };
      if (existing?.type) bump(existing.category, existing.provider, existing.model, existing.type, -1);
      if (entry.type) bump(entry.category, entry.provider, entry.model, entry.type, 1);

      // Firestore işlemlerinde bütün okumalar yazmalardan önce yapılmalı.
      const scoreRefs = [...deltas.keys()].map(id => firestoreDb.collection('model_scores').doc(id));
      const scoreSnaps = await Promise.all(scoreRefs.map(scoreRef => transaction.get(scoreRef)));

      scoreRefs.forEach((scoreRef, index) => {
        const delta = deltas.get(scoreRef.id);
        if (!delta.up && !delta.down) return;
        const current = scoreSnaps[index].exists ? scoreSnaps[index].data() : {};
        transaction.set(scoreRef, {
          category: delta.category,
          provider: delta.provider || current.provider || null,
          model: delta.model,
          up: Math.max(0, Number(current.up || 0) + delta.up),
          down: Math.max(0, Number(current.down || 0) + delta.down),
          updatedAt: timestamp,
        });
      });

      if (!entry.type) {
        if (existing) transaction.delete(ref);
        return;
      }
      transaction.set(ref, {
        uid,
        ...entry,
        day: timestamp.slice(0, 10),
        createdAt: existing?.createdAt || timestamp,
        updatedAt: timestamp,
      });
    });
    return { type: entry.type, category: entry.category };
  }

  async function listScores(category) {
    let query = firestoreDb.collection('model_scores');
    if (category) query = query.where('category', '==', category);
    const snapshot = await query.get();
    return snapshot.docs.map(doc => doc.data());
  }

  async function listBad({ day, model, reason, limit } = {}) {
    const selectedDay = typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : now().toISOString().slice(0, 10);
    // Birleşik indeks gerekmemesi için Firestore yalnızca günü sorgular.
    // Oy türü, model, neden ve sıralama bellek içinde uygulanır.
    const snapshot = await firestoreDb.collection('feedback').where('day', '==', selectedDay).limit(MAX_LIST_READ).get();
    return snapshot.docs
      .map(doc => doc.data())
      .filter(entry => entry.type === 'down' && (!model || entry.model === model) && (!reason || entry.reason === reason))
      .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
      .slice(0, listLimit(limit))
      .map(({ uid, ...entry }) => entry);
  }

  async function recordBug(uid, { text, chatId, messageId, context }) {
    const ref = firestoreDb.collection('bug_reports').doc();
    const createdAt = now().toISOString();
    await ref.set({
      uid,
      text: cleanText(text, 4000),
      chatId: typeof chatId === 'string' ? cleanId(chatId) || null : null,
      messageId: typeof messageId === 'string' ? cleanId(messageId) || null : null,
      context: normalizeContext(context) ?? null,
      day: createdAt.slice(0, 10),
      createdAt,
      status: 'open',
    });
    return ref.id;
  }

  async function listBugs({ status, limit } = {}) {
    let query = firestoreDb.collection('bug_reports');
    if (typeof status === 'string' && status) query = query.where('status', '==', status);
    const snapshot = await query.limit(MAX_LIST_READ).get();
    return snapshot.docs
      .map(doc => {
        const { uid, ...report } = doc.data();
        return { ...report, id: doc.id };
      })
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .slice(0, listLimit(limit));
  }

  return { record, listScores, listBad, recordBug, listBugs };
}

module.exports = { createFeedbackStore, normalizeFeedback, scoreDocId, cleanText };
