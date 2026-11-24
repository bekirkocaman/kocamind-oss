// Model çağrısı gözlemleme: gecikme, hata oranı, token ve tahmini maliyet.
// Günlük toplamlar `model_metrics/{gün}_{sağlayıcı}_{model}` belgesinde,
// kullanıcı başına token/maliyet `usage_daily/{uid}_{gün}` belgesinde tutulur.
//
// Fiyatlar koda gömülmez; `MODEL_PRICING_JSON` ortam değişkeniyle verilir:
//   {"gpt-5.6-luna": {"inputPerMTok": 0.5, "outputPerMTok": 2}}
// Tanımsız modelde maliyet alanı güncellenmez (yanlış maliyet göstermektense boş kalır).

function parsePricing(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    console.warn('MODEL_PRICING_JSON okunamadı; maliyet tahmini kapalı.');
    return {};
  }
}

function estimateCostUsd(pricing, model, inputTokens, outputTokens) {
  const price = pricing[model];
  if (!price) return null;
  const input = Number(price.inputPerMTok);
  const output = Number(price.outputPerMTok);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  return (inputTokens * input + outputTokens * output) / 1_000_000;
}

// OpenAI Responses (input/output_tokens) ve Chat Completions (prompt/completion_tokens) biçimlerini birleştirir.
function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return { inputTokens: 0, outputTokens: 0 };
  return {
    inputTokens: Number(usage.input_tokens ?? usage.prompt_tokens ?? 0) || 0,
    outputTokens: Number(usage.output_tokens ?? usage.completion_tokens ?? 0) || 0,
  };
}

function metricDocId(day, provider, model) {
  return `${day}_${provider}_${model}`.replace(/[/\s]/g, '-').slice(0, 300);
}

function createMetrics({ firestoreDb, FieldValue, env = process.env, now = () => new Date() }) {
  const pricing = parsePricing(env.MODEL_PRICING_JSON);

  async function recordModelCall({ uid, route, provider, model, ok, latencyMs, usage, status }) {
    const day = now().toISOString().slice(0, 10);
    const { inputTokens, outputTokens } = normalizeUsage(usage);
    const costUsd = estimateCostUsd(pricing, model, inputTokens, outputTokens);
    const increment = FieldValue.increment;
    const hasLatency = typeof latencyMs === 'number' && Number.isFinite(latencyMs) && latencyMs >= 0;
    const metric = {
      day,
      provider,
      model,
      calls: increment(1),
      errors: increment(ok ? 0 : 1),
      latencyMsTotal: increment(hasLatency ? Math.round(latencyMs) : 0),
      inputTokens: increment(inputTokens),
      outputTokens: increment(outputTokens),
      [`routes.${String(route || 'unknown').replace(/[^a-z_]/gi, '_')}`]: increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (hasLatency) metric.latencySamples = increment(1);
    if (!ok && status) metric[`statusCodes.s${Number(status) || 0}`] = increment(1);
    if (costUsd !== null) metric.estimatedCostUsd = increment(costUsd);

    const writes = [
      firestoreDb.collection('model_metrics').doc(metricDocId(day, provider, model)).set(metric, { merge: true }),
    ];
    if (uid && (inputTokens || outputTokens)) {
      const usageUpdate = {
        uid,
        day,
        inputTokens: increment(inputTokens),
        outputTokens: increment(outputTokens),
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (costUsd !== null) usageUpdate.estimatedCostUsd = increment(costUsd);
      writes.push(firestoreDb.collection('usage_daily').doc(`${uid}_${day}`).set(usageUpdate, { merge: true }));
    }
    try {
      await Promise.all(writes);
    } catch (error) {
      console.warn('Model metriği kaydedilemedi:', error.message);
    }
  }

  // Ölçüm kullanıcı yanıtını geciktirmesin ve hata atmasın.
  function track(entry) {
    recordModelCall(entry).catch(() => {});
  }

  async function listDailyMetrics(days = 7) {
    const since = new Date(now().getTime() - (Math.max(1, Math.min(days, 90)) - 1) * 86400000).toISOString().slice(0, 10);
    const snapshot = await firestoreDb.collection('model_metrics').where('day', '>=', since).get();
    return snapshot.docs.map(doc => {
      const data = doc.data();
      const calls = Number(data.calls || 0);
      const latencySamples = data.latencySamples !== undefined ? Number(data.latencySamples || 0) : calls;
      return {
        id: doc.id,
        day: data.day,
        provider: data.provider,
        model: data.model,
        calls,
        errors: Number(data.errors || 0),
        errorRate: calls ? Number(data.errors || 0) / calls : 0,
        avgLatencyMs: latencySamples > 0 ? Math.round(Number(data.latencyMsTotal || 0) / latencySamples) : 0,
        latencySamples,
        inputTokens: Number(data.inputTokens || 0),
        outputTokens: Number(data.outputTokens || 0),
        estimatedCostUsd: data.estimatedCostUsd ?? null,
        routes: data.routes || {},
        statusCodes: data.statusCodes || {},
      };
    }).sort((a, b) => b.day.localeCompare(a.day) || b.calls - a.calls);
  }

  return { recordModelCall, track, listDailyMetrics, pricingConfigured: Object.keys(pricing).length > 0 };
}

module.exports = { createMetrics, estimateCostUsd, normalizeUsage, parsePricing };
