const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createAuth } = require('../auth.cjs');

function makeTempStoragePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kocamind-auth-test-'));
  return {
    dir,
    storagePath: path.join(dir, 'auth.bin'),
    cleanup: () => {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    },
  };
}

function makeFakeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

function makeFakeSafeStorage({ available = true } = {}) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (str) => Buffer.from(`enc:${Buffer.from(str, 'utf8').toString('base64')}`, 'utf8'),
    decryptString: (buf) => {
      const text = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf);
      if (!text.startsWith('enc:')) throw new Error('Corrupted encrypted data');
      return Buffer.from(text.slice(4), 'base64').toString('utf8');
    },
  };
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    }).on('error', reject);
  });
}

describe('electron/auth.cjs', () => {
  it('1. tam akış: login() -> callback -> exchange -> signInWithCustomToken; sonuç ok, dosya şifreli yazılır', async () => {
    const tmp = makeTempStoragePath();
    try {
      const idToken = makeFakeJwt({ sub: 'uid-1', email: 'test@kocamind.com' });
      const fetchCalls = [];
      const fetchImpl = async (url, options = {}) => {
        fetchCalls.push({ url, options });
        if (url === 'https://api.kocamind.com/ide/auth/exchange') {
          return {
            ok: true,
            status: 200,
            json: async () => ({ customToken: 'custom-tok-secret-1' }),
          };
        }
        if (url.startsWith('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              idToken,
              refreshToken: 'refresh-tok-secret-1',
              expiresIn: '3600',
              localId: 'uid-1',
            }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      };

      let callbackResponse = null;
      const auth = createAuth({
        apiBaseUrl: 'https://api.kocamind.com',
        webBaseUrl: 'https://kocamind.com',
        firebaseApiKey: 'test-firebase-key',
        storagePath: tmp.storagePath,
        safeStorage: makeFakeSafeStorage({ available: true }),
        fetchImpl,
        openExternal: async (loginUrl) => {
          const parsed = new URL(loginUrl);
          assert.equal(parsed.origin, 'https://kocamind.com');
          const state = parsed.searchParams.get('ide_giris');
          const port = parsed.searchParams.get('port');
          callbackResponse = await httpGet(
            `http://127.0.0.1:${port}/callback?code=one-time-code-xyz&state=${encodeURIComponent(state)}`
          );
        },
      });

      const result = await auth.login();
      assert.deepEqual(result, {
        ok: true,
        user: { uid: 'uid-1', email: 'test@kocamind.com' },
      });
      assert.equal(callbackResponse.statusCode, 200);
      assert.ok(callbackResponse.body.includes('Giriş tamamlandı, bu sekmeyi kapatabilirsin.'));
      assert.equal(auth.isLoggedIn(), true);
      assert.deepEqual(auth.getUser(), {
        uid: 'uid-1',
        email: 'test@kocamind.com',
        persisted: true,
      });

      assert.equal(fs.existsSync(tmp.storagePath), true);
      const rawDisk = fs.readFileSync(tmp.storagePath, 'utf8');
      assert.equal(rawDisk.includes('refresh-tok-secret-1'), false);
      assert.equal(rawDisk.startsWith('enc:'), true);
      assert.equal(fetchCalls.length, 2);
    } finally {
      tmp.cleanup();
    }
  });

  it('2. yanlış state ile callback 400 alır, giriş bitmez; zaman aşımında hata döner', async () => {
    const tmp = makeTempStoragePath();
    try {
      let callbackResponse = null;
      const auth = createAuth({
        apiBaseUrl: 'https://api.kocamind.com',
        webBaseUrl: 'https://kocamind.com',
        firebaseApiKey: 'test-firebase-key',
        storagePath: tmp.storagePath,
        safeStorage: makeFakeSafeStorage(),
        loginTimeoutMs: 200,
        fetchImpl: async () => { throw new Error('Should not call fetch on wrong state'); },
        openExternal: async (loginUrl) => {
          const parsed = new URL(loginUrl);
          const port = parsed.searchParams.get('port');
          callbackResponse = await httpGet(
            `http://127.0.0.1:${port}/callback?code=some-code&state=${'z'.repeat(43)}`
          );
        },
      });

      const result = await auth.login();
      assert.deepEqual(result, { error: 'Giriş zaman aşımına uğradı.' });
      assert.equal(callbackResponse.statusCode, 400);
      assert.ok(callbackResponse.body.includes('Giriş tamamlanamadı.'));
      assert.equal(auth.isLoggedIn(), false);
    } finally {
      tmp.cleanup();
    }
  });

  it('3. sunucu yalnızca 127.0.0.1\'de dinler; /callback dışı yol 404 döner', async () => {
    const tmp = makeTempStoragePath();
    try {
      let otherPathRes = null;
      const auth = createAuth({
        apiBaseUrl: 'https://api.kocamind.com',
        webBaseUrl: 'https://kocamind.com',
        firebaseApiKey: 'test-firebase-key',
        storagePath: tmp.storagePath,
        safeStorage: makeFakeSafeStorage(),
        fetchImpl: async (url) => {
          if (url.endsWith('/ide/auth/exchange')) {
            return { ok: true, status: 200, json: async () => ({ customToken: 'ct' }) };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              idToken: makeFakeJwt({ sub: 'u1', email: 'a@b.com' }),
              refreshToken: 'rt',
              expiresIn: '3600',
              localId: 'u1',
            }),
          };
        },
        openExternal: async (loginUrl) => {
          const parsed = new URL(loginUrl);
          const state = parsed.searchParams.get('ide_giris');
          const port = parsed.searchParams.get('port');
          otherPathRes = await httpGet(`http://127.0.0.1:${port}/other`);
          await httpGet(`http://127.0.0.1:${port}/callback?code=valid-code&state=${encodeURIComponent(state)}`);
        },
      });

      const res = await auth.login();
      assert.equal(otherPathRes.statusCode, 404);
      assert.equal(res.ok, true);
    } finally {
      tmp.cleanup();
    }
  });

  it('4. ikinci eş zamanlı login() "Giriş zaten sürüyor." döner', async () => {
    const tmp = makeTempStoragePath();
    try {
      let finishCallback;
      const auth = createAuth({
        apiBaseUrl: 'https://api.kocamind.com',
        webBaseUrl: 'https://kocamind.com',
        firebaseApiKey: 'test-firebase-key',
        storagePath: tmp.storagePath,
        safeStorage: makeFakeSafeStorage(),
        loginTimeoutMs: 200,
        fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({}) }),
        openExternal: async (loginUrl) => {
          const parsed = new URL(loginUrl);
          const port = parsed.searchParams.get('port');
          finishCallback = () => httpGet(`http://127.0.0.1:${port}/callback?code=c&state=wrong`);
        },
      });

      const firstPromise = auth.login();
      // Sunucunun açılıp openExternal'ın çağrılmasını bekle
      for (let i = 0; i < 20 && !finishCallback; i++) {
        await new Promise((r) => setTimeout(r, 10));
      }
      const secondResult = await auth.login();
      assert.deepEqual(secondResult, { error: 'Giriş zaten sürüyor.' });

      await finishCallback();
      const firstResult = await firstPromise;
      assert.deepEqual(firstResult, { error: 'Giriş zaman aşımına uğradı.' });
    } finally {
      tmp.cleanup();
    }
  });

  it('5. zaman aşımı (kısa loginTimeoutMs) "Giriş zaman aşımına uğradı." döner', async () => {
    const tmp = makeTempStoragePath();
    try {
      const auth = createAuth({
        apiBaseUrl: 'https://api.kocamind.com',
        webBaseUrl: 'https://kocamind.com',
        firebaseApiKey: 'test-firebase-key',
        storagePath: tmp.storagePath,
        safeStorage: makeFakeSafeStorage(),
        loginTimeoutMs: 60,
        openExternal: async () => {},
      });

      const result = await auth.login();
      assert.deepEqual(result, { error: 'Giriş zaman aşımına uğradı.' });
    } finally {
      tmp.cleanup();
    }
  });

  it('6. getIdToken geçerli jetonu döndürür; süresi yakınsa yeniler; yenileme 400 ise null ve oturum silinir', async () => {
    const tmp = makeTempStoragePath();
    try {
      let currentNow = 1_000_000;
      let refreshStatus = 200;
      let refreshCount = 0;

      const auth = createAuth({
        apiBaseUrl: 'https://api.kocamind.com',
        webBaseUrl: 'https://kocamind.com',
        firebaseApiKey: 'test-firebase-key',
        storagePath: tmp.storagePath,
        safeStorage: makeFakeSafeStorage(),
        now: () => currentNow,
        fetchImpl: async (url, options = {}) => {
          if (url.endsWith('/ide/auth/exchange')) {
            return { ok: true, status: 200, json: async () => ({ customToken: 'ct' }) };
          }
          if (url.includes('signInWithCustomToken')) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                idToken: 'initial-id-token',
                refreshToken: 'initial-refresh-token',
                expiresIn: '3600',
                localId: 'u1',
                email: 'u1@kocamind.com',
              }),
            };
          }
          if (url.startsWith('https://securetoken.googleapis.com/v1/token')) {
            refreshCount += 1;
            assert.ok(String(options.body).includes('grant_type=refresh_token'));
            if (refreshStatus !== 200) {
              return { ok: false, status: refreshStatus, json: async () => ({ error: { message: 'INVALID_REFRESH_TOKEN' } }) };
            }
            return {
              ok: true,
              status: 200,
              json: async () => ({
                id_token: 'refreshed-id-token',
                refresh_token: 'new-refresh-token',
                expires_in: '3600',
              }),
            };
          }
          throw new Error(`Unexpected URL: ${url}`);
        },
        openExternal: async (loginUrl) => {
          const parsed = new URL(loginUrl);
          const state = parsed.searchParams.get('ide_giris');
          const port = parsed.searchParams.get('port');
          await httpGet(`http://127.0.0.1:${port}/callback?code=c1&state=${encodeURIComponent(state)}`);
        },
      });

      await auth.login();

      // 5 dakikadan fazla süre var -> bellekteki jeton döner
      const tok1 = await auth.getIdToken();
      assert.equal(tok1, 'initial-id-token');
      assert.equal(refreshCount, 0);

      // Süre bitimine 4 dakika kaldı (< 5 dk) -> yenilenir
      currentNow += (3600 - 240) * 1000;
      const tok2 = await auth.getIdToken();
      assert.equal(tok2, 'refreshed-id-token');
      assert.equal(refreshCount, 1);

      // Tekrar süre bitimine yaklaştır ve 400 döndür -> oturum silinir ve null döner
      currentNow += (3600 - 100) * 1000;
      refreshStatus = 400;
      const tok3 = await auth.getIdToken();
      assert.equal(tok3, null);
      assert.equal(auth.isLoggedIn(), false);
      assert.equal(auth.getUser(), null);
      assert.equal(fs.existsSync(tmp.storagePath), false);
    } finally {
      tmp.cleanup();
    }
  });

  it('7. yeniden açılışta dosyadan oturum yüklenir; bozuk dosya silinir', async () => {
    const tmp = makeTempStoragePath();
    try {
      const safeStorage = makeFakeSafeStorage();
      const validPayload = JSON.stringify({
        refreshToken: 'stored-refresh-token',
        uid: 'uid-stored',
        email: 'stored@kocamind.com',
      });
      fs.writeFileSync(tmp.storagePath, safeStorage.encryptString(validPayload));

      const auth1 = createAuth({
        apiBaseUrl: 'https://api.kocamind.com',
        webBaseUrl: 'https://kocamind.com',
        firebaseApiKey: 'test-firebase-key',
        storagePath: tmp.storagePath,
        safeStorage,
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            id_token: 'fresh-id-token',
            refresh_token: 'stored-refresh-token',
            expires_in: '3600',
          }),
        }),
        openExternal: async () => {},
      });

      assert.equal(auth1.isLoggedIn(), true);
      assert.deepEqual(auth1.getUser(), {
        uid: 'uid-stored',
        email: 'stored@kocamind.com',
        persisted: true,
      });
      assert.equal(await auth1.getIdToken(), 'fresh-id-token');

      // Bozuk dosya yaz ve yeniden başlat
      fs.writeFileSync(tmp.storagePath, 'corrupted-binary-content');
      const auth2 = createAuth({
        apiBaseUrl: 'https://api.kocamind.com',
        webBaseUrl: 'https://kocamind.com',
        firebaseApiKey: 'test-firebase-key',
        storagePath: tmp.storagePath,
        safeStorage,
        openExternal: async () => {},
      });
      assert.equal(auth2.isLoggedIn(), false);
      assert.equal(auth2.getUser(), null);
      assert.equal(fs.existsSync(tmp.storagePath), false);
    } finally {
      tmp.cleanup();
    }
  });

  it('8. safeStorage kullanılamazsa diske yazılmaz, persisted: false', async () => {
    const tmp = makeTempStoragePath();
    try {
      const auth = createAuth({
        apiBaseUrl: 'https://api.kocamind.com',
        webBaseUrl: 'https://kocamind.com',
        firebaseApiKey: 'test-firebase-key',
        storagePath: tmp.storagePath,
        safeStorage: makeFakeSafeStorage({ available: false }),
        fetchImpl: async (url) => {
          if (url.endsWith('/ide/auth/exchange')) {
            return { ok: true, status: 200, json: async () => ({ customToken: 'ct' }) };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              idToken: makeFakeJwt({ sub: 'u-mem', email: 'mem@kocamind.com' }),
              refreshToken: 'rt-mem',
              expiresIn: '3600',
              localId: 'u-mem',
            }),
          };
        },
        openExternal: async (loginUrl) => {
          const parsed = new URL(loginUrl);
          const state = parsed.searchParams.get('ide_giris');
          const port = parsed.searchParams.get('port');
          await httpGet(`http://127.0.0.1:${port}/callback?code=c&state=${encodeURIComponent(state)}`);
        },
      });

      const res = await auth.login();
      assert.equal(res.ok, true);
      assert.equal(fs.existsSync(tmp.storagePath), false);
      assert.deepEqual(auth.getUser(), {
        uid: 'u-mem',
        email: 'mem@kocamind.com',
        persisted: false,
      });
    } finally {
      tmp.cleanup();
    }
  });

  it('9. logout dosyayı ve belleği siler', async () => {
    const tmp = makeTempStoragePath();
    try {
      const safeStorage = makeFakeSafeStorage();
      fs.writeFileSync(
        tmp.storagePath,
        safeStorage.encryptString(JSON.stringify({ refreshToken: 'rt', uid: 'u1', email: 'e@k.com' }))
      );
      const auth = createAuth({
        apiBaseUrl: 'https://api.kocamind.com',
        webBaseUrl: 'https://kocamind.com',
        firebaseApiKey: 'test-firebase-key',
        storagePath: tmp.storagePath,
        safeStorage,
        openExternal: async () => {},
      });

      assert.equal(auth.isLoggedIn(), true);
      auth.logout();
      assert.equal(auth.isLoggedIn(), false);
      assert.equal(auth.getUser(), null);
      assert.equal(await auth.getIdToken(), null);
      assert.equal(fs.existsSync(tmp.storagePath), false);
    } finally {
      tmp.cleanup();
    }
  });

  it('10. hiçbir console çağrısı ve hata metni jeton/kod içermez', async () => {
    const tmp = makeTempStoragePath();
    const logs = [];
    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;
    console.log = (...args) => logs.push(args.join(' '));
    console.warn = (...args) => logs.push(args.join(' '));
    console.error = (...args) => logs.push(args.join(' '));

    const secretCode = 'SUPER_SECRET_AUTH_CODE_999';
    const secretCustomToken = 'SUPER_SECRET_CUSTOM_TOKEN_999';
    const secretRefreshToken = 'SUPER_SECRET_REFRESH_TOKEN_999';

    try {
      const auth = createAuth({
        apiBaseUrl: 'https://api.kocamind.com',
        webBaseUrl: 'https://kocamind.com',
        firebaseApiKey: 'test-firebase-key',
        storagePath: tmp.storagePath,
        safeStorage: makeFakeSafeStorage(),
        fetchImpl: async (url) => {
          if (url.endsWith('/ide/auth/exchange')) {
            return {
              ok: true,
              status: 200,
              json: async () => ({ customToken: secretCustomToken }),
            };
          }
          return {
            ok: false,
            status: 400,
            json: async () => ({
              error: { message: `Failed with ${secretCustomToken} and ${secretRefreshToken}` },
            }),
          };
        },
        openExternal: async (loginUrl) => {
          const parsed = new URL(loginUrl);
          const state = parsed.searchParams.get('ide_giris');
          const port = parsed.searchParams.get('port');
          await httpGet(`http://127.0.0.1:${port}/callback?code=${secretCode}&state=${encodeURIComponent(state)}`);
        },
      });

      const res = await auth.login();
      assert.ok(res.error);
      const combined = JSON.stringify(res) + ' ' + logs.join(' ');
      assert.equal(combined.includes(secretCode), false);
      assert.equal(combined.includes(secretCustomToken), false);
      assert.equal(combined.includes(secretRefreshToken), false);
    } finally {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
      tmp.cleanup();
    }
  });

  it('11. önce yanlış state ve code\'suz istek, sonra doğru state ile callback -> giriş başarılı', async () => {
    const tmp = makeTempStoragePath();
    try {
      const idToken = makeFakeJwt({ sub: 'uid-retry', email: 'retry@kocamind.com' });
      let wrongStateRes = null;
      let missingCodeRes = null;
      let validRes = null;

      const auth = createAuth({
        apiBaseUrl: 'https://api.kocamind.com',
        webBaseUrl: 'https://kocamind.com',
        firebaseApiKey: 'test-firebase-key',
        storagePath: tmp.storagePath,
        safeStorage: makeFakeSafeStorage(),
        loginTimeoutMs: 1000,
        fetchImpl: async (url) => {
          if (url.endsWith('/ide/auth/exchange')) {
            return { ok: true, status: 200, json: async () => ({ customToken: 'ct-retry' }) };
          }
          if (url.includes('signInWithCustomToken')) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                idToken,
                refreshToken: 'rt-retry',
                expiresIn: '3600',
                localId: 'uid-retry',
              }),
            };
          }
          throw new Error(`Unexpected URL: ${url}`);
        },
        openExternal: async (loginUrl) => {
          const parsed = new URL(loginUrl);
          const state = parsed.searchParams.get('ide_giris');
          const port = parsed.searchParams.get('port');
          wrongStateRes = await httpGet(`http://127.0.0.1:${port}/callback?code=c1&state=${'x'.repeat(43)}`);
          missingCodeRes = await httpGet(`http://127.0.0.1:${port}/callback?state=${encodeURIComponent(state)}`);
          validRes = await httpGet(`http://127.0.0.1:${port}/callback?code=good-code&state=${encodeURIComponent(state)}`);
        },
      });

      const result = await auth.login();
      assert.equal(wrongStateRes.statusCode, 400);
      assert.equal(missingCodeRes.statusCode, 400);
      assert.equal(validRes.statusCode, 200);
      assert.deepEqual(result, {
        ok: true,
        user: { uid: 'uid-retry', email: 'retry@kocamind.com' },
      });
      assert.equal(auth.isLoggedIn(), true);
    } finally {
      tmp.cleanup();
    }
  });

  it('12. 20 yanlış callback isteğinden sonra giriş "Giriş tamamlanamadı." ile biter', async () => {
    const tmp = makeTempStoragePath();
    try {
      const statuses = [];
      const auth = createAuth({
        apiBaseUrl: 'https://api.kocamind.com',
        webBaseUrl: 'https://kocamind.com',
        firebaseApiKey: 'test-firebase-key',
        storagePath: tmp.storagePath,
        safeStorage: makeFakeSafeStorage(),
        loginTimeoutMs: 1000,
        fetchImpl: async () => { throw new Error('Should not call fetch'); },
        openExternal: async (loginUrl) => {
          const parsed = new URL(loginUrl);
          const port = parsed.searchParams.get('port');
          for (let i = 0; i < 20; i += 1) {
            const res = await httpGet(`http://127.0.0.1:${port}/callback?code=c&state=${'y'.repeat(43)}`);
            statuses.push(res.statusCode);
          }
        },
      });

      const result = await auth.login();
      assert.equal(statuses.length, 20);
      assert.ok(statuses.every((s) => s === 400));
      assert.deepEqual(result, { error: 'Giriş tamamlanamadı.' });
      assert.equal(auth.isLoggedIn(), false);
    } finally {
      tmp.cleanup();
    }
  });

  it('13. createAuth anında şifreleme kapalıysa dosya silinmez; şifreleme açılınca ilk isLoggedIn() oturumu yükler', async () => {
    const tmp = makeTempStoragePath();
    try {
      let available = false;
      const writerSafeStorage = makeFakeSafeStorage({ available: true });
      const validPayload = JSON.stringify({
        refreshToken: 'stored-refresh-lazy',
        uid: 'uid-lazy',
        email: 'lazy@kocamind.com',
      });
      fs.writeFileSync(tmp.storagePath, writerSafeStorage.encryptString(validPayload));

      const dynamicSafeStorage = {
        isEncryptionAvailable: () => available,
        encryptString: writerSafeStorage.encryptString,
        decryptString: writerSafeStorage.decryptString,
      };

      const auth = createAuth({
        apiBaseUrl: 'https://api.kocamind.com',
        webBaseUrl: 'https://kocamind.com',
        firebaseApiKey: 'test-firebase-key',
        storagePath: tmp.storagePath,
        safeStorage: dynamicSafeStorage,
        openExternal: async () => {},
      });

      assert.equal(fs.existsSync(tmp.storagePath), true);

      available = true;
      assert.equal(auth.isLoggedIn(), true);
      assert.deepEqual(auth.getUser(), {
        uid: 'uid-lazy',
        email: 'lazy@kocamind.com',
        persisted: true,
      });
    } finally {
      tmp.cleanup();
    }
  });

  it('14. şifreleme kapalıyken isLoggedIn() çağrısı dosyayı silmez ve sonraki çağrıda şifreleme açılınca yüklenir', async () => {
    const tmp = makeTempStoragePath();
    try {
      let available = false;
      const writerSafeStorage = makeFakeSafeStorage({ available: true });
      const validPayload = JSON.stringify({
        refreshToken: 'stored-refresh-keep',
        uid: 'uid-keep',
        email: 'keep@kocamind.com',
      });
      fs.writeFileSync(tmp.storagePath, writerSafeStorage.encryptString(validPayload));

      const dynamicSafeStorage = {
        isEncryptionAvailable: () => available,
        encryptString: writerSafeStorage.encryptString,
        decryptString: writerSafeStorage.decryptString,
      };

      const auth = createAuth({
        apiBaseUrl: 'https://api.kocamind.com',
        webBaseUrl: 'https://kocamind.com',
        firebaseApiKey: 'test-firebase-key',
        storagePath: tmp.storagePath,
        safeStorage: dynamicSafeStorage,
        openExternal: async () => {},
      });

      assert.equal(auth.isLoggedIn(), false);
      assert.equal(fs.existsSync(tmp.storagePath), true);

      available = true;
      assert.equal(auth.isLoggedIn(), true);
      assert.deepEqual(auth.getUser(), {
        uid: 'uid-keep',
        email: 'keep@kocamind.com',
        persisted: true,
      });
    } finally {
      tmp.cleanup();
    }
  });
});
