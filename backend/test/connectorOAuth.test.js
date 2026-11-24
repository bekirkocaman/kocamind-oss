const test = require('node:test');
const assert = require('node:assert/strict');
const { createOAuth, hostMatches } = require('../connectors/oauth');
const { getConnector } = require('../connectors/catalog');

const env = {
  PUBLIC_BACKEND_URL: 'https://api.kocamind.test/',
  GOOGLE_OAUTH_CLIENT_ID: 'google-id',
  GOOGLE_OAUTH_CLIENT_SECRET: 'google-secret',
};

function memoryClientStore() {
  const clients = new Map();
  return {
    clients,
    getClient: async id => clients.get(id) || null,
    saveClient: async (id, value) => { clients.set(id, value); },
  };
}

test('Google yetkilendirme adresi PKCE, state, kapsam ve çevrimdışı erişim içerir', async () => {
  const oauth = createOAuth({ env, store: memoryClientStore() });
  const { url, state, codeVerifier } = await oauth.authorizationUrl(getConnector('google_calendar'));
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(parsed.searchParams.get('client_id'), 'google-id');
  assert.equal(parsed.searchParams.get('redirect_uri'), 'https://api.kocamind.test/connectors/callback');
  assert.equal(parsed.searchParams.get('state'), state);
  assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(parsed.searchParams.get('scope'), 'https://www.googleapis.com/auth/calendar.events');
  assert.equal(parsed.searchParams.get('access_type'), 'offline');
  assert.equal(parsed.searchParams.get('resource'), null);
  assert.ok(codeVerifier.length >= 43);
  assert.ok(state.length >= 40);
  assert.doesNotMatch(url, /google-secret/);
});

test('kod token ile değişir; bitiş zamanı hesaplanır; yenilemede eski refresh token korunur', async () => {
  const requests = [];
  const fetchFn = async (url, init) => {
    requests.push({ url: String(url), body: String(init.body) });
    const body = String(init.body).includes('grant_type=refresh_token')
      ? { access_token: 'yeni', token_type: 'Bearer', expires_in: 3600 }
      : { access_token: 'ilk', refresh_token: 'yenileme', token_type: 'Bearer', expires_in: 3600 };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const oauth = createOAuth({ env, store: memoryClientStore(), fetchFn, now: () => 1000 });
  const connector = getConnector('google_calendar');
  const tokens = await oauth.exchangeCode(connector, { code: 'kod-1', codeVerifier: 'v'.repeat(43) });
  assert.equal(tokens.access_token, 'ilk');
  assert.equal(tokens.expires_at, 1000 + 3600 * 1000);
  assert.equal(requests[0].url, 'https://oauth2.googleapis.com/token');
  assert.match(requests[0].body, /code=kod-1/);
  assert.match(requests[0].body, /client_secret=google-secret/);
  assert.match(requests[0].body, /code_verifier=v+/);
  const refreshed = await oauth.refresh(connector, tokens);
  assert.equal(refreshed.access_token, 'yeni');
  assert.equal(refreshed.refresh_token, 'yenileme');
  assert.equal(await oauth.refresh(connector, { access_token: 'x' }), null);
});

test('needsRefresh son bir dakikada true döner', () => {
  const oauth = createOAuth({ env, store: memoryClientStore(), now: () => 10_000 });
  assert.equal(oauth.needsRefresh({ expires_at: 10_000 + 30_000 }), true);
  assert.equal(oauth.needsRefresh({ expires_at: 10_000 + 600_000 }), false);
  assert.equal(oauth.needsRefresh({ expires_at: null }), false);
});

function fakeSdk(authServer) {
  const calls = { register: 0 };
  return {
    calls,
    discoverOAuthServerInfo: async () => ({
      authorizationServerUrl: authServer,
      authorizationServerMetadata: {
        issuer: authServer,
        authorization_endpoint: `${authServer}/authorize`,
        token_endpoint: `${authServer}/token`,
        registration_endpoint: `${authServer}/register`,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
      },
      resourceMetadata: { resource: 'https://mcp.notion.com/mcp' },
    }),
    registerClient: async () => { calls.register += 1; return { client_id: 'dcr-id' }; },
    startAuthorization: async (server, { state, resource }) => ({
      authorizationUrl: new URL(`${server}/authorize?state=${state}&resource=${encodeURIComponent(resource)}`),
      codeVerifier: 'v'.repeat(43),
    }),
  };
}

test('uzak MCP: keşif + dinamik kayıt bir kez yapılır ve saklanır', async () => {
  const sdkAuth = fakeSdk('https://mcp.notion.com');
  const store = memoryClientStore();
  const oauth = createOAuth({ env, store, sdkAuth });
  const first = await oauth.authorizationUrl(getConnector('notion'));
  await oauth.authorizationUrl(getConnector('notion'));
  assert.equal(sdkAuth.calls.register, 1);
  assert.match(first.url, /resource=https%3A%2F%2Fmcp\.notion\.com%2Fmcp/);
  assert.equal(store.clients.get('notion').clientInformation.client_id, 'dcr-id');
});

test('uzak MCP: yetkilendirme sunucusu beklenen alan adında değilse reddedilir', async () => {
  const sdkAuth = fakeSdk('https://kotu-niyetli.example');
  const oauth = createOAuth({ env, store: memoryClientStore(), sdkAuth });
  await assert.rejects(() => oauth.authorizationUrl(getConnector('notion')), /beklenen alan adında değil/);
  assert.equal(sdkAuth.calls.register, 0);
});

test('hostMatches yalnızca https ve tam alt alan adı eşleşmesini kabul eder', () => {
  assert.equal(hostMatches('https://mcp.notion.com/x', 'notion.com'), true);
  assert.equal(hostMatches('https://notion.com', 'notion.com'), true);
  assert.equal(hostMatches('https://evilnotion.com', 'notion.com'), false);
  assert.equal(hostMatches('http://mcp.notion.com', 'notion.com'), false);
  assert.equal(hostMatches('saçma', 'notion.com'), false);
});
