// Prompt denemesi: mevcut sistem talimatı ile aday talimatı, beğenilmeyen cevaplardan
// toplanan test seti (eval_cases) üzerinde karşılaştırır. Hakem model iki cevabı
// kör olarak (hangisinin aday olduğunu bilmeden, sırası rastgele) değerlendirir.
//
// Sonuç yalnızca bir rapordur: aday kazanırsa SKILL.md değişikliği elle PR olarak açılır.
// Komut satırı: scripts/promptEval.js

const JUDGE_PROMPT = `Sen tarafsız bir değerlendiricisin. Bir Türkçe yapay zekâ asistanına sorulan soruyu ve iki cevabı göreceksin.
Doğruluk, kullanıcının işini görme, açıklık ve gereksiz uzunluktan kaçınma ölçütlerine göre hangisinin daha iyi olduğuna karar ver.
Cevapların sırası rastgeledir; sıraya göre karar verme.
Yalnızca şu JSON ile cevap ver: {"winner":"A"|"B"|"tie","reason":"tek cümle"}`;

function stripFrontmatter(text) {
  return String(text || '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
}

function parseVerdict(text) {
  const match = String(text || '').match(/\{[\s\S]*\}/);
  if (!match) return { winner: 'tie', reason: 'Hakem cevabı okunamadı.' };
  try {
    const parsed = JSON.parse(match[0]);
    const winner = ['A', 'B', 'tie'].includes(parsed.winner) ? parsed.winner : 'tie';
    return { winner, reason: String(parsed.reason || '').slice(0, 300) };
  } catch {
    return { winner: 'tie', reason: 'Hakem cevabı okunamadı.' };
  }
}

// complete({ model, system, user }) → Promise<string>
async function runPromptEval({ cases, currentPrompt, candidatePrompt, complete, model, judgeModel = model, random = Math.random, onProgress = () => {} }) {
  const results = [];
  for (const [index, evalCase] of cases.entries()) {
    const [current, candidate] = await Promise.all([
      complete({ model, system: currentPrompt, user: evalCase.question }),
      complete({ model, system: candidatePrompt, user: evalCase.question }),
    ]);
    // Konum yanlılığını azaltmak için aday rastgele A ya da B olur.
    const candidateIsA = random() < 0.5;
    const [answerA, answerB] = candidateIsA ? [candidate, current] : [current, candidate];
    const verdict = parseVerdict(await complete({
      model: judgeModel,
      system: JUDGE_PROMPT,
      user: `SORU:\n${evalCase.question}\n\nCEVAP A:\n${answerA}\n\nCEVAP B:\n${answerB}`,
    }));
    const outcome = verdict.winner === 'tie' ? 'berabere' : (verdict.winner === 'A') === candidateIsA ? 'aday' : 'mevcut';
    results.push({ id: evalCase.id, category: evalCase.category, question: evalCase.question, outcome, reason: verdict.reason });
    onProgress(index + 1, cases.length, outcome);
  }
  return summarize(results);
}

function summarize(results) {
  const tally = { aday: 0, mevcut: 0, berabere: 0 };
  for (const result of results) tally[result.outcome] += 1;
  const decided = tally.aday + tally.mevcut;
  const candidateWinRate = decided ? tally.aday / decided : 0;
  // Küçük örneklemde gürültüyle karar verilmesin: en az 10 kararlı karşılaştırma ve %60 üstü.
  const recommend = decided >= 10 && candidateWinRate >= 0.6;
  return { results, tally, candidateWinRate, recommend };
}

function toMarkdown({ skill, variantPath, model, judgeModel, summary, day }) {
  const { tally, candidateWinRate, recommend, results } = summary;
  const lines = [
    `# Prompt denemesi: ${skill}`,
    '',
    `- Tarih: ${day}`,
    `- Aday dosya: \`${variantPath}\``,
    `- Cevap modeli: ${model} · Hakem: ${judgeModel}`,
    `- Sonuç: aday ${tally.aday} · mevcut ${tally.mevcut} · berabere ${tally.berabere}`,
    `- Aday kazanma oranı (beraberlik hariç): %${Math.round(candidateWinRate * 100)}`,
    '',
    recommend
      ? '**Öneri:** Aday daha iyi görünüyor. SKILL.md değişikliğini PR olarak aç ve birkaç cevabı elle kontrol et.'
      : '**Öneri:** Değiştirme. Aday yeterince fark yaratmadı ya da örneklem küçük (en az 10 kararlı karşılaştırma ve %60 gerekir).',
    '',
    '## Vakalar',
    '',
    '| # | Kategori | Kazanan | Hakem gerekçesi |',
    '|---|---|---|---|',
    ...results.map((result, index) => `| ${index + 1} | ${result.category} | ${result.outcome} | ${result.reason.replace(/\|/g, '/')} |`),
  ];
  return lines.join('\n');
}

module.exports = { runPromptEval, parseVerdict, stripFrontmatter, summarize, toMarkdown, JUDGE_PROMPT };
