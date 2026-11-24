// Bağlayıcı yöneticisi: bağlanma/kesme, OAuth callback ve kullanıcının bağlı
// hesaplarındaki araçları modele verilebilecek araç tanımlarına çevirme.
const { z } = require('zod');
const { CONNECTORS, getConnector, availability } = require('./catalog');
const { createTokenCipher } = require('./crypto');
const { createConnectorStore } = require('./store');
const { createOAuth } = require('./oauth');
const { createRemoteMcp, ConnectorAuthError } = require('./remoteMcp');
const { createGoogleCalendar, createGoogleDrive } = require('./google');

const MAX_ARGUMENT_CHARS = 20000;
const MAX_OUTPUT_CHARS = 12000;
const REAUTH_MESSAGE = 'Bu hesabın bağlantı süresi doldu. Ayarlar > Bağlantılar bölümünden yeniden bağlan.';

class ConnectorError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Model araç adları [a-zA-Z0-9_-] ve en fazla 64 karakter olmalı.
function toolName(connectorId, name) {
  const clean = String(name).replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'tool';
  return `${connectorId}__${clean}`.slice(0, 64);
}

function objectSchema(schema) {
  const base = schema && typeof schema === 'object' && !Array.isArray(schema) ? schema : {};
  return { ...base, type: 'object', properties: base.properties && typeof base.properties === 'object' ? base.properties : {} };
}

