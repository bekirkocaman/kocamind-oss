const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../server');

test('sağlık kontrolü anonim erişime açıktır', async () => {
  const response = await request(app).get('/');
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
});

test('Google giriş yedeği access token olmadan çalışmaz', async () => {
  const response = await request(app).post('/auth/google').send({});
  assert.equal(response.status, 400);
});

test('maliyetli API anonim isteği reddeder', async () => {
  const response = await request(app).post('/chat').send({ message: 'merhaba' });
  assert.equal(response.status, 401);
});

test('izin verilmeyen origin CORS tarafından reddedilir', async () => {
  const response = await request(app).options('/chat').set('Origin', 'https://example.invalid');
  assert.equal(response.headers['access-control-allow-origin'], undefined);
});

test('güvenlik başlıkları tüm yanıtlara eklenir', async () => {
  const response = await request(app).get('/');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['x-frame-options'], 'DENY');
  assert.match(response.headers['content-security-policy'], /default-src 'none'/);
  assert.match(response.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(response.headers['x-powered-by'], undefined);
});

test('hesap dışa aktarma ve silme anonim erişimi reddeder', async () => {
  const exportResponse = await request(app).get('/account/export');
  const deleteResponse = await request(app).delete('/account');
  assert.equal(exportResponse.status, 401);
  assert.equal(deleteResponse.status, 401);
});

test('araç kullanılabilirlik bilgisi anonim erişimi reddeder', async () => {
  const response = await request(app).get('/capabilities');
  assert.equal(response.status, 401);
});

test('model kataloğu oturumsuz isteği reddeder', async () => {
  const response = await request(app).get('/models');
  assert.equal(response.status, 401);
  assert.match(response.headers['content-type'], /application\/json/);
  assert.equal(typeof response.body.error, 'string');
  assert.equal(response.body.models, undefined);
});

test('model kataloğu geçerli oturumla models dizisi döner', async () => {
  const { getAuth } = require('firebase-admin/auth');
  const auth = getAuth();
  const original = auth.verifyIdToken;
  auth.verifyIdToken = async token => {
    if (token !== 'gecerli-token') throw new Error('gecersiz');
    return { uid: 'u1' };
  };
  try {
    const response = await request(app).get('/models').set('Authorization', 'Bearer gecerli-token');
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body.models));
    assert.ok(response.body.models.length > 0);
    const bad = await request(app).get('/models').set('Authorization', 'Bearer baska');
    assert.equal(bad.status, 401);
  } finally {
    auth.verifyIdToken = original;
  }
});

test('OpenAI model listesinde yalnızca Luna yayınlanır', async () => {
  const { getAuth } = require('firebase-admin/auth');
  const auth = getAuth();
  const original = auth.verifyIdToken;
  auth.verifyIdToken = async () => ({ uid: 'u1' });
  let response;
  try {
    response = await request(app).get('/models').set('Authorization', 'Bearer gecerli-token');
  } finally {
    auth.verifyIdToken = original;
  }
  const openAIModels = response.body.models.filter(model => model.provider === 'openai');
  assert.deepEqual(openAIModels.map(model => model.id), ['gpt-5.6-luna']);
});

test('eski araç uçları kaldırıldı, yalnızca kullanıcının kendi Gmail okuma ucu kaldı', async () => {
  const express = require('express');
  const { registerToolsRoutes } = require('../routes/tools');
  let outboundCalls = 0;
  const toolsApp = express();
  toolsApp.use(express.json());
  toolsApp.use((req, res, next) => { req.user = { uid: 'u1', admin: true }; next(); });
  registerToolsRoutes(toolsApp, { fetch: async () => { outboundCalls++; return { ok: true, json: async () => ({}) }; } });
  for (const path of [
    '/tools/scrape', '/tools/email/send', '/tools/telegram/send', '/tools/telegram/updates',
    '/tools/discord/send', '/tools/discord/read', '/tools/github/create-issue',
    '/tools/github/list-repos', '/tools/github/repo-info', '/tools/twitter/post',
  ]) {
    const response = await request(toolsApp).post(path).send({ url: 'http://127.0.0.1', to: 'a@b.c', message: 'm' });
    assert.equal(response.status, 404, path);
  }
  const gmail = await request(toolsApp).post('/tools/email/read').send({});
  assert.equal(gmail.status, 400);
  assert.equal(outboundCalls, 0);
});

