const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { fakeFirestore } = require('./fakeFirestore');
const { classifyMessage } = require('../learning/categories');
const { createFeedbackStore } = require('../learning/feedbackStore');
const { pickModel, sampleBeta, createAutoRouter } = require('../learning/router');
const { createUserStyle, learnLength, styleRule } = require('../learning/userStyle');
const { createNightlyJob, buildReport } = require('../learning/nightly');
const { registerLearningRoutes, registerLearningCronRoute } = require('../routes/learning');

// Tekrarlanabilir rastgelelik (mulberry32).
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fixedNow = () => new Date('2026-10-25T03:30:00Z');

test('Mesaj kategorisi Türkçe kelimelerle doğru seçilir', () => {
  assert.equal(classifyMessage('Bu python kodunda hata var mı?'), 'kod');
  assert.equal(classifyMessage('```js\nconst a = 1\n```'), 'kod');
  assert.equal(classifyMessage('Bu denklemin kökleri ne?'), 'matematik');
  assert.equal(classifyMessage('12 * 7 kaç'), 'matematik');
  assert.equal(classifyMessage('Patronuma izin için e-posta yazar mısın'), 'yazi');
  assert.equal(classifyMessage('Elektrikli araçların avantaj ve dezavantajları'), 'arastirma');
  assert.equal(classifyMessage('selam naber'), 'sohbet');
  assert.equal(classifyMessage(''), 'sohbet');
  // "yazılım" içindeki "yaz" kelime olarak sayılmaz.
  assert.equal(classifyMessage('yazılım sektörü nasıl'), 'sohbet');
});

test('Geri bildirim skora yazılır, fikir değişince eski oy düşülür, geri alınınca silinir', async () => {
  const db = fakeFirestore();
  const store = createFeedbackStore({ firestoreDb: db, now: fixedNow });
  const base = { chatId: 'c1', messageId: 'm1', provider: 'openai', model: 'gpt-5.6-luna', question: 'python kodum çalışmıyor', answer: 'Şunu dene...' };

  assert.deepEqual(await store.record('u1', { ...base, type: 'down' }), { type: 'down', category: 'kod' });
  let [score] = await store.listScores('kod');
  assert.deepEqual([score.up, score.down], [0, 1]);

  await store.record('u1', { ...base, type: 'up' });
  [score] = await store.listScores('kod');
  assert.deepEqual([score.up, score.down], [1, 0]);
  const saved = db.docs.get('feedback/u1_c1_m1');
  assert.equal(saved.type, 'up');
  assert.equal(saved.day, '2026-10-25');
  assert.equal(saved.uid, 'u1');

  await store.record('u1', { ...base, type: null });
  [score] = await store.listScores('kod');
  assert.deepEqual([score.up, score.down], [0, 0]);
  assert.equal(db.docs.has('feedback/u1_c1_m1'), false);
});

test('Model bilinmeyen geri bildirim skora yazılmaz ama kaydedilir', async () => {
  const db = fakeFirestore();
  const store = createFeedbackStore({ firestoreDb: db, now: fixedNow });
  await store.record('u1', { chatId: 'c', messageId: 'm', type: 'down', question: 'selam' });
  assert.equal((await store.listScores()).length, 0);
  assert.equal(db.docs.get('feedback/u1_c_m').type, 'down');
});

test('Beta örneklemesi 0-1 arasında ve ortalaması doğru', () => {
  const random = seeded(1);
  let total = 0;
  for (let i = 0; i < 4000; i++) {
    const value = sampleBeta(8, 2, random);
    assert.ok(value > 0 && value < 1);
    total += value;
  }
  assert.ok(Math.abs(total / 4000 - 0.8) < 0.02);
});

test('Yönlendirici beğenilen modeli çoğunlukla seçer ama diğerini de dener', () => {
  const random = seeded(7);
  const candidates = [{ id: 'iyi', provider: 'p' }, { id: 'kotu', provider: 'p' }];
  const scores = [{ model: 'iyi', up: 40, down: 5 }, { model: 'kotu', up: 5, down: 15 }];
  const counts = { iyi: 0, kotu: 0 };
  for (let i = 0; i < 500; i++) counts[pickModel({ candidates, scores, random }).id] += 1;
  assert.ok(counts.iyi > 470, `iyi=${counts.iyi}`);

  // Veri yokken ikisi de seçilebilir (keşif).
  const fresh = { iyi: 0, kotu: 0 };
  for (let i = 0; i < 500; i++) fresh[pickModel({ candidates, scores: [], random }).id] += 1;
  assert.ok(fresh.iyi > 150 && fresh.kotu > 150, JSON.stringify(fresh));
});

