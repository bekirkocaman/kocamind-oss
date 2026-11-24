// Bağlantılar (Google Takvim, Drive, Notion, GitHub) için HTTP uçları.
// Callback herkese açıktır: tarayıcı yönlendirmesi bearer token taşımaz. Kimlik,
// tek kullanımlık OAuth state üzerinden doğrulanır.
const { ConnectorError } = require('../connectors/manager');

const ID_PATTERN = /^[a-z0-9_]{1,40}$/;
const STATUS_BY_CODE = { not_found: 404, unavailable: 409, plus_required: 403, disabled: 503, invalid_state: 400, denied: 400 };
const DEFAULT_RETURN_URL = 'https://kocamind.com/';
// Android uygulaması bu adresi deep link olarak yakalar (AndroidManifest.xml).
const ANDROID_RETURN_URL = 'kocamind://baglantilar';

function sendError(res, error, fallback) {
  if (error instanceof ConnectorError) {
    return res.status(STATUS_BY_CODE[error.code] || 400).json({ error: error.message, code: error.code });
  }
  console.error('Bağlantı hatası:', error.message);
  return res.status(502).json({ error: fallback, code: 'error' });
}

function returnUrl(env, client, params) {
  // Dönüş adresi yalnızca sabitlerden ve ortam değişkeninden gelir; istekten alınmaz.
  const url = new URL(client === 'android' ? ANDROID_RETURN_URL : (env.CONNECTORS_RETURN_URL || DEFAULT_RETURN_URL));
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

function registerConnectorCallbackRoute(app, { manager, env = process.env }) {
  app.get('/connectors/callback', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    try {
      const { connectorId, client } = await manager.finishConnect({
        code: typeof req.query.code === 'string' ? req.query.code : undefined,
        state: typeof req.query.state === 'string' ? req.query.state : undefined,
        error: typeof req.query.error === 'string' ? req.query.error : undefined,
      });
      return res.redirect(302, returnUrl(env, client, { baglanti: connectorId, durum: 'ok' }));
    } catch (error) {
      const reason = error instanceof ConnectorError ? error.code : 'error';
      if (!(error instanceof ConnectorError)) console.error('Bağlantı callback hatası:', error.message);
      return res.redirect(302, returnUrl(env, error?.client, { durum: 'hata', neden: reason }));
    }
  });
}

function registerConnectorRoutes(app, { manager }) {
  app.get('/connectors', async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      return res.json(await manager.catalogFor(req.user.uid));
    } catch (error) {
      return sendError(res, error, 'Bağlantılar şu anda okunamıyor.');
    }
  });

  app.post('/connectors/:id/connect', async (req, res) => {
    if (!ID_PATTERN.test(req.params.id)) return res.status(400).json({ error: 'Geçersiz bağlantı.', code: 'not_found' });
    try {
      const client = req.body?.client === 'android' ? 'android' : 'web';
      return res.json(await manager.startConnect(req.user.uid, req.params.id, { client }));
    } catch (error) {
      return sendError(res, error, 'Bağlantı başlatılamadı, biraz sonra tekrar dene.');
    }
  });

  app.delete('/connectors/:id', async (req, res) => {
    if (!ID_PATTERN.test(req.params.id)) return res.status(400).json({ error: 'Geçersiz bağlantı.', code: 'not_found' });
    try {
      await manager.disconnect(req.user.uid, req.params.id);
      return res.json({ disconnected: true });
    } catch (error) {
      return sendError(res, error, 'Bağlantı kesilemedi, biraz sonra tekrar dene.');
    }
  });
}

module.exports = { registerConnectorCallbackRoute, registerConnectorRoutes };
