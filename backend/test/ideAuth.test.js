const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const request = require('supertest');
const { fakeFirestore } = require('./fakeFirestore');
const {
  registerIdeAuthPublicRoutes,
  registerIdeAuthPrivateRoutes,
} = require('../routes/ideAuth');

function buildTestApp({
  firestoreDb = fakeFirestore(),
  firebaseAuth,
  now = () => 1_700_000_000_000,
  randomBytes = crypto.randomBytes,
  uid = 'user-123',
} = {}) {
  const customTokenCalls = [];
  const authMock = firebaseAuth || {
    createCustomToken: async (targetUid, claims) => {
      customTokenCalls.push({ uid: targetUid, claims });
      return `custom-token-for-${targetUid}`;
    },
  };

  const app = express();
  app.use(express.json());

  registerIdeAuthPublicRoutes(app, {
    firestoreDb,
    firebaseAuth: authMock,
    now,
    randomBytes,
  });

  app.use((req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader === 'Bearer valid-id-token') {
      req.user = { uid };
      return next();
    }
    return res.status(401).json({ error: 'Oturum açman gerekiyor.' });
  });

  registerIdeAuthPrivateRoutes(app, {
    firestoreDb,
    firebaseAuth: authMock,
    now,
    randomBytes,
  });

  return { app, firestoreDb, customTokenCalls };
}

