#!/usr/bin/env node
// Prompt denemesi: bir skill'in mevcut talimatını aday talimatla eval_cases üzerinde karşılaştırır.
//
//   node scripts/promptEval.js --skill genel-asistan --variant aday.md [--limit 20] [--category kod]
//
// Ortam: FIREBASE_SERVICE_ACCOUNT (ya da ADC), cevap ve hakem için OpenAI uyumlu servis:
//   EVAL_BASE_URL   (varsayılan DeepSeek chat completions)
//   EVAL_API_KEY_ENV (anahtarın bulunduğu değişkenin adı, varsayılan DEEPSEEK_API_KEY)
//   EVAL_MODEL, EVAL_JUDGE_MODEL (varsayılan deepseek-chat)
// Rapor scripts/out/ altına yazılır; kullanıcı sorularını içermez. Hiçbir şeyi canlıya almaz.
// Bu script para harcar (vaka başına 3 model çağrısı); --limit ile sınırla.

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const fetch = require('node-fetch');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { runPromptEval, stripFrontmatter, toMarkdown } = require('../learning/promptEval');
const { disabledProviders, isDisabledEndpoint } = require('../learning/providerAvailability');

function args() {
  const result = { limit: 20 };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    result[key] = argv[i + 1];
  }
  result.limit = Math.max(1, Math.min(200, Number(result.limit) || 20));
  return result;
}

function firestore() {
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    initializeApp(raw ? { credential: cert(JSON.parse(raw)) } : { projectId: process.env.FIREBASE_PROJECT_ID || 'kocamind' });
  }
  return getFirestore();
}

async function main() {
  const options = args();
  if (!options.skill || !options.variant) {
    console.error('Kullanım: node scripts/promptEval.js --skill <ad> --variant <dosya.md> [--limit 20] [--category kod]');
    process.exit(1);
  }
  const baseUrl = process.env.EVAL_BASE_URL || 'https://api.deepseek.com/v1/chat/completions';
  const envKey = process.env.EVAL_API_KEY_ENV || 'DEEPSEEK_API_KEY';
  if (isDisabledEndpoint(disabledProviders(), { url: baseUrl, envKey })) {
    console.log('Prompt değerlendirmesi atlandı: model sağlayıcısı kapalı.');
    return;
  }
  const skillPath = path.join(__dirname, '..', 'skills', options.skill, 'SKILL.md');
  if (!fs.existsSync(skillPath)) throw new Error(`Skill bulunamadı: ${skillPath}`);
  const currentPrompt = stripFrontmatter(fs.readFileSync(skillPath, 'utf8'));
  const candidatePrompt = stripFrontmatter(fs.readFileSync(options.variant, 'utf8'));

  const apiKey = process.env[envKey];
  if (!apiKey) throw new Error('Değerlendirme modeli için API anahtarı tanımlı değil.');
  const model = process.env.EVAL_MODEL || 'deepseek-chat';
  const judgeModel = process.env.EVAL_JUDGE_MODEL || model;

  let query = firestore().collection('eval_cases');
  if (options.category) query = query.where('category', '==', options.category);
  const snapshot = await query.limit(options.limit).get();
  const cases = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(item => item.question);
  if (!cases.length) {
    console.log('Test setinde vaka yok. Gece işi beğenilmeyen cevaplardan vaka biriktirdikçe dolacak.');
    return;
  }

  const complete = async ({ model: useModel, system, user }) => {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: useModel, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.3 }),
    });
    if (!response.ok) throw new Error(`Model hatası: ${response.status}`);
    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  };

  console.log(`${cases.length} vaka deneniyor (${model}, hakem ${judgeModel})...`);
  const summary = await runPromptEval({
    cases, currentPrompt, candidatePrompt, complete, model, judgeModel,
    onProgress: (done, total, outcome) => console.log(`  ${done}/${total}: ${outcome}`),
  });
  const day = new Date().toISOString().slice(0, 10);
  const outDir = path.join(__dirname, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `prompt-eval-${options.skill}-${day}.md`);
  fs.writeFileSync(outFile, toMarkdown({ skill: options.skill, variantPath: options.variant, model, judgeModel, summary, day }));
  console.log(`\nAday ${summary.tally.aday} · mevcut ${summary.tally.mevcut} · berabere ${summary.tally.berabere}`);
  console.log(summary.recommend ? 'Öneri: aday daha iyi, PR aç.' : 'Öneri: değiştirme.');
  console.log(`Rapor: ${outFile}`);
}

main().catch(error => {
  console.error('Prompt denemesi çalışmadı:', error.message);
  process.exit(1);
});
