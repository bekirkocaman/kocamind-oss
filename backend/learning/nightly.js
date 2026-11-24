// Gece döngüsü: topla → ölç → öner. Hiçbir şeyi kendiliğinden canlıya almaz.
//
// 1. Son günün beğenilmeyen cevapları `eval_cases` test setine eklenir.
//    Bu set scripts/promptEval.js ile prompt/skill değişikliklerini denemek için kullanılır.
// 2. Geri bildirim veren kullanıcıların yanıt tarzı yeniden hesaplanır (userStyle).
// 3. `improvement_reports/{gün}` raporu yazılır: kategori başına model sıralaması,
//    sorunlu kategoriler, yeni test vakası sayısı. Yönetici /admin/learning/report ile okur.
//
// Bu iş model çağırmaz, para harcamaz. Prompt denemesi bilerek elle çalıştırılan ayrı bir script.
//
// eval_cases/{hash}
//   { uid, question, badAnswer, provider, model, category, assistantType, day, source: 'feedback', status: 'yeni' }
// uid yalnızca hesap silmede temizlenebilsin diye tutulur; raporlara yazılmaz.

const crypto = require('node:crypto');
const { CATEGORIES } = require('./categories');
const { expectedScore } = require('./router');

const DOWN_RATE_ALERT = 0.4;
const MIN_VOTES_FOR_ALERT = 5;
const MAX_FEEDBACK_PER_USER = 60;

function dayString(date) {
  return date.toISOString().slice(0, 10);
}

function evalCaseId(entry) {
  return crypto.createHash('sha256').update(`${entry.model}\n${entry.question}`).digest('hex').slice(0, 32);
}

// scores: model_scores belgeleri; window: bu dönemin feedback kayıtları.
function buildReport({ day, scores, window, newEvalCases }) {
  const categories = {};
  for (const category of CATEGORIES) {
    const ranking = scores
      .filter(score => score.category === category)
      .map(score => ({
        model: score.model,
        provider: score.provider,
        up: Number(score.up || 0),
        down: Number(score.down || 0),
        expected: Number(expectedScore({ up: Number(score.up || 0), down: Number(score.down || 0) }).toFixed(3)),
      }))
      .sort((a, b) => b.expected - a.expected);
    const recent = window.filter(entry => entry.category === category);
    const recentDown = recent.filter(entry => entry.type === 'down').length;
    categories[category] = {
      ranking,
      recentVotes: recent.length,
      recentDownRate: recent.length ? Number((recentDown / recent.length).toFixed(3)) : 0,
    };
  }
  const alerts = Object.entries(categories)
    .filter(([, value]) => value.recentVotes >= MIN_VOTES_FOR_ALERT && value.recentDownRate >= DOWN_RATE_ALERT)
    .map(([category, value]) => `${category}: son dönemde cevapların %${Math.round(value.recentDownRate * 100)}'i beğenilmedi (${value.recentVotes} oy). Bu kategorinin eval vakalarıyla prompt denemesi yap.`);
  return {
    day,
    totalVotes: window.length,
    newEvalCases,
    categories,
    alerts,
  };
}

function createNightlyJob({ firestoreDb, userStyle, now = () => new Date() }) {
  async function run() {
    const today = now();
    const since = dayString(new Date(today.getTime() - 86400000));
    const windowSnap = await firestoreDb.collection('feedback').where('day', '>=', since).get();
    const window = windowSnap.docs.map(doc => doc.data()).filter(entry => entry && entry.type);

    // 1. Beğenilmeyenlerden test seti. Aynı soru-model ikilisi bir kez eklenir.
    let newEvalCases = 0;
    for (const entry of window.filter(item => item.type === 'down' && item.question)) {
      const ref = firestoreDb.collection('eval_cases').doc(evalCaseId(entry));
      const existing = await ref.get();
      if (existing.exists) continue;
      await ref.set({
        uid: entry.uid,
        question: entry.question,
        badAnswer: entry.answer || '',
        provider: entry.provider || null,
        model: entry.model || null,
        category: entry.category || 'sohbet',
        assistantType: entry.assistantType || null,
        day: entry.day,
        source: 'feedback',
        status: 'yeni',
      });
      newEvalCases += 1;
    }

    // 2. Yanıt tarzı: yalnızca bu dönemde oy veren kullanıcılar yeniden hesaplanır.
    let stylesUpdated = 0;
    if (userStyle) {
      const uids = [...new Set(window.map(entry => entry.uid).filter(Boolean))];
      for (const uid of uids) {
        try {
          const snap = await firestoreDb.collection('feedback').where('uid', '==', uid).get();
          const entries = snap.docs.map(doc => doc.data())
            .filter(entry => entry && entry.type)
            .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
            .slice(0, MAX_FEEDBACK_PER_USER);
          await userStyle.relearn(uid, entries);
          stylesUpdated += 1;
        } catch (error) {
          console.warn('Yanıt tarzı güncellenemedi:', error.message);
        }
      }
    }

    // 3. Rapor.
    const scoresSnap = await firestoreDb.collection('model_scores').get();
    const report = buildReport({
      day: dayString(today),
      scores: scoresSnap.docs.map(doc => doc.data()),
      window,
      newEvalCases,
    });
    report.stylesUpdated = stylesUpdated;
    report.createdAt = today.toISOString();
    await firestoreDb.collection('improvement_reports').doc(report.day).set(report);
    return { day: report.day, totalVotes: report.totalVotes, newEvalCases, stylesUpdated, alerts: report.alerts.length };
  }

  return { run };
}

module.exports = { createNightlyJob, buildReport, evalCaseId };