describe('IDE auth routes (/ide/auth/code & /ide/auth/exchange)', () => {
  const validState = 'a'.repeat(43);

  it('1. code geçerli state ile kod döndürür; Firestore\'da kodun kendisi DEĞİL özeti saklanır', async () => {
    const firestoreDb = fakeFirestore();
    const { app } = buildTestApp({ firestoreDb, now: () => 1_000_000 });

    const res = await request(app)
      .post('/ide/auth/code')
      .set('Authorization', 'Bearer valid-id-token')
      .send({ state: validState });

    assert.equal(res.status, 200);
    assert.equal(typeof res.body.code, 'string');
    assert.match(res.body.code, /^[A-Za-z0-9_-]{32,200}$/);

    const codeHash = crypto.createHash('sha256').update(res.body.code).digest('hex');
    const stateHash = crypto.createHash('sha256').update(validState).digest('hex');

    assert.equal(firestoreDb.docs.has(`ide_login_codes/${res.body.code}`), false);
    const stored = firestoreDb.docs.get(`ide_login_codes/${codeHash}`);
    assert.ok(stored);
    assert.equal(stored.uid, 'user-123');
    assert.equal(stored.stateHash, stateHash);
    assert.equal(stored.expiresAt, 1_000_000 + 120_000);
    assert.equal(stored.used, false);
    assert.equal('code' in stored, false);
    assert.equal( JSON.stringify(stored).includes(res.body.code), false);
  });

  it('2. code geçersiz state (kısa, yasak karakter) ile 400 döner', async () => {
    const { app } = buildTestApp();

    const shortRes = await request(app)
      .post('/ide/auth/code')
      .set('Authorization', 'Bearer valid-id-token')
      .send({ state: 'short-state-123' });
    assert.equal(shortRes.status, 400);
    assert.equal(shortRes.body?.error?.message, 'Geçersiz istek.');

    const badCharRes = await request(app)
      .post('/ide/auth/code')
      .set('Authorization', 'Bearer valid-id-token')
      .send({ state: 'a'.repeat(32) + '!@#$' });
    assert.equal(badCharRes.status, 400);
    assert.equal(badCharRes.body?.error?.message, 'Geçersiz istek.');

    const tooLongRes = await request(app)
      .post('/ide/auth/code')
      .set('Authorization', 'Bearer valid-id-token')
      .send({ state: 'a'.repeat(201) });
    assert.equal(tooLongRes.status, 400);
  });

  it('3. exchange doğru code+state ile customToken döndürür ve createCustomToken { ide: true } ile çağrılır', async () => {
    const { app, customTokenCalls } = buildTestApp();

    const codeRes = await request(app)
      .post('/ide/auth/code')
      .set('Authorization', 'Bearer valid-id-token')
      .send({ state: validState });

    const exchangeRes = await request(app)
      .post('/ide/auth/exchange')
      .send({ code: codeRes.body.code, state: validState });

    assert.equal(exchangeRes.status, 200);
    assert.equal(exchangeRes.body.customToken, 'custom-token-for-user-123');
    assert.deepEqual(customTokenCalls, [{ uid: 'user-123', claims: { ide: true } }]);
  });

  it('4. aynı kod ikinci kez kullanılamaz', async () => {
    const { app } = buildTestApp();

    const codeRes = await request(app)
      .post('/ide/auth/code')
      .set('Authorization', 'Bearer valid-id-token')
      .send({ state: validState });

    const first = await request(app)
      .post('/ide/auth/exchange')
      .send({ code: codeRes.body.code, state: validState });
    assert.equal(first.status, 200);

    const second = await request(app)
      .post('/ide/auth/exchange')
      .send({ code: codeRes.body.code, state: validState });
    assert.equal(second.status, 400);
    assert.equal(second.body?.error?.message, 'Giriş kodu geçersiz ya da süresi dolmuş.');
  });

  it('5. süresi dolmuş kod reddedilir (sahte now)', async () => {
    let currentTime = 1_000_000;
    const { app } = buildTestApp({ now: () => currentTime });

    const codeRes = await request(app)
      .post('/ide/auth/code')
      .set('Authorization', 'Bearer valid-id-token')
      .send({ state: validState });

    currentTime += 120_001;

    const exchangeRes = await request(app)
      .post('/ide/auth/exchange')
      .send({ code: codeRes.body.code, state: validState });
    assert.equal(exchangeRes.status, 400);
    assert.equal(exchangeRes.body?.error?.message, 'Giriş kodu geçersiz ya da süresi dolmuş.');
  });

  it('6. yanlış state reddedilir', async () => {
    const { app } = buildTestApp();

    const codeRes = await request(app)
      .post('/ide/auth/code')
      .set('Authorization', 'Bearer valid-id-token')
      .send({ state: validState });

    const wrongState = 'b'.repeat(43);
    const exchangeRes = await request(app)
      .post('/ide/auth/exchange')
      .send({ code: codeRes.body.code, state: wrongState });
    assert.equal(exchangeRes.status, 400);
    assert.equal(exchangeRes.body?.error?.message, 'Giriş kodu geçersiz ya da süresi dolmuş.');
  });

  it('7. hata yanıtları kodu ya da jetonu içermez', async () => {
    const { app } = buildTestApp();
    const secretCode = 'SECRET_CODE_' + 'x'.repeat(32);
    const secretState = 'SECRET_STATE_' + 'y'.repeat(32);

    const res1 = await request(app)
      .post('/ide/auth/exchange')
      .send({ code: secretCode, state: secretState });
    assert.equal(res1.status, 400);
    const text1 = JSON.stringify(res1.body);
    assert.equal(text1.includes(secretCode), false);
    assert.equal(text1.includes(secretState), false);

    const res2 = await request(app)
      .post('/ide/auth/code')
      .set('Authorization', 'Bearer valid-id-token')
      .send({ state: 'bad_short_secret_token_123' });
    assert.equal(res2.status, 400);
    assert.equal(JSON.stringify(res2.body).includes('bad_short_secret_token_123'), false);
  });

  it('8. code yeni kod yazmadan önce aynı uid\'nin süresi dolmuş ya da kullanılmış kayıtlarını siler (en fazla 20); geçerli olanları korur', async () => {
    const firestoreDb = fakeFirestore();
    let currentTime = 1_000_000;
    const { app } = buildTestApp({ firestoreDb, now: () => currentTime });

    // Aynı uid için kullanılmış ve süresi dolmuş 2 kayıt + henüz geçerli 1 kayıt + başka uid için kullanılmış 1 kayıt
    await firestoreDb.collection('ide_login_codes').doc('used-doc').set({
      uid: 'user-123',
      stateHash: 's1',
      expiresAt: currentTime + 60_000,
      used: true,
    });
    await firestoreDb.collection('ide_login_codes').doc('expired-doc').set({
      uid: 'user-123',
      stateHash: 's2',
      expiresAt: currentTime - 1,
      used: false,
    });
    await firestoreDb.collection('ide_login_codes').doc('active-doc').set({
      uid: 'user-123',
      stateHash: 's3',
      expiresAt: currentTime + 60_000,
      used: false,
    });
    await firestoreDb.collection('ide_login_codes').doc('other-user-used').set({
      uid: 'other-user',
      stateHash: 's4',
      expiresAt: currentTime - 1,
      used: true,
    });

    const res = await request(app)
      .post('/ide/auth/code')
      .set('Authorization', 'Bearer valid-id-token')
      .send({ state: validState });

    assert.equal(res.status, 200);
    assert.equal(firestoreDb.docs.has('ide_login_codes/used-doc'), false);
    assert.equal(firestoreDb.docs.has('ide_login_codes/expired-doc'), false);
    assert.equal(firestoreDb.docs.has('ide_login_codes/active-doc'), true);
    assert.equal(firestoreDb.docs.has('ide_login_codes/other-user-used'), true);
  });

  it('9. code rotası kullanıcı başına dakikada en fazla 10 isteğe izin verir (11. istek 429)', async () => {
    const { app } = buildTestApp();

    for (let i = 0; i < 10; i += 1) {
      const res = await request(app)
        .post('/ide/auth/code')
        .set('Authorization', 'Bearer valid-id-token')
        .send({ state: validState });
      assert.equal(res.status, 200);
    }

    const limitedRes = await request(app)
      .post('/ide/auth/code')
      .set('Authorization', 'Bearer valid-id-token')
      .send({ state: validState });
    assert.equal(limitedRes.status, 429);
  });
});