function createConnectorManager({ env = process.env, firestoreDb, fetchFn, hasActivePlus = async () => false, oauth: injectedOAuth, drivers: injectedDrivers, now = () => Date.now() } = {}) {
  const cipher = createTokenCipher(env.CONNECTOR_TOKEN_KEY);
  const enabled = Boolean(cipher && firestoreDb);
  const store = enabled ? createConnectorStore({ firestoreDb, cipher, now }) : null;
  const oauth = injectedOAuth || (enabled ? createOAuth({ env, store, fetchFn, now }) : null);
  const drivers = injectedDrivers || {
    remote: createRemoteMcp({ fetchFn }),
    builtin: { googleCalendar: createGoogleCalendar({ fetchFn }), googleDrive: createGoogleDrive({ fetchFn }) },
  };
  const driverFor = connector => (connector.kind === 'builtin' ? drivers.builtin[connector.builtin] : drivers.remote);
  const isAvailable = connector => availability(connector, env).available && Boolean(driverFor(connector));

  async function allowedFor(uid) {
    if (String(env.CONNECTORS_FREE).toLowerCase() === 'true') return true;
    try {
      return await hasActivePlus(uid);
    } catch {
      return false;
    }
  }

  function requireEnabled() {
    if (!enabled) throw new ConnectorError('disabled', 'Bağlantılar şu anda kapalı.');
  }

  async function catalogFor(uid) {
    const connections = enabled ? await store.listConnections(uid) : [];
    const byId = new Map(connections.map(connection => [connection.connectorId, connection]));
    return {
      enabled,
      plusRequired: String(env.CONNECTORS_FREE).toLowerCase() !== 'true',
      allowed: await allowedFor(uid),
      connectors: CONNECTORS.map(connector => {
        const connection = byId.get(connector.id);
        return {
          id: connector.id,
          label: connector.label,
          description: connector.description,
          available: enabled && isAvailable(connector),
          connected: Boolean(connection),
          status: connection?.status || null,
          connectedAt: connection?.createdAt || null,
          toolCount: Array.isArray(connection?.tools) ? connection.tools.length : 0,
        };
      }),
    };
  }

  // client: OAuth bitince kullanıcının döneceği yer ('web' ya da 'android').
  async function startConnect(uid, connectorId, { client = 'web' } = {}) {
    requireEnabled();
    const connector = getConnector(connectorId);
    if (!connector) throw new ConnectorError('not_found', 'Böyle bir bağlantı yok.');
    if (!isAvailable(connector)) throw new ConnectorError('unavailable', `${connector.label} bağlantısı henüz yapılandırılmadı.`);
    if (!(await allowedFor(uid))) throw new ConnectorError('plus_required', 'Bağlantılar Plus aboneliğinde kullanılabilir.');
    const { url, state, codeVerifier } = await oauth.authorizationUrl(connector);
    await store.saveState(state, { uid, connectorId, codeVerifier, client: client === 'android' ? 'android' : 'web' });
    return { authUrl: url };
  }

  async function finishConnect({ code, state, error }) {
    requireEnabled();
    const saved = await store.takeState(state);
    if (!saved) throw new ConnectorError('invalid_state', 'Bağlantı isteğinin süresi dolmuş, tekrar dene.');
    const client = saved.client === 'android' ? 'android' : 'web';
    try {
      if (error || !code) throw new ConnectorError('denied', 'Bağlantı izni verilmedi.');
      const connector = getConnector(saved.connectorId);
      if (!connector || !isAvailable(connector)) throw new ConnectorError('unavailable', 'Bu bağlantı artık kullanılamıyor.');
      const tokens = await oauth.exchangeCode(connector, { code, codeVerifier: saved.codeVerifier });
      const tools = await driverFor(connector).listTools(connector, tokens.access_token);
      await store.saveConnection(saved.uid, connector.id, {
        tokens,
        status: 'active',
        tools: tools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: objectSchema(tool.inputSchema), readOnly: tool.readOnly === true })),
      });
      return { uid: saved.uid, connectorId: connector.id, client };
    } catch (failure) {
      // Callback hatada da kullanıcıyı başladığı yere (uygulama ya da web) döndürebilsin.
      failure.client = client;
      throw failure;
    }
  }

  async function disconnect(uid, connectorId) {
    requireEnabled();
    const connector = getConnector(connectorId);
    const connection = await store.getConnection(uid, connectorId);
    if (connector && connection?.tokens) await oauth.revoke(connector, connection.tokens);
    await store.deleteConnection(uid, connectorId);
  }

  async function freshTokens(connector, uid, tokens, { force = false } = {}) {
    if (!force && !oauth.needsRefresh(tokens)) return tokens;
    const refreshed = await oauth.refresh(connector, tokens).catch(() => null);
    if (!refreshed) return null;
    await store.saveConnection(uid, connector.id, { tokens: refreshed, status: 'active' });
    return refreshed;
  }

  async function markReauth(uid, connectorId) {
    await store.setStatus(uid, connectorId, 'reauth').catch(() => {});
    return { error: REAUTH_MESSAGE };
  }

  async function callTool(uid, connector, name, args) {
    if (JSON.stringify(args || {}).length > MAX_ARGUMENT_CHARS) return { error: 'Araç parametreleri çok büyük.' };
    const connection = await store.getConnection(uid, connector.id);
    if (!connection?.tokens || connection.status === 'reauth') return markReauth(uid, connector.id);
    let tokens = await freshTokens(connector, uid, connection.tokens);
    if (!tokens) return markReauth(uid, connector.id);
    const driver = driverFor(connector);
    let result;
    try {
      result = await driver.callTool(connector, tokens.access_token, name, args);
    } catch (error) {
      if (!(error instanceof ConnectorAuthError)) throw error;
      tokens = await freshTokens(connector, uid, tokens, { force: true });
      if (!tokens) return markReauth(uid, connector.id);
      try {
        result = await driver.callTool(connector, tokens.access_token, name, args);
      } catch (retryError) {
        if (retryError instanceof ConnectorAuthError) return markReauth(uid, connector.id);
        throw retryError;
      }
    }
    const text = String(result.text || '');
    const content = text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS)}…(kısaltıldı)` : text;
    // Dış servisten gelen içerik veridir; içindeki talimatlar uygulanmaz.
    return result.isError
      ? { source: connector.label, error: content || 'Araç hata döndürdü.', untrustedContent: true }
      : { source: connector.label, content, untrustedContent: true };
  }

  // Kullanıcının etkin bağlantılarındaki araçlar → ToolRegistry ek araç tanımları.
  async function toolDefinitionsFor(uid) {
    if (!enabled || !uid) return [];
    if (!(await allowedFor(uid))) return [];
    const connections = await store.listConnections(uid);
    const definitions = [];
    const seen = new Set();
    for (const connection of connections) {
      const connector = getConnector(connection.connectorId);
      if (!connector || connection.status !== 'active' || !isAvailable(connector)) continue;
      for (const tool of connection.tools || []) {
        const name = toolName(connector.id, tool.name);
        if (seen.has(name)) continue;
        seen.add(name);
        const readOnly = tool.readOnly === true;
        definitions.push({
          name,
          description: `[${connector.label}] ${tool.description}`.slice(0, 1024),
          riskLevel: readOnly ? 'low' : 'high',
          requiresConfirmation: !readOnly,
          confirmationSummary: () => `${connector.label}: "${tool.name}" işlemi hesabında çalıştırılacak.`,
          timeoutMs: 20000,
          strict: false,
          connectorId: connector.id,
          inputSchema: z.record(z.string(), z.unknown()),
          jsonSchema: objectSchema(tool.inputSchema),
          execute: async (args, context = {}) => {
            if (context.userId !== uid) throw new Error('Araç başka bir kullanıcının bağlamında çalıştırılamaz.');
            return callTool(uid, connector, tool.name, args);
          },
        });
      }
    }
    return definitions;
  }

  // Sohbet prompt'u için bağlı servis adları.
  async function connectedLabels(uid) {
    if (!enabled || !uid) return [];
    const connections = await store.listConnections(uid);
    return connections
      .filter(connection => connection.status === 'active')
      .map(connection => getConnector(connection.connectorId)?.label)
      .filter(Boolean);
  }

  return { enabled, catalogFor, startConnect, finishConnect, disconnect, toolDefinitionsFor, connectedLabels };
}

module.exports = { createConnectorManager, ConnectorError, toolName, REAUTH_MESSAGE };
