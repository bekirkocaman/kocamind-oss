const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { registerConnectorCallbackRoute, registerConnectorRoutes } = require('../routes/connectors');
const { ConnectorError } = require('../connectors/manager');

function fakeManager(overrides = {}) {
  const calls = [];
  return {
    calls,
    enabled: true,
    catalogFor: async uid => ({ enabled: true, connectors: [{ id: 'notion', connected: uid === 'u1' }] }),
    startConnect: async (uid, id) => { calls.push(['start', uid, id]); return { authUrl: `https://auth.test/${id}` }; },
    finishConnect: async ({ code, state }) => {
      calls.push(['finish', code, state]);
      if (state === 'bozuk') throw new ConnectorError('invalid_state', 'süre doldu');
      if (state === 'patlak') throw new Error('ağ hatası: gizli ayrıntı');
      return { uid: 'u1', connectorId: 'notion' };
    },
    disconnect: async (uid, id) => { calls.push(['disconnect', uid, id]); },
    ...overrides,
  };
}

function app(manager, env = { CONNECTORS_RETURN_URL: 'https://kocamind.test/ayarlar?sekme=baglantilar' }) {
  const server = express();
  server.use(express.json());
  registerConnectorCallbackRoute(server, { manager, env });
  server.use((req, res, next) => { req.user = { uid: 'u1' }; next(); });
  registerConnectorRoutes(server, { manager });
  return server;
}

test('liste kullanıcının kataloğunu döndürür', async () => {
  const response = await request(app(fakeManager())).get('/connectors');
  assert.equal(response.status, 200);
  assert.equal(response.body.connectors[0].connected, true);
});

test('bağlan uç noktası giriş yapan kullanıcı adına yetkilendirme adresi döndürür', async () => {
  const manager = fakeManager();
  const response = await request(app(manager)).post('/connectors/notion/connect');
  assert.equal(response.status, 200);
  assert.equal(response.body.authUrl, 'https://auth.test/notion');
  assert.deepEqual(manager.calls[0], ['start', 'u1', 'notion']);
});

test('bağlanma hataları doğru durum koduna çevrilir', async () => {
  const cases = [['not_found', 404], ['unavailable', 409], ['plus_required', 403], ['disabled', 503]];
  for (const [code, status] of cases) {
    const manager = fakeManager({ startConnect: async () => { throw new ConnectorError(code, `mesaj-${code}`); } });
    const response = await request(app(manager)).post('/connectors/notion/connect');
    assert.equal(response.status, status, code);
    assert.equal(response.body.code, code);
  }
  const crashing = fakeManager({ startConnect: async () => { throw new Error('iç ayrıntı'); } });
  const response = await request(app(crashing)).post('/connectors/notion/connect');
  assert.equal(response.status, 502);
  assert.doesNotMatch(JSON.stringify(response.body), /iç ayrıntı/);
});

test('callback başarılıysa sabit dönüş adresine bağlayıcı adıyla yönlendirir', async () => {
  const response = await request(app(fakeManager())).get('/connectors/callback?code=k&state=s');
  assert.equal(response.status, 302);
  const location = new URL(response.headers.location);
  assert.equal(location.origin + location.pathname, 'https://kocamind.test/ayarlar');
  assert.equal(location.searchParams.get('sekme'), 'baglantilar');
  assert.equal(location.searchParams.get('baglanti'), 'notion');
  assert.equal(location.searchParams.get('durum'), 'ok');
});

test('callback hatasında ayrıntı sızdırmadan hata durumuyla yönlendirir', async () => {
  const expired = await request(app(fakeManager())).get('/connectors/callback?code=k&state=bozuk');
  assert.equal(new URL(expired.headers.location).searchParams.get('durum'), 'hata');
  assert.equal(new URL(expired.headers.location).searchParams.get('neden'), 'invalid_state');
  const crashed = await request(app(fakeManager())).get('/connectors/callback?code=k&state=patlak');
  assert.equal(new URL(crashed.headers.location).searchParams.get('neden'), 'error');
  assert.doesNotMatch(crashed.headers.location, /gizli/);
});

test('callback yönlendirmesi istekteki adrese gitmez (açık yönlendirme yok)', async () => {
  const response = await request(app(fakeManager(), {})).get('/connectors/callback?code=k&state=s&redirect=https://kotu.example');
  assert.match(response.headers.location, /^https:\/\/kocamind\.com\//);
});

test('bağlantıyı kesme yalnızca bilinen kimlik biçimini kabul eder', async () => {
  const manager = fakeManager();
  assert.equal((await request(app(manager)).delete('/connectors/notion')).status, 200);
  assert.equal((await request(app(manager)).delete('/connectors/..%2Fusers')).status, 400);
  assert.deepEqual(manager.calls, [['disconnect', 'u1', 'notion']]);
});

test('android istemcisi bağlanırken istemci bilgisi yöneticiye geçer', async () => {
  const manager = fakeManager({ startConnect: async (uid, id, options) => { manager.calls.push(['start', uid, id, options]); return { authUrl: 'https://auth.test/x' }; } });
  await request(app(manager)).post('/connectors/notion/connect').send({ client: 'android' });
  await request(app(manager)).post('/connectors/notion/connect').send({ client: 'https://kotu.example' });
  assert.deepEqual(manager.calls[0][3], { client: 'android' });
  assert.deepEqual(manager.calls[1][3], { client: 'web' });
});

test('android callback uygulamanın sabit adresine döner', async () => {
  const manager = fakeManager({ finishConnect: async () => ({ uid: 'u1', connectorId: 'notion', client: 'android' }) });
  const response = await request(app(manager)).get('/connectors/callback?code=k&state=s');
  assert.equal(response.status, 302);
  const location = new URL(response.headers.location);
  assert.equal(location.protocol, 'kocamind:');
  assert.equal(location.host, 'baglantilar');
  assert.equal(location.searchParams.get('durum'), 'ok');
  assert.equal(location.searchParams.get('baglanti'), 'notion');
});

test('android callback hatasında da uygulamaya hata durumuyla döner', async () => {
  const manager = fakeManager({
    finishConnect: async () => { const error = new ConnectorError('denied', 'izin yok'); error.client = 'android'; throw error; },
  });
  const location = new URL((await request(app(manager)).get('/connectors/callback?state=s&error=x')).headers.location);
  assert.equal(location.protocol, 'kocamind:');
  assert.equal(location.searchParams.get('durum'), 'hata');
  assert.equal(location.searchParams.get('neden'), 'denied');
});
