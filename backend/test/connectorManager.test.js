const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { fakeFirestore } = require('./fakeFirestore');
const { createConnectorManager, toolName } = require('../connectors/manager');
const { ConnectorAuthError } = require('../connectors/remoteMcp');

const env = {
  CONNECTOR_TOKEN_KEY: crypto.randomBytes(32).toString('base64'),
  PUBLIC_BACKEND_URL: 'https://api.test',
  GOOGLE_OAUTH_CLIENT_ID: 'gid',
  GOOGLE_OAUTH_CLIENT_SECRET: 'gsecret',
};

function fakeOAuth() {
  const calls = { refresh: 0, revoke: 0 };
  return {
    calls,
    authorizationUrl: async connector => ({ url: `https://auth.test/${connector.id}?state=S`, state: 'S'.repeat(43), codeVerifier: 'V'.repeat(43) }),
    exchangeCode: async (connector, { code, codeVerifier }) => {
      assert.equal(codeVerifier, 'V'.repeat(43));
      return { access_token: `access-${code}`, refresh_token: 'r1', expires_at: Date.now() + 3600_000 };
    },
    refresh: async () => { calls.refresh += 1; return { access_token: 'access-yeni', refresh_token: 'r1', expires_at: Date.now() + 3600_000 }; },
    needsRefresh: tokens => tokens.access_token === 'access-eski',
    revoke: async () => { calls.revoke += 1; return true; },
  };
}

function fakeDriver({ failAuthFor = new Set() } = {}) {
  const calls = [];
  return {
    calls,
    listTools: async () => [
      { name: 'list_events', description: 'Etkinlikleri listeler', inputSchema: { type: 'object', properties: { query: { type: 'string' } } }, readOnly: true },
      { name: 'create_event', description: 'Etkinlik ekler', inputSchema: { type: 'object', properties: {} }, readOnly: false },
    ],
    callTool: async (connector, token, name, args) => {
      calls.push({ token, name, args });
      if (failAuthFor.has(token)) throw new ConnectorAuthError();
      return { isError: false, text: `ok:${name}:${JSON.stringify(args)}` };
    },
  };
}

function setup({ plus = true, driver = fakeDriver(), envOverrides = {} } = {}) {
  const firestoreDb = fakeFirestore();
  const oauth = fakeOAuth();
  const manager = createConnectorManager({
    env: { ...env, ...envOverrides },
    firestoreDb,
    oauth,
    drivers: { builtin: { googleCalendar: driver, googleDrive: driver }, remote: driver },
    hasActivePlus: async () => plus,
  });
  return { manager, oauth, driver, firestoreDb };
}

async function connect(manager, uid = 'u1', connectorId = 'google_calendar') {
  await manager.startConnect(uid, connectorId);
  return manager.finishConnect({ code: 'kod', state: 'S'.repeat(43) });
}

test('anahtar yoksa yönetici kapalıdır ve araç vermez', async () => {
  const { manager } = setup({ envOverrides: { CONNECTOR_TOKEN_KEY: '' } });
  assert.equal(manager.enabled, false);
  assert.deepEqual(await manager.toolDefinitionsFor('u1'), []);
  await assert.rejects(() => manager.startConnect('u1', 'google_calendar'), error => error.code === 'disabled');
});

test('katalog kullanılabilirlik ve bağlantı durumunu gösterir, token göstermez', async () => {
  const { manager } = setup();
  await connect(manager);
  const catalog = await manager.catalogFor('u1');
  const calendar = catalog.connectors.find(item => item.id === 'google_calendar');
  const github = catalog.connectors.find(item => item.id === 'github');
  assert.equal(calendar.available, true);
  assert.equal(calendar.connected, true);
  assert.equal(calendar.toolCount, 2);
  assert.equal(github.available, false);
  assert.doesNotMatch(JSON.stringify(catalog), /access-kod|r1/);
});

test('bağlanma: bilinmeyen veya kullanılamayan bağlayıcı ve Plus olmayan kullanıcı reddedilir', async () => {
  await assert.rejects(() => setup().manager.startConnect('u1', 'gmail'), error => error.code === 'not_found');
  await assert.rejects(() => setup().manager.startConnect('u1', 'github'), error => error.code === 'unavailable');
  await assert.rejects(() => setup({ plus: false }).manager.startConnect('u1', 'google_calendar'), error => error.code === 'plus_required');
  assert.equal((await setup({ plus: false, envOverrides: { CONNECTORS_FREE: 'true' } }).manager.startConnect('u1', 'google_calendar')).authUrl.startsWith('https://auth.test/'), true);
});

test('callback: state tek kullanımlık; araç listesi önbelleğe alınır', async () => {
  const { manager } = setup();
  await manager.startConnect('u1', 'google_calendar');
  assert.deepEqual(await manager.finishConnect({ code: 'kod', state: 'S'.repeat(43) }), { uid: 'u1', connectorId: 'google_calendar', client: 'web' });
  await assert.rejects(() => manager.finishConnect({ code: 'kod', state: 'S'.repeat(43) }), error => error.code === 'invalid_state');
  // Kullanıcı izin vermezse yeni bir istekte "denied" döner ve state yine harcanır.
  await manager.startConnect('u1', 'google_calendar');
  await assert.rejects(() => manager.finishConnect({ error: 'access_denied', state: 'S'.repeat(43) }), error => error.code === 'denied');
  await assert.rejects(() => manager.finishConnect({ code: 'kod', state: 'S'.repeat(43) }), error => error.code === 'invalid_state');
});

