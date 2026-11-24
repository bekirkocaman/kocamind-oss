const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { fakeFirestore } = require('./fakeFirestore');
const { createTokenCipher } = require('../connectors/crypto');
const { createConnectorStore } = require('../connectors/store');
const { CONNECTORS, getConnector, availability, scopesFor } = require('../connectors/catalog');

const cipher = createTokenCipher(crypto.randomBytes(32).toString('base64'));
const STATE = 'a'.repeat(43);

function setup(start = 1_000_000) {
  let clock = start;
  const db = fakeFirestore();
  const store = createConnectorStore({ firestoreDb: db, cipher, now: () => clock });
  return { db, store, tick: ms => { clock += ms; } };
}

test('OAuth state tek kullanımlıktır ve doğrulayıcı şifreli saklanır', async () => {
  const { db, store } = setup();
  await store.saveState(STATE, { uid: 'u1', connectorId: 'notion', codeVerifier: 'gizli-dogrulayici' });
  assert.doesNotMatch(JSON.stringify([...db.docs.values()]), /gizli-dogrulayici/);
  const first = await store.takeState(STATE);
  assert.equal(first.uid, 'u1');
  assert.equal(first.codeVerifier, 'gizli-dogrulayici');
  assert.equal(await store.takeState(STATE), null);
});

test('süresi dolan veya biçimi bozuk state reddedilir', async () => {
  const { store, tick } = setup();
  await store.saveState(STATE, { uid: 'u1', connectorId: 'notion', codeVerifier: 'v' });
  tick(11 * 60 * 1000);
  assert.equal(await store.takeState(STATE), null);
  assert.equal(await store.takeState('kisa'), null);
  assert.equal(await store.takeState('../../x'.padEnd(30, 'a')), null);
});

test('bağlantı tokenı şifreli saklanır, listede token dönmez', async () => {
  const { db, store } = setup();
  await store.saveConnection('u1', 'notion', { tokens: { access_token: 'erisim-123' }, tools: [{ name: 'search' }] });
  assert.doesNotMatch(JSON.stringify([...db.docs.values()]), /erisim-123/);
  const connection = await store.getConnection('u1', 'notion');
  assert.equal(connection.tokens.access_token, 'erisim-123');
  assert.equal(connection.status, 'active');
  const list = await store.listConnections('u1');
  assert.equal(list.length, 1);
  assert.equal(list[0].tokens, undefined);
  assert.deepEqual(await store.listConnections('u2'), []);
});

test('çözülemeyen token bağlantıyı yeniden bağlanma durumuna düşürür', async () => {
  const { db, store } = setup();
  await store.saveConnection('u1', 'notion', { tokens: { access_token: 'x' } });
  const key = [...db.docs.keys()].find(path => path.startsWith('connector_connections/'));
  db.docs.set(key, { ...db.docs.get(key), tokens: 'v1.bozuk.veri' });
  const connection = await store.getConnection('u1', 'notion');
  assert.equal(connection.tokens, null);
  assert.equal(connection.status, 'reauth');
});

test('güncelleme oluşturma tarihini ve araç önbelleğini korur, silme bağlantıyı kaldırır', async () => {
  const { store, tick } = setup();
  await store.saveConnection('u1', 'notion', { tokens: { access_token: 'a' }, tools: [{ name: 'search' }] });
  const created = (await store.getConnection('u1', 'notion')).createdAt;
  tick(5000);
  await store.saveConnection('u1', 'notion', { tokens: { access_token: 'b' } });
  const updated = await store.getConnection('u1', 'notion');
  assert.equal(updated.createdAt, created);
  assert.deepEqual(updated.tools, [{ name: 'search' }]);
  assert.equal(updated.tokens.access_token, 'b');
  await store.deleteConnection('u1', 'notion');
  assert.equal(await store.getConnection('u1', 'notion'), null);
});

test('katalog: anahtar ve istemci bilgisi olmadan bağlayıcı kapalıdır', () => {
  const google = getConnector('google_calendar');
  const notion = getConnector('notion');
  assert.equal(availability(google, {}).available, false);
  const base = { CONNECTOR_TOKEN_KEY: 'k', PUBLIC_BACKEND_URL: 'https://api.test' };
  assert.equal(availability(notion, base).available, true);
  assert.equal(availability(google, base).available, false);
  assert.equal(availability(google, { ...base, GOOGLE_OAUTH_CLIENT_ID: 'id', GOOGLE_OAUTH_CLIENT_SECRET: 's' }).available, true);
  assert.equal(availability(notion, { ...base, CONNECTORS_DISABLED: 'github, notion' }).available, false);
  assert.equal(getConnector('gmail'), null);
});

test('katalog: kimlikler benzersiz, Gmail yok, GitHub kapsamı env ile değişir', () => {
  const ids = CONNECTORS.map(connector => connector.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every(id => /^[a-z0-9_]+$/.test(id)));
  assert.ok(!ids.some(id => id.includes('gmail')));
  assert.deepEqual(scopesFor(getConnector('github'), {}), ['repo', 'read:org']);
  assert.deepEqual(scopesFor(getConnector('github'), { GITHUB_OAUTH_SCOPES: 'public_repo read:user' }), ['public_repo', 'read:user']);
});
