// Bağlayıcılar için OAuth 2 (PKCE) akışı. Token istekleri MCP SDK'nın OAuth
// yardımcılarıyla yapılır; statik sağlayıcılarda (Google, GitHub) metadata elle verilir,
// uzak MCP sunucularında keşif + dinamik istemci kaydı kullanılır.
const crypto = require('crypto');
const { scopesFor } = require('./catalog');

function callbackUrl(env) {
  return `${String(env.PUBLIC_BACKEND_URL || '').replace(/\/+$/, '')}/connectors/callback`;
}

function newState() {
  return crypto.randomBytes(32).toString('base64url');
}

function hostMatches(rawUrl, suffix) {
  try {
    const { protocol, hostname } = new URL(rawUrl);
    return protocol === 'https:' && (hostname === suffix || hostname.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}

function staticServer(connector, env) {
  const { auth } = connector;
  return {
    authorizationServerUrl: new URL(auth.tokenEndpoint).origin,
    metadata: {
      issuer: new URL(auth.authorizationEndpoint).origin,
      authorization_endpoint: auth.authorizationEndpoint,
      token_endpoint: auth.tokenEndpoint,
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_post'],
    },
    clientInformation: { client_id: env[auth.clientIdEnv], client_secret: env[auth.clientSecretEnv] },
    resource: undefined,
  };
}

function createOAuth({ env = process.env, store, fetchFn, sdkAuth = require('@modelcontextprotocol/sdk/client/auth.js'), now = () => Date.now() }) {
  // Uzak MCP sunucusunun yetkilendirme sunucusunu keşfeder. Sonuç (ve dinamik
  // istemci kaydı) bütün kullanıcılar için saklanır ve yeniden kullanılır.
  async function discoveredServer(connector) {
    const redirectUrl = callbackUrl(env);
    const cached = await store.getClient(connector.id);
    if (cached?.clientInformation && cached.redirectUrl === redirectUrl) {
      return { ...cached.serverInfo, clientInformation: cached.clientInformation };
    }
    const info = await sdkAuth.discoverOAuthServerInfo(connector.url, { fetchFn });
    const metadata = info.authorizationServerMetadata;
    const suffix = connector.auth.authHostSuffix;
    const trusted = [info.authorizationServerUrl, metadata?.authorization_endpoint, metadata?.token_endpoint, metadata?.registration_endpoint]
      .filter(Boolean)
      .every(url => hostMatches(url, suffix));
    if (!metadata || !trusted) throw new Error(`${connector.label} yetkilendirme sunucusu beklenen alan adında değil.`);
    const clientInformation = await sdkAuth.registerClient(info.authorizationServerUrl, {
      metadata,
      clientMetadata: {
        client_name: 'KocaMind',
        redirect_uris: [redirectUrl],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
      fetchFn,
    });
    const serverInfo = {
      authorizationServerUrl: info.authorizationServerUrl,
      metadata,
      resource: info.resourceMetadata?.resource || connector.url,
    };
    await store.saveClient(connector.id, { serverInfo, clientInformation, redirectUrl });
    return { ...serverInfo, clientInformation };
  }

  async function serverFor(connector) {
    return connector.auth.type === 'static' ? staticServer(connector, env) : discoveredServer(connector);
  }

  async function authorizationUrl(connector) {
    const server = await serverFor(connector);
    const state = newState();
    const scopes = scopesFor(connector, env);
    const { authorizationUrl: url, codeVerifier } = await sdkAuth.startAuthorization(server.authorizationServerUrl, {
      metadata: server.metadata,
      clientInformation: server.clientInformation,
      redirectUrl: callbackUrl(env),
      scope: scopes.length ? scopes.join(' ') : undefined,
      state,
      resource: server.resource,
    });
    for (const [key, value] of Object.entries(connector.auth.extraAuthParams || {})) url.searchParams.set(key, value);
    return { url: url.toString(), state, codeVerifier };
  }

  function withExpiry(tokens, previous = {}) {
    return {
      ...tokens,
      refresh_token: tokens.refresh_token || previous.refresh_token,
      expires_at: tokens.expires_in ? now() + Number(tokens.expires_in) * 1000 : null,
    };
  }

  async function exchangeCode(connector, { code, codeVerifier }) {
    const server = await serverFor(connector);
    const tokens = await sdkAuth.exchangeAuthorization(server.authorizationServerUrl, {
      metadata: server.metadata,
      clientInformation: server.clientInformation,
      authorizationCode: code,
      codeVerifier,
      redirectUri: callbackUrl(env),
      resource: server.resource,
      fetchFn,
    });
    return withExpiry(tokens);
  }

  // Süresi bitmek üzere olan tokenı yeniler. Yenileme tokenı yoksa null döner.
  async function refresh(connector, tokens) {
    if (!tokens?.refresh_token) return null;
    const server = await serverFor(connector);
    const fresh = await sdkAuth.refreshAuthorization(server.authorizationServerUrl, {
      metadata: server.metadata,
      clientInformation: server.clientInformation,
      refreshToken: tokens.refresh_token,
      resource: server.resource,
      fetchFn,
    });
    return withExpiry(fresh, tokens);
  }

  function needsRefresh(tokens) {
    return Boolean(tokens?.expires_at) && tokens.expires_at - now() < 60 * 1000;
  }

  // Bağlantı kesilince token sağlayıcıda da iptal edilir (destekleniyorsa). Hata yutulur.
  async function revoke(connector, tokens) {
    const endpoint = connector.auth.revocationEndpoint;
    const token = tokens?.refresh_token || tokens?.access_token;
    if (!endpoint || !token) return false;
    try {
      const response = await (fetchFn || fetch)(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }).toString(),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  return { authorizationUrl, exchangeCode, refresh, needsRefresh, revoke };
}

module.exports = { createOAuth, callbackUrl, hostMatches };
