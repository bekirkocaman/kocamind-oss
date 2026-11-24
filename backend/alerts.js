const crypto = require('node:crypto');
const { clientErrorFingerprint } = require('./routes/telemetry');

const WEBHOOK_TIMEOUT_MS = 5000;
const CLIENT_ERROR_READ_LIMIT = 5000;

function parseNumber(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function stateDocId(day, provider, model, reason) {
  return `${day}_${provider}_${model}_${reason}`.replace(/[/\s]/g, '-').slice(0, 300);
}

function isHttpsWebhook(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  try {
    const parsed = new URL(rawUrl.trim());
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function formatAlertText(day, alert) {
  const pct = Math.round(alert.errorRate * 1000) / 10;
  const reasonLabel = alert.reason === 'latency' ? 'yüksek gecikme' : 'yüksek hata oranı';
  return `[KocaMind Uyarı · ${day}] ${alert.provider}/${alert.model} (${reasonLabel}): ${alert.errors}/${alert.calls} hata (%${pct}), ort. gecikme ${alert.avgLatencyMs} ms.`;
}

function cleanClientErrorText(value, row = {}, maxLength) {
  let cleaned = String(value ?? '')
    .replace(/\b(?:[a-z][a-z\d+.-]*:\/\/|www\.)[^\s<>]+/gi, '[bağlantı]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[e-posta]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, '[gizlendi]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[gizlendi]')
    .replace(/\b(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{24,}\b/g, '[gizlendi]');
  for (const privateValue of [row?.uid, row?.url, row?.stack, row?.componentStack]) {
    if (typeof privateValue === 'string' && privateValue.trim().length >= 4) {
      cleaned = cleaned.replaceAll(privateValue, '[gizlendi]');
    }
  }
  cleaned = cleaned
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return maxLength === undefined ? cleaned : cleaned.slice(0, maxLength);
}

function countClientStatusErrors(statusCodes) {
  if (!statusCodes || typeof statusCodes !== 'object') return 0;
  let total = 0;
  for (const [key, value] of Object.entries(statusCodes)) {
    const match = /^s(\d{3})$/.exec(key);
    if (!match) continue;
    const code = Number(match[1]);
    // 429 sağlayıcı yoğunluğu, 401/403 ise API anahtarı/yetki arızası olduğundan uyarıda tutulur;
    // diğer 4xx kodları (400, 404, 422, 499 vb.) istemci kaynaklıdır.
    if (code >= 400 && code < 500 && code !== 429 && code !== 401 && code !== 403) {
      total += Math.max(0, Number(value) || 0);
    }
  }
  return total;
}

function createAlerts({ firestoreDb, metrics, fetch, mailer, env = process.env, now = () => new Date() }) {
  async function checkModelHealth() {
    const today = now().toISOString().slice(0, 10);
    const errorRateThreshold = parseNumber(env.ALERT_ERROR_RATE, 0.2);
    const minCalls = parseNumber(env.ALERT_MIN_CALLS, 20);
    const avgLatencyThreshold = parseNumber(env.ALERT_AVG_LATENCY_MS, 30000);

    const rows = await metrics.listDailyMetrics(1);
    const alerts = [];
    let checked = 0;

    for (const row of rows || []) {
      if (row.day && row.day !== today) continue;
      if (!row.provider || !row.model) continue;
      checked += 1;

      const rawCalls = Number(row.calls || 0);
      const rawErrors = Number(row.errors || 0);
      const fallbackSkipped = Math.max(0, Number(row.routes?.chat_model_fallback || 0));
      const client4xx = countClientStatusErrors(row.statusCodes);
      const excluded = fallbackSkipped + client4xx;

      const calls = Math.max(0, rawCalls - excluded);
      if (calls < minCalls || calls <= 0) continue;

      const errors = Math.min(calls, Math.max(0, rawErrors - excluded));
      const errorRate = errors / calls;
      const latencySamples = row.latencySamples !== undefined ? Number(row.latencySamples || 0) : calls;
      const avgLatencyMs = row.avgLatencyMs !== undefined
        ? Number(row.avgLatencyMs)
        : (latencySamples > 0 ? Math.round(Number(row.latencyMsTotal || 0) / latencySamples) : 0);

      const base = {
        provider: row.provider,
        model: row.model,
        calls,
        errors,
        errorRate,
        avgLatencyMs,
      };

      if (errorRate > errorRateThreshold) {
        alerts.push({ ...base, reason: 'errors' });
      }
      if (avgLatencyMs > avgLatencyThreshold) {
        alerts.push({ ...base, reason: 'latency' });
      }
    }

    checkModelHealth.lastCheckedCount = checked;
    return alerts;
  }

  async function checkClientErrors(day = now().toISOString().slice(0, 10)) {
    const query = firestoreDb.collection('client_errors').where('day', '==', day);
    const { docs } = await query.limit(CLIENT_ERROR_READ_LIMIT).get();
    const groups = new Map();
    for (const doc of docs) {
      const row = doc.data();
      const fingerprint = row.fingerprint || clientErrorFingerprint(String(row.message ?? ''), String(row.release ?? ''));
      const group = groups.get(fingerprint);
      if (group) {
        group.count += 1;
      } else {
        groups.set(fingerprint, {
          fingerprint,
          count: 1,
          message: cleanClientErrorText(row.message, row, 120),
          release: cleanClientErrorText(row.release, row, 100),
        });
      }
    }

    const total = docs.length === CLIENT_ERROR_READ_LIMIT
      ? (await query.count().get()).data().count
      : docs.length;
    const top = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 3);
    const totalThreshold = parseNumber(env.ALERT_CLIENT_ERRORS, 50);
    const spikeThreshold = parseNumber(env.ALERT_CLIENT_ERROR_SPIKE, 20);
    if (total <= totalThreshold && (top[0]?.count ?? 0) < spikeThreshold) return null;
    const alert = { reason: 'client_errors', total, top };
    if (total > CLIENT_ERROR_READ_LIMIT) alert.truncated = true;
    return alert;
  }

  async function postWebhook(webhookUrl, text) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
        redirect: 'manual',
      });
      if (!response) {
        return { ok: false, error: 'Webhook HTTP unknown' };
      }
      const status = Number(response.status);
      if (status >= 300 && status < 400) {
        return { ok: false, error: `Webhook yönlendirme reddedildi (HTTP ${status})` };
      }
      if (!response.ok) {
        return { ok: false, error: `Webhook HTTP ${response.status}` };
      }
      return { ok: true };
    } catch (error) {
      const reason = error?.name === 'AbortError' ? 'timeout' : 'request_failed';
      return { ok: false, error: `Webhook hatası (${reason})` };
    } finally {
      clearTimeout(timer);
    }
  }

  async function sendModelAlert(day, alert, webhookUrl, errors) {
    const docId = stateDocId(day, alert.provider, alert.model, alert.reason);
    const stateRef = firestoreDb.collection('alert_state').doc(docId);
    try {
      const claimed = await firestoreDb.runTransaction(async tx => {
        if ((await tx.get(stateRef)).exists) return false;
        tx.set(stateRef, {
          day,
          provider: alert.provider,
          model: alert.model,
          reason: alert.reason,
          calls: alert.calls,
          errors: alert.errors,
          errorRate: alert.errorRate,
          avgLatencyMs: alert.avgLatencyMs,
          createdAt: now().toISOString(),
        });
        return true;
      });
      if (!claimed) return 0;
    } catch (error) {
      errors.push(`Durum alınamadı (${alert.provider}/${alert.model})`);
      return 0;
    }

    const text = formatAlertText(day, alert);
    const result = await postWebhook(webhookUrl, text);
    if (result.ok) return 1;

    errors.push(result.error);
    try {
      await stateRef.delete();
    } catch (error) {
      errors.push(`Durum silinemedi (${alert.provider}/${alert.model})`);
    }
    return 0;
  }

  async function sendClientErrorAlert(day, alert, webhookUrl, errors) {
    const stateRef = firestoreDb.collection('alert_state').doc(`${day}_client_errors`);
    try {
      const claimed = await firestoreDb.runTransaction(async tx => {
        if ((await tx.get(stateRef)).exists) return false;
        tx.set(stateRef, { day, reason: alert.reason, total: alert.total, createdAt: now().toISOString() });
        return true;
      });
      if (!claimed) return 0;
    } catch (error) {
      errors.push('İstemci hata uyarısının durumu alınamadı');
      return 0;
    }

    const sample = alert.truncated ? ` En sık hatalar ilk ${CLIENT_ERROR_READ_LIMIT} kayda göre sıralandı.` : '';
    const lines = alert.top.map(({ count, message, release }) => (
      `• ${count} kez · ${message}${release ? ` (${release})` : ''}`
    ));
    const text = [`[KocaMind Uyarı · ${day}] ${alert.total} istemci hatası kaydedildi.${sample}`, ...lines].join('\n');
    const result = await postWebhook(webhookUrl, text);
    if (result.ok) return 1;

    errors.push(result.error);
    try {
      await stateRef.delete();
    } catch (error) {
      errors.push('İstemci hata uyarısının durumu silinemedi');
    }
    return 0;
  }

  async function runAlerts() {
    const today = now().toISOString().slice(0, 10);
    const errors = [];
    let alerts = [];
    let checked = 0;

    try {
      alerts = await checkModelHealth();
      checked = checkModelHealth.lastCheckedCount || 0;
    } catch (error) {
      console.error('Model sağlığı kontrol edilemedi:', error?.message || 'bilinmeyen hata');
      errors.push('Model sağlığı okunamadı');
    }

    let clientErrors = null;
    try {
      clientErrors = await checkClientErrors(today);
    } catch (error) {
      console.error('İstemci hataları kontrol edilemedi:', error?.message || 'bilinmeyen hata');
      errors.push('İstemci hataları okunamadı');
    }
    const alertCount = alerts.length + Number(Boolean(clientErrors));
    const summary = { checked, alerts: alertCount, sent: 0, errors, clientErrors };
    if (!alertCount) return summary;

    const rawWebhook = env.ALERT_WEBHOOK_URL;
    const webhookUrl = isHttpsWebhook(rawWebhook) ? rawWebhook.trim() : null;
    if (rawWebhook && !webhookUrl) {
      console.warn('ALERT_WEBHOOK_URL yalnızca https:// adresleri destekler; webhook atlandı.');
    }

    // backend/mailer.js yalnızca sabit EMAIL_KINDS şablonlarını desteklediğinden
    // model sağlık uyarısı e-posta kanalı bu sürümde atlanır.
    const hasEmailChannel = false;
    void mailer;

    if (!webhookUrl && !hasEmailChannel) {
      console.warn(`Uyarı (${alertCount} adet), ancak bildirim kanalı tanımlı değil.`);
      return { ...summary, skippedNoChannel: true };
    }

    let sent = 0;
    if (webhookUrl) {
      for (const alert of alerts) {
        sent += await sendModelAlert(today, alert, webhookUrl, errors);
      }
      if (clientErrors) {
        sent += await sendClientErrorAlert(today, clientErrors, webhookUrl, errors);
      }
    }
    return { ...summary, sent };
  }

  return { checkModelHealth, checkClientErrors, runAlerts };
}

function registerAlertCronRoute(app, alerts, { cronSecret = process.env.CRON_SECRET } = {}) {
  app.get('/cron/alerts', async (req, res) => {
    const expected = Buffer.from(`Bearer ${cronSecret || ''}`);
    const received = Buffer.from(req.headers.authorization || '');
    if (!cronSecret || expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
      return res.status(401).json({ error: 'Yetkisiz.' });
    }
    try {
      const result = await alerts.runAlerts();
      res.json(result);
    } catch (error) {
      console.error('Uyarı cron hatası:', error.message);
      res.status(500).json({ error: 'Uyarı işi çalışmadı.' });
    }
  });
}

module.exports = { createAlerts, registerAlertCronRoute, cleanClientErrorText, CLIENT_ERROR_READ_LIMIT };
