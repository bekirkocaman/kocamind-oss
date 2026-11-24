const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const MAX_INVALID_CALLBACKS = 20;
const SUCCESS_HTML = '<!doctype html><meta charset="utf-8"><title>KocaMind IDE</title><p>Giriş tamamlandı, bu sekmeyi kapatabilirsin.</p>';
const ERROR_HTML = '<!doctype html><meta charset="utf-8"><title>KocaMind IDE</title><p>Giriş tamamlanamadı.</p>';

function timingSafeEqualStrings(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function parseJwtPayload(jwt) {
  if (typeof jwt !== 'string') return {};
  const parts = jwt.split('.');
  if (parts.length < 2) return {};
  try {
    const raw = Buffer.from(parts[1], 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function removeFileQuietly(filePath) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Sessizce geç
  }
}

function createAuth({
  apiBaseUrl,
  webBaseUrl,
  firebaseApiKey,
  storagePath,
  safeStorage,
  openExternal,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  loginTimeoutMs = 300000,
} = {}) {
  const cleanApiBase = String(apiBaseUrl || '').replace(/\/+$/, '');
  const cleanWebBase = String(webBaseUrl || '').replace(/\/+$/, '');
  let session = null;
  let initialLoadDone = false;
  let loginInProgress = false;

  function canEncrypt() {
    try {
      return Boolean(safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable());
    } catch {
      return false;
    }
  }

  function persistSession(nextSession) {
    if (!storagePath || !canEncrypt()) {
      return false;
    }
    try {
      const dir = path.dirname(storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const payload = JSON.stringify({
        refreshToken: nextSession.refreshToken,
        uid: nextSession.uid,
        email: nextSession.email,
      });
      const encrypted = safeStorage.encryptString(payload);
      fs.writeFileSync(storagePath, encrypted);
      return true;
    } catch {
      return false;
    }
  }

  function ensureSessionLoaded() {
    if (initialLoadDone) return;
    if (!storagePath || !fs.existsSync(storagePath)) {
      initialLoadDone = true;
      return;
    }
    if (!canEncrypt()) {
      return;
    }
    initialLoadDone = true;
    try {
      const encrypted = fs.readFileSync(storagePath);
      const decrypted = safeStorage.decryptString(encrypted);
      const parsed = JSON.parse(decrypted);
      if (
        !parsed
        || typeof parsed !== 'object'
        || typeof parsed.refreshToken !== 'string'
        || !parsed.refreshToken
      ) {
        removeFileQuietly(storagePath);
        return;
      }
      session = {
        refreshToken: parsed.refreshToken,
        uid: typeof parsed.uid === 'string' ? parsed.uid : null,
        email: typeof parsed.email === 'string' ? parsed.email : null,
        idToken: null,
        expiresAt: 0,
        persisted: true,
      };
    } catch {
      removeFileQuietly(storagePath);
      session = null;
    }
  }

  function logout() {
    ensureSessionLoaded();
    session = null;
    initialLoadDone = true;
    removeFileQuietly(storagePath);
  }

  function isLoggedIn() {
    ensureSessionLoaded();
    return Boolean(session && (session.refreshToken || session.idToken));
  }

  function getUser() {
    if (!isLoggedIn()) return null;
    return {
      uid: session.uid,
      email: session.email,
      persisted: Boolean(session.persisted),
    };
  }

  async function getIdToken() {
    if (!isLoggedIn()) return null;
    if (session.idToken && session.expiresAt - now() >= FIVE_MINUTES_MS) {
      return session.idToken;
    }
    if (!session.refreshToken) return null;

    try {
      const url = `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(firebaseApiKey || '')}`;
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: session.refreshToken,
      }).toString();

      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });

      if (res.status === 400 || res.status === 401) {
        logout();
        return null;
      }
      if (!res.ok) {
        return null;
      }

      const data = await res.json().catch(() => ({}));
      const newIdToken = data.id_token || data.idToken;
      const newRefreshToken = data.refresh_token || data.refreshToken || session.refreshToken;
      const expiresInSec = Number(data.expires_in || data.expiresIn) || 3600;

      if (typeof newIdToken !== 'string' || !newIdToken) {
        return null;
      }

      const jwtClaims = parseJwtPayload(newIdToken);
      session.idToken = newIdToken;
      session.refreshToken = newRefreshToken;
      session.expiresAt = now() + expiresInSec * 1000;
      if (!session.uid) {
        session.uid = data.user_id || data.userId || jwtClaims.user_id || jwtClaims.sub || null;
      }
      if (!session.email && typeof jwtClaims.email === 'string') {
        session.email = jwtClaims.email;
      }
      if (session.persisted) {
        persistSession(session);
      }
      return session.idToken;
    } catch {
      return null;
    }
  }

  async function login() {
    ensureSessionLoaded();
    if (loginInProgress) {
      return { error: 'Giriş zaten sürüyor.' };
    }
    loginInProgress = true;

    const expectedState = crypto.randomBytes(32).toString('base64url');

    try {
      let openExternalPromise = null;
      const callbackResult = await new Promise((resolve) => {
        let settled = false;
        let timer = null;
        let invalidCallbackCount = 0;

        const finish = (outcome, { forceClose = false } = {}) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          try {
            server.close();
            if (forceClose) {
              server.closeAllConnections?.();
            }
          } catch {
            // Sessizce geç
          }
          resolve(outcome);
        };

        const server = http.createServer((req, res) => {
          let parsedUrl;
          try {
            parsedUrl = new URL(req.url || '/', 'http://127.0.0.1');
          } catch {
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' });
            res.end('Geçersiz istek');
            return;
          }

          if (req.method !== 'GET' || parsedUrl.pathname !== '/callback') {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' });
            res.end('Bulunamadı');
            return;
          }

          const code = parsedUrl.searchParams.get('code') || '';
          const state = parsedUrl.searchParams.get('state') || '';

          if (!code || !timingSafeEqualStrings(state, expectedState)) {
            invalidCallbackCount += 1;
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' });
            if (invalidCallbackCount >= MAX_INVALID_CALLBACKS) {
              res.end(ERROR_HTML, () => {
                finish({ error: 'Giriş tamamlanamadı.' }, { forceClose: true });
              });
            } else {
              res.end(ERROR_HTML);
            }
            return;
          }

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' });
          res.end(SUCCESS_HTML, () => {
            finish({ code });
          });
        });

        server.on('error', () => {
          finish({ error: 'Yerel giriş sunucusu başlatılamadı.' });
        });

        server.listen(0, '127.0.0.1', () => {
          const address = server.address();
          const port = typeof address === 'object' && address ? address.port : null;
          if (!port) {
            finish({ error: 'Yerel giriş sunucusu başlatılamadı.' });
            return;
          }

          timer = setTimeout(() => {
            finish({ error: 'Giriş zaman aşımına uğradı.' }, { forceClose: true });
          }, loginTimeoutMs);

          const loginUrl = `${cleanWebBase}/?${new URLSearchParams({
            ide_giris: expectedState,
            port: String(port),
          }).toString()}`;

          openExternalPromise = Promise.resolve()
            .then(() => openExternal(loginUrl))
            .catch(() => {
              finish({ error: 'Tarayıcı açılamadı.' }, { forceClose: true });
            });
        });
      });

      if (openExternalPromise) {
        await Promise.race([
          openExternalPromise,
          new Promise((r) => setTimeout(r, 50)),
        ]);
      }

      if (callbackResult.error) {
        return { error: callbackResult.error };
      }

      const exchangeRes = await fetchImpl(`${cleanApiBase}/ide/auth/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: callbackResult.code, state: expectedState }),
      });
      const exchangeData = await exchangeRes.json().catch(() => ({}));
      if (!exchangeRes.ok || typeof exchangeData?.customToken !== 'string' || !exchangeData.customToken) {
        return { error: 'Giriş kodu doğrulanamadı.' };
      }

      const signInUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(firebaseApiKey || '')}`;
      const signInRes = await fetchImpl(signInUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: exchangeData.customToken,
          returnSecureToken: true,
        }),
      });
      const signInData = await signInRes.json().catch(() => ({}));
      if (
        !signInRes.ok
        || typeof signInData?.idToken !== 'string'
        || !signInData.idToken
        || typeof signInData?.refreshToken !== 'string'
        || !signInData.refreshToken
      ) {
        return { error: 'Oturum açılamadı.' };
      }

      const jwtClaims = parseJwtPayload(signInData.idToken);
      const uid = signInData.localId || jwtClaims.user_id || jwtClaims.sub || '';
      const email = signInData.email || jwtClaims.email || null;
      const expiresInSec = Number(signInData.expiresIn) || 3600;

      const nextSession = {
        idToken: signInData.idToken,
        refreshToken: signInData.refreshToken,
        uid,
        email,
        expiresAt: now() + expiresInSec * 1000,
        persisted: false,
      };
      nextSession.persisted = persistSession(nextSession);
      session = nextSession;
      initialLoadDone = true;

      return {
        ok: true,
        user: {
          uid: session.uid,
          email: session.email,
        },
      };
    } catch {
      return { error: 'Giriş tamamlanamadı.' };
    } finally {
      loginInProgress = false;
    }
  }

  return {
    login,
    logout,
    getIdToken,
    getUser,
    isLoggedIn,
  };
}

module.exports = { createAuth };