test('araç tanımları: önek, okuma onaysız, yazma onaylı, untrusted çıktı', async () => {
  const { manager, driver } = setup();
  await connect(manager);
  const tools = await manager.toolDefinitionsFor('u1');
  const byName = Object.fromEntries(tools.map(tool => [tool.name, tool]));
  assert.deepEqual(Object.keys(byName), ['google_calendar__list_events', 'google_calendar__create_event']);
  assert.equal(byName.google_calendar__list_events.requiresConfirmation, false);
  assert.equal(byName.google_calendar__create_event.requiresConfirmation, true);
  assert.equal(byName.google_calendar__create_event.riskLevel, 'high');
  assert.match(byName.google_calendar__list_events.description, /^\[Google Takvim\] /);
  assert.equal(byName.google_calendar__list_events.strict, false);
  const output = await byName.google_calendar__list_events.execute({ query: 'ders' }, { userId: 'u1' });
  assert.equal(output.untrustedContent, true);
  assert.equal(output.content, 'ok:list_events:{"query":"ders"}');
  assert.equal(driver.calls[0].token, 'access-kod');
});

test('araç başka kullanıcının bağlamında çalışmaz', async () => {
  const { manager } = setup();
  await connect(manager);
  const [tool] = await manager.toolDefinitionsFor('u1');
  await assert.rejects(() => tool.execute({}, { userId: 'u2' }), /kullanıcı/);
});

test('Plus bitince araçlar verilmez; bağlantısı olmayan kullanıcıya araç yok', async () => {
  const first = setup();
  await connect(first.manager);
  assert.equal((await first.manager.toolDefinitionsFor('u2')).length, 0);
  let plus = true;
  const firestoreDb = fakeFirestore();
  const manager = createConnectorManager({ env, firestoreDb, oauth: fakeOAuth(), drivers: { builtin: { googleCalendar: fakeDriver() }, remote: fakeDriver() }, hasActivePlus: async () => plus });
  await connect(manager);
  plus = false;
  assert.deepEqual(await manager.toolDefinitionsFor('u1'), []);
});

test('süresi dolan token önce yenilenir; yetki hatasında bir kez yenilenip tekrar denenir', async () => {
  const driver = fakeDriver({ failAuthFor: new Set(['access-kod']) });
  const { manager, oauth } = setup({ driver });
  await connect(manager);
  const [tool] = await manager.toolDefinitionsFor('u1');
  const output = await tool.execute({}, { userId: 'u1' });
  assert.equal(oauth.calls.refresh, 1);
  assert.match(output.content, /^ok:/);
  assert.deepEqual(driver.calls.map(call => call.token), ['access-kod', 'access-yeni']);
});

test('yenileme de başarısızsa bağlantı reauth olur ve kullanıcıya yol gösterilir', async () => {
  const driver = fakeDriver({ failAuthFor: new Set(['access-kod', 'access-yeni']) });
  const { manager } = setup({ driver });
  await connect(manager);
  const [tool] = await manager.toolDefinitionsFor('u1');
  const output = await tool.execute({}, { userId: 'u1' });
  assert.match(output.error, /yeniden bağlan/);
  const catalog = await manager.catalogFor('u1');
  assert.equal(catalog.connectors.find(item => item.id === 'google_calendar').status, 'reauth');
  assert.deepEqual(await manager.toolDefinitionsFor('u1'), []);
});

test('bağlantıyı kesmek tokenı iptal eder ve araçları kaldırır', async () => {
  const { manager, oauth } = setup();
  await connect(manager);
  await manager.disconnect('u1', 'google_calendar');
  assert.equal(oauth.calls.revoke, 1);
  assert.deepEqual(await manager.toolDefinitionsFor('u1'), []);
});

test('toolName geçersiz karakterleri temizler ve 64 karakteri aşmaz', () => {
  assert.equal(toolName('notion', 'notion-search'), 'notion__notion-search');
  assert.equal(toolName('notion', 'çok garip/ad'), 'notion__ok_garip_ad');
  assert.ok(toolName('github', 'x'.repeat(200)).length <= 64);
});

test('bağlanırken seçilen istemci callback sonucunda geri döner', async () => {
  const { manager } = setup();
  await manager.startConnect('u1', 'google_calendar', { client: 'android' });
  const result = await manager.finishConnect({ code: 'c', state: 'S'.repeat(43) });
  assert.equal(result.client, 'android');
});

test('izin reddedilince hata istemci bilgisini taşır', async () => {
  const { manager } = setup();
  await manager.startConnect('u1', 'google_calendar', { client: 'android' });
  await assert.rejects(() => manager.finishConnect({ state: 'S'.repeat(43), error: 'access_denied' }),
    error => error.code === 'denied' && error.client === 'android');
});

test('istemci verilmezse web sayılır', async () => {
  const { manager } = setup();
  await manager.startConnect('u1', 'google_calendar');
  assert.equal((await manager.finishConnect({ code: 'c', state: 'S'.repeat(43) })).client, 'web');
});
