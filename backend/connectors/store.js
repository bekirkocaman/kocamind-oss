// Bağlayıcı verisinin Firestore'daki yeri. Üç koleksiyon da firestore.rules'taki
// catch-all deny kuralıyla istemciye kapalıdır; yalnızca Admin SDK (backend) erişir.
//   connector_connections/{uid}__{connectorId}  bağlantı + şifreli token + araç önbelleği
//   connector_oauth_states/{state}              10 dk ömürlü OAuth durumu (tek kullanımlık)
//   connector_clients/{connectorId}             keşif metadatası + dinamik istemci kaydı
const STATE_TTL_MS = 10 * 60 * 1000;

function connectionId(uid, connectorId) {
  return `${uid}__${connectorId}`;
}

function createConnectorStore({ firestoreDb, cipher, now = () => Date.now() }) {
  const connections = () => firestoreDb.collection('connector_connections');
  const states = () => firestoreDb.collection('connector_oauth_states');
  const clients = () => firestoreDb.collection('connector_clients');

  // PKCE doğrulayıcısı da şifreli saklanır.
  async function saveState(state, { uid, connectorId, codeVerifier, client = 'web' }) {
    await states().doc(state).set({ uid, connectorId, client, secret: cipher.encrypt({ codeVerifier }), expiresAt: now() + STATE_TTL_MS });
  }

  // Durumu okur ve aynı işlemde siler: aynı state ikinci kez kullanılamaz.
  async function takeState(state) {
    if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{20,128}$/.test(state)) return null;
    const ref = states().doc(state);
    const data = await firestoreDb.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return null;
      transaction.delete(ref);
      return snapshot.data();
    });
    if (!data || Number(data.expiresAt) < now()) return null;
    const { codeVerifier } = cipher.decrypt(data.secret);
    return { ...data, codeVerifier };
  }

  async function getConnection(uid, connectorId) {
    const snapshot = await connections().doc(connectionId(uid, connectorId)).get();
    if (!snapshot.exists) return null;
    const data = snapshot.data();
    let tokens = null;
    try {
      tokens = data.tokens ? cipher.decrypt(data.tokens) : null;
    } catch {
      // Anahtar değiştiyse ya da veri bozulduysa kullanıcı yeniden bağlanmalı.
      tokens = null;
    }
    return { ...data, tokens, status: tokens ? data.status : 'reauth' };
  }

  async function listConnections(uid) {
    const snapshot = await connections().where('uid', '==', uid).get();
    return snapshot.docs.map(doc => {
      const { tokens, ...rest } = doc.data();
      return rest;
    });
  }

  async function saveConnection(uid, connectorId, { tokens, tools, status = 'active', createdAt }) {
    const at = new Date(now()).toISOString();
    const data = { uid, connectorId, status, updatedAt: at, createdAt: createdAt || at };
    if (tokens !== undefined) data.tokens = cipher.encrypt(tokens);
    if (tools !== undefined) {
      data.tools = tools;
      data.toolsFetchedAt = at;
    }
    const ref = connections().doc(connectionId(uid, connectorId));
    const existing = await ref.get();
    await ref.set(existing.exists ? { ...existing.data(), ...data, createdAt: existing.data().createdAt || data.createdAt } : data);
  }

  async function setStatus(uid, connectorId, status) {
    const ref = connections().doc(connectionId(uid, connectorId));
    const existing = await ref.get();
    if (existing.exists) await ref.set({ ...existing.data(), status, updatedAt: new Date(now()).toISOString() });
  }

  async function deleteConnection(uid, connectorId) {
    await connections().doc(connectionId(uid, connectorId)).delete();
  }

  async function getClient(connectorId) {
    const snapshot = await clients().doc(connectorId).get();
    if (!snapshot.exists) return null;
    const data = snapshot.data();
    return { ...data, clientInformation: data.clientInformation ? cipher.decrypt(data.clientInformation) : null };
  }

  async function saveClient(connectorId, { serverInfo, clientInformation, redirectUrl }) {
    await clients().doc(connectorId).set({
      connectorId,
      serverInfo,
      redirectUrl,
      clientInformation: cipher.encrypt(clientInformation),
      updatedAt: new Date(now()).toISOString(),
    });
  }

  return { saveState, takeState, getConnection, listConnections, saveConnection, setStatus, deleteConnection, getClient, saveClient };
}

module.exports = { createConnectorStore, connectionId, STATE_TTL_MS };
