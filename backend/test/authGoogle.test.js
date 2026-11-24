const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { registerAuthRoutes } = require('../routes/auth');

const CLIENT_ID = 'test-client.apps.googleusercontent.com';

function googleFetch() {
  return async url => {
    if (String(url).startsWith('https://oauth2.googleapis.com/tokeninfo')) {
      return { ok: true, json: async () => ({ aud: CLIENT_ID, sub: 'g-123' }) };
    }
    return { ok: true, json: async () => ({ sub: 'g-123', email: 'kurban@example.com', email_verified: true, name: 'Kurban' }) };
  };
}

function appWith(existingUser) {
  const calls = { updateUser: [], revoked: [], tokens: [] };
  const firebaseAuth = {
    async getUserByEmail() {
      if (!existingUser) { const error = new Error('yok'); error.code = 'auth/user-not-found'; throw error; }
      return existingUser;
    },
    async updateUser(uid, patch) { calls.updateUser.push({ uid, patch }); return { ...existingUser, ...patch }; },
    async revokeRefreshTokens(uid) { calls.revoked.push(uid); },
    async createUser(data) { return data; },
    async createCustomToken(uid) { calls.tokens.push(uid); return `token-${uid}`; },
  };
  const app = express();
  app.use(express.json());
  const previous = process.env.GOOGLE_OAUTH_CLIENT_ID;
  process.env.GOOGLE_OAUTH_CLIENT_ID = CLIENT_ID;
  registerAuthRoutes(app, { fetch: googleFetch(), firebaseAuth, registerPublicBillingRoutes: () => {} });
  if (previous === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID; else process.env.GOOGLE_OAUTH_CLIENT_ID = previous;
  return { app, calls };
}

test('/auth/google doğrulanmamış önceden açılmış hesabın şifresini geçersiz kılar ve oturumları kapatır', async () => {
  const { app, calls } = appWith({ uid: 'saldirgan-acti', email: 'kurban@example.com', emailVerified: false });
  const res = await request(app).post('/auth/google').send({ accessToken: 'x' });
  assert.equal(res.status, 200);
  assert.equal(calls.updateUser.length, 1);
  assert.equal(calls.updateUser[0].patch.emailVerified, true);
  assert.ok(calls.updateUser[0].patch.password.length >= 32);
  assert.deepEqual(calls.revoked, ['saldirgan-acti']);
});

test('/auth/google doğrulanmış hesaba dokunmaz', async () => {
  const { app, calls } = appWith({ uid: 'u1', email: 'kurban@example.com', emailVerified: true });
  const res = await request(app).post('/auth/google').send({ accessToken: 'x' });
  assert.equal(res.status, 200);
  assert.equal(calls.updateUser.length, 0);
  assert.equal(calls.revoked.length, 0);
  assert.deepEqual(calls.tokens, ['u1']);
});
