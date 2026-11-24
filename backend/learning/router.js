// Otomatik model seçimi ("Otomatik" modeli): kullanıcı geri bildiriminden öğrenir.
//
// Her (kategori, model) çifti için beğen/beğenme sayısı bir Beta dağılımı verir.
// Thompson örneklemesi: her istekte her modelden bir "başarı olasılığı" çekilir,
// pahalı modelden maliyet payı düşülür, en yüksek çıkan seçilir. Az denenmiş model
// arada bir şans bulur (keşif), iyi ve ucuz olan zamanla çoğunluğu alır (kullanım).
// Katalog veya fiyat değişince ek kod gerekmez; yeni model sıfır veriyle başlar.

const SCORE_CACHE_MS = 5 * 60 * 1000;

// Marsaglia-Tsang gamma örnekleyici (shape >= 1). random: [0,1) üreten fonksiyon.
function sampleGamma(shape, random) {
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do {
      // Box-Muller ile standart normal.
      const u1 = Math.max(random(), Number.EPSILON);
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * random());
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.max(random(), Number.EPSILON);
    if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
  }
}

function sampleBeta(a, b, random = Math.random) {
  const x = sampleGamma(a, random);
  const y = sampleGamma(b, random);
  return x / (x + y);
}

function modelCost(pricing, model) {
  const price = pricing?.[model];
  if (!price) return null;
  const value = Number(price.inputPerMTok) + Number(price.outputPerMTok);
  return Number.isFinite(value) ? value : null;
}

// candidates: [{ id, provider, prior?: { up, down } }]
// scores:     [{ model, up, down }]  (aynı kategoriye ait)
function pickModel({ candidates, scores = [], pricing = {}, costWeight = 0.15, random = Math.random }) {
  if (!candidates.length) return null;
  const byModel = new Map(scores.map(score => [score.model, score]));
  const costs = candidates.map(candidate => modelCost(pricing, candidate.id));
  const maxCost = Math.max(0, ...costs.filter(cost => cost !== null));
  let best = null;
  const samples = {};
  candidates.forEach((candidate, index) => {
    const score = byModel.get(candidate.id) || {};
    const prior = candidate.prior || { up: 1, down: 1 };
    const a = Math.max(1, Number(score.up || 0) + prior.up);
    const b = Math.max(1, Number(score.down || 0) + prior.down);
    // Fiyatı bilinmeyen model ne cezalandırılır ne ödüllendirilir: orta maliyet sayılır.
    const normalizedCost = maxCost > 0 ? (costs[index] ?? maxCost / 2) / maxCost : 0;
    const value = sampleBeta(a, b, random) - costWeight * normalizedCost;
    samples[candidate.id] = Number(value.toFixed(4));
    if (!best || value > best.value) best = { candidate, value };
  });
  return { id: best.candidate.id, provider: best.candidate.provider, samples };
}

// Beta ortalaması: gece raporunda "şu an en iyi" modeli göstermek için (örneklemesiz).
function expectedScore({ up = 0, down = 0 }, prior = { up: 1, down: 1 }) {
  const a = up + prior.up;
  const b = down + prior.down;
  return a / (a + b);
}

function createAutoRouter({ feedbackStore, catalog, isAvailable, defaultModelId, env = process.env, now = () => Date.now(), random = Math.random }) {
  const cache = new Map();
  let pricing = {};
  try { pricing = env.MODEL_PRICING_JSON ? JSON.parse(env.MODEL_PRICING_JSON) : {}; } catch { pricing = {}; }
  const costWeight = Number.isFinite(Number(env.AUTO_ROUTER_COST_WEIGHT)) && env.AUTO_ROUTER_COST_WEIGHT !== undefined
    ? Number(env.AUTO_ROUTER_COST_WEIGHT)
    : 0.15;
  // İsteğe bağlı beyaz liste: AUTO_ROUTER_MODELS=gpt-5.6-luna,deepseek-chat
  const allowList = String(env.AUTO_ROUTER_MODELS || '').split(',').map(item => item.trim()).filter(Boolean);

  function candidates() {
    return catalog
      .filter(model => isAvailable(model) && !model.hidden)
      // Düşünen modeller yavaş; otomatik seçim yalnızca hızlı sohbet modelleri arasında yapılır.
      .filter(model => !/reasoner|thinking/i.test(model.id))
      .filter(model => !allowList.length || allowList.includes(model.id))
      // Varsayılan model veri yokken öne çıksın: kullanıcılar ilk günden rastgele modele düşmesin.
      .map(model => ({ id: model.id, provider: model.provider, prior: model.id === defaultModelId ? { up: 4, down: 1 } : { up: 1, down: 1 } }));
  }

  async function scoresFor(category) {
    const cached = cache.get(category);
    if (cached && now() - cached.at < SCORE_CACHE_MS) return cached.scores;
    try {
      const scores = await feedbackStore.listScores(category);
      cache.set(category, { at: now(), scores });
      return scores;
    } catch (error) {
      console.warn('Model skorları okunamadı, önsel değerlerle seçiliyor:', error.message);
      return cached?.scores || [];
    }
  }

  async function choose(category) {
    const list = candidates();
    if (!list.length) return null;
    return pickModel({ candidates: list, scores: await scoresFor(category), pricing, costWeight, random });
  }

  return { choose, candidates, enabled: () => candidates().length >= 2 };
}

module.exports = { createAutoRouter, pickModel, sampleBeta, expectedScore, modelCost };