test('Kalite eşitken ucuz model tercih edilir', () => {
  const random = seeded(3);
  const candidates = [{ id: 'pahali', provider: 'p' }, { id: 'ucuz', provider: 'p' }];
  const scores = [{ model: 'pahali', up: 50, down: 10 }, { model: 'ucuz', up: 50, down: 10 }];
  const pricing = { pahali: { inputPerMTok: 10, outputPerMTok: 30 }, ucuz: { inputPerMTok: 0.5, outputPerMTok: 1 } };
  const counts = { pahali: 0, ucuz: 0 };
  for (let i = 0; i < 400; i++) counts[pickModel({ candidates, scores, pricing, costWeight: 0.15, random }).id] += 1;
  assert.ok(counts.ucuz > 350, JSON.stringify(counts));
});

test('Otomatik yönlendirici kapalı/düşünen modelleri aday yapmaz, varsayılanı önde başlatır', async () => {
  const router = createAutoRouter({
    feedbackStore: { listScores: async () => [] },
    catalog: [
      { id: 'a', provider: 'open' },
      { id: 'deepseek-reasoner', provider: 'open' },
      { id: 'b', provider: 'closed' },
      { id: 'c', provider: 'open' },
    ],
    isAvailable: model => model.provider === 'open',
    defaultModelId: 'a',
    env: {},
    random: seeded(5),
  });
  assert.deepEqual(router.candidates().map(c => c.id), ['a', 'c']);
  assert.equal(router.enabled(), true);
  const counts = { a: 0, c: 0 };
  for (let i = 0; i < 300; i++) counts[(await router.choose('sohbet')).id] += 1;
  assert.ok(counts.a > counts.c, JSON.stringify(counts));
});

test('Yanıt uzunluğu tercihi geri bildirimden öğrenilir', () => {
  const long = 2000;
  const short = 300;
  assert.equal(learnLength([{ type: 'down', answerLength: long }, { type: 'down', answerLength: long }, { type: 'up', answerLength: short }, { type: 'up', answerLength: short }]), 'kisa');
  assert.equal(learnLength([{ type: 'up', answerLength: long }, { type: 'up', answerLength: long }, { type: 'down', answerLength: short }, { type: 'down', answerLength: short }]), 'detayli');
  assert.equal(learnLength([{ type: 'down', answerLength: long }, { type: 'up', answerLength: short }]), null);
  assert.match(styleRule({ length: 'kisa' }), /kısa/);
  assert.equal(styleRule({ length: 'kisa', enabled: false }), '');
});

test('Gece işi test vakası, yanıt tarzı ve rapor üretir; kapatan kullanıcıya dokunmaz', async () => {
  const db = fakeFirestore();
  const store = createFeedbackStore({ firestoreDb: db, now: fixedNow });
  const userStyle = createUserStyle({ firestoreDb: db, now: () => fixedNow().getTime() });
  const long = 'x'.repeat(2000);
  const short = 'y'.repeat(200);
  for (let i = 0; i < 3; i++) {
    await store.record('u1', { chatId: 'c', messageId: `d${i}`, type: 'down', provider: 'p', model: 'm1', question: `selam ${i}`, answer: long });
    await store.record('u1', { chatId: 'c', messageId: `u${i}`, type: 'up', provider: 'p', model: 'm2', question: `merhaba ${i}`, answer: short });
  }
  await store.record('u2', { chatId: 'c', messageId: 'x', type: 'down', provider: 'p', model: 'm1', question: 'naber', answer: long });
  await userStyle.setEnabled('u2', false);

  const job = createNightlyJob({ firestoreDb: db, userStyle, now: fixedNow });
  const result = await job.run();
  assert.equal(result.newEvalCases, 4);
  assert.equal(result.stylesUpdated, 2);
  assert.equal((await userStyle.get('u1')).length, 'kisa');
  assert.equal((await userStyle.get('u2')).enabled, false);

  const report = db.docs.get('improvement_reports/2026-10-25');
  assert.equal(report.totalVotes, 7);
  assert.equal(report.categories.sohbet.ranking[0].model, 'm2');
  assert.equal(JSON.stringify(report).includes('u1'), false, 'raporda uid olmamalı');

  // İkinci çalıştırmada aynı vakalar tekrar eklenmez.
  assert.equal((await job.run()).newEvalCases, 0);
});

test('Rapor yüksek beğenilmeme oranında uyarı verir', () => {
  const window = Array.from({ length: 6 }, (_, i) => ({ category: 'kod', type: i < 4 ? 'down' : 'up' }));
  const report = buildReport({ day: '2026-10-25', scores: [], window, newEvalCases: 4 });
  assert.equal(report.alerts.length, 1);
  assert.match(report.alerts[0], /^kod:/);
});

function learningApp(db, { admin = false } = {}) {
  const app = express();
  app.use(express.json());
  registerLearningCronRoute(app, { nightlyJob: createNightlyJob({ firestoreDb: db, userStyle: createUserStyle({ firestoreDb: db }), now: fixedNow }) }, { cronSecret: 'gizli' });
  app.use((req, res, next) => { req.user = { uid: 'u1', admin }; next(); });
  registerLearningRoutes(app, {
    feedbackStore: createFeedbackStore({ firestoreDb: db, now: fixedNow }),
    userStyle: createUserStyle({ firestoreDb: db }),
    requireAdmin: (req, res, next) => (req.user.admin ? next() : res.status(403).end()),
    firestoreDb: db,
  });
  return app;
}