test('ham Anthropic ve Gemini proxy uçları artık yok', async () => {
  const express = require('express');
  const { registerChatRoutes } = require('../routes/chat');
  const chatApp = express();
  registerChatRoutes(chatApp, { enforceDailyQuota: () => (req, res, next) => next() });
  for (const path of ['/claude-stream', '/gemini']) {
    const response = await request(chatApp).post(path).send({ model: 'x' });
    assert.equal(response.status, 404, path);
  }
});

test('herkese açık sağlık kontrolü iç bileşen ayrıntısı sızdırmaz', async () => {
  const response = await request(app).get('/health');
  assert.ok([200, 503].includes(response.status));
  assert.deepEqual(Object.keys(response.body), ['status']);
  const admin = await request(app).get('/admin/health');
  assert.equal(admin.status, 401);
});

test('yükleme, dosya türünü içerikten tespit eder', () => {
  const { detectBinaryType, looksLikeText } = require('../routes/uploads');
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  assert.equal(detectBinaryType(png), 'image/png');
  assert.equal(detectBinaryType(Buffer.from('%PDF-1.7\n1 0 obj\n')), 'application/pdf');
  assert.equal(detectBinaryType(Buffer.from('<?php system($_GET["c"]); ?>')), null);
  assert.equal(looksLikeText(Buffer.from('merhaba dünya\nikinci satır')), true);
  assert.equal(looksLikeText(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x41])), false);
});

test('genel JSON gövde limiti 1 MB ile sınırlı (DoS yüzeyi daralt)', async () => {
  // /chat kimlik doğrulaması ister ama gövde ayrıştırıcı auth'tan önce çalışır;
  // 1 MB üstü gövde belleğe alınmadan 413 ile reddedilmeli.
  const bigValue = 'a'.repeat(2 * 1024 * 1024);
  const response = await request(app)
    .post('/chat')
    .set('Content-Type', 'application/json')
    .send({ message: bigValue });
  assert.equal(response.status, 413);
});

test('şifre sıfırlama maili anonim çağrılabilir ama geçersiz adres reddedilir', async () => {
  const response = await request(app).post('/auth/email/password-reset').send({ email: 'adres-degil' });
  assert.equal(response.status, 400);
});

test('safeError gizli değerleri anahtar adını koruyarak maskeler', () => {
  const { safeError } = require('../agent/security');
  const first = safeError(new Error('istek basarisiz token=abc123 devam')).error;
  assert.match(first, /token=\[REDACTED\]/);
  assert.doesNotMatch(first, /abc123|\$1/);
  const second = safeError(new Error('hata password: gizli bilgi')).error;
  assert.match(second, /password=\[REDACTED\]/);
  assert.doesNotMatch(second, /gizli|\$1/);
});

test('bozuk JSON gövdesi HTML yerine 400 JSON döner', async () => {
  const response = await request(app)
    .post('/auth/google')
    .set('Content-Type', 'application/json')
    .send('{"accessToken": ');
  assert.equal(response.status, 400);
  assert.match(response.headers['content-type'], /application\/json/);
  assert.deepEqual(response.body, { error: 'Geçersiz istek gövdesi.' });
  assert.doesNotMatch(response.text, /<pre>|SyntaxError|at /);
});

test('çok büyük gövde HTML yerine 413 JSON döner', async () => {
  const response = await request(app)
    .post('/auth/google')
    .set('Content-Type', 'application/json')
    .send(JSON.stringify({ accessToken: 'x'.repeat(1024 * 1024 + 10) }));
  assert.equal(response.status, 413);
  assert.match(response.headers['content-type'], /application\/json/);
  assert.equal(typeof response.body.error, 'string');
});

test('HSTS başlığı 2 yıl, includeSubDomains ve preload içerir', async () => {
  const response = await request(app).get('/');
  assert.equal(response.headers['strict-transport-security'], 'max-age=63072000; includeSubDomains; preload');
});