test('POST /feedback doğrular ve kimlikten gelen uid ile kaydeder', async () => {
  const db = fakeFirestore();
  const app = learningApp(db);
  assert.equal((await request(app).post('/feedback').send({ type: 'meh', messageId: 'm' })).status, 400);
  assert.equal((await request(app).post('/feedback').send({ type: 'up' })).status, 400);
  const ok = await request(app).post('/feedback').send({ type: 'up', chatId: 'c', messageId: 'm', model: 'gpt-5.6-luna', provider: 'openai', question: 'selam', uid: 'baskasi' });
  assert.equal(ok.status, 202);
  assert.equal(db.docs.get('feedback/u1_c_m').uid, 'u1');
});

test('POST /feedback günlük oy sınırına takılır (oy doldurma ile Otomatik seçim yönlendirilemez)', async () => {
  const db = fakeFirestore();
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { uid: 'u1' }; next(); });
  let used = 0;
  const enforceDailyQuota = kind => (req, res, next) => {
    assert.equal(kind, 'feedback');
    used += 1;
    return used > 2 ? res.status(429).json({ code: 'daily_limit' }) : next();
  };
  registerLearningRoutes(app, {
    feedbackStore: createFeedbackStore({ firestoreDb: db, now: fixedNow }),
    userStyle: createUserStyle({ firestoreDb: db }),
    requireAdmin: (req, res, next) => next(),
    firestoreDb: db,
    enforceDailyQuota,
  });
  const vote = id => request(app).post('/feedback').send({ type: 'up', chatId: 'c', messageId: id, model: 'gpt-5.6-luna', provider: 'openai', question: 'selam' });
  assert.equal((await vote('m1')).status, 202);
  assert.equal((await vote('m2')).status, 202);
  assert.equal((await vote('m3')).status, 429);
  assert.equal(db.docs.has('feedback/u1_c_m3'), false);
});

test('Yanıt tarzı kapatılabilir; cron gizli anahtarsız çalışmaz; rapor yöneticiye açık', async () => {
  const db = fakeFirestore();
  const app = learningApp(db, { admin: true });
  assert.deepEqual((await request(app).post('/learning/style').send({ enabled: false })).body, { enabled: false, length: null, basedOn: 0 });
  assert.equal((await request(app).get('/learning/style')).body.enabled, false);

  assert.equal((await request(app).get('/cron/self-improve')).status, 401);
  assert.equal((await request(app).get('/cron/self-improve').set('Authorization', 'Bearer gizli')).status, 200);
  const report = await request(app).get('/admin/learning/report?day=2026-10-25');
  assert.equal(report.status, 200);
  assert.equal(report.body.day, '2026-10-25');
  assert.equal((await request(learningApp(db)).get('/admin/learning/report')).status, 403);
});

const { runPromptEval, parseVerdict, stripFrontmatter } = require('../learning/promptEval');

test('Prompt denemesi hakemi kör değerlendirir ve küçük örneklemde değişiklik önermez', async () => {
  assert.equal(stripFrontmatter('---\nname: x\n---\nGövde'), 'Gövde');
  assert.equal(parseVerdict('Sonuç: {"winner":"B","reason":"daha net"}').winner, 'B');
  assert.equal(parseVerdict('bozuk').winner, 'tie');

  // Hakem her zaman "ADAY" yazan cevabı seçer: sıralama karışık olsa da aday kazanmalı.
  const complete = async ({ system, user }) => {
    if (system === 'ADAY_PROMPT') return 'ADAY cevabı';
    if (system === 'MEVCUT_PROMPT') return 'mevcut cevap';
    const a = user.split('CEVAP A:\n')[1].split('\n\nCEVAP B:')[0];
    return JSON.stringify({ winner: a.startsWith('ADAY') ? 'A' : 'B', reason: 'aday daha iyi' });
  };
  const cases = Array.from({ length: 12 }, (_, i) => ({ id: `e${i}`, category: 'kod', question: `soru ${i}` }));
  const summary = await runPromptEval({ cases, currentPrompt: 'MEVCUT_PROMPT', candidatePrompt: 'ADAY_PROMPT', complete, model: 'm', random: seeded(9) });
  assert.equal(summary.tally.aday, 12);
  assert.equal(summary.recommend, true);

  const small = await runPromptEval({ cases: cases.slice(0, 3), currentPrompt: 'MEVCUT_PROMPT', candidatePrompt: 'ADAY_PROMPT', complete, model: 'm', random: seeded(9) });
  assert.equal(small.recommend, false);
});

test('"auto" model adıyla gelen geri bildirim skora yazılmaz', async () => {
  const db = fakeFirestore();
  const store = createFeedbackStore({ firestoreDb: db, now: fixedNow });
  await store.record('u1', { chatId: 'c', messageId: 'm', type: 'up', provider: 'auto', model: 'auto', question: 'selam' });
  assert.equal((await store.listScores()).length, 0);
});
