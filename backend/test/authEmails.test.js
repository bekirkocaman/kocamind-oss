const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { renderAuthEmail, registerAuthEmailRoutes } = require('../authEmails');
const { fakeFirestore } = require('./fakeFirestore');

function fakeAuth({ users = {
  'u1': { uid: 'u1', email: 'ali@ornek.com', emailVerified: false },
  'u2': { uid: 'u2', email: 'ayse@ornek.com', emailVerified: true, name: 'Ayşe Yılmaz' },
} } = {}) {
  const byEmail = Object.fromEntries(Object.values(users).map(u => [u.email, u]));
  return {
    links: [],
    async verifyIdToken(token) {
      if (!users[token]) throw new Error('geçersiz');
      return { uid: token, email: users[token].email, email_verified: users[token].emailVerified, name: users[token].name };
    },
    async generatePasswordResetLink(email) {
      if (!byEmail[email]) { const e = new Error('yok'); e.code = 'auth/user-not-found'; throw e; }
      this.links.push(['reset', email]);
      return `https://kocamind.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=R&email=${email}`;
    },
    async generateEmailVerificationLink(email) {
      this.links.push(['verify', email]);
      return 'https://kocamind.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=V';
    },
  };
}

function app({ auth = fakeAuth(), apiKey = 'test-key', sent = [], status = 200, db = fakeFirestore() } = {}) {
  const a = express();
  a.use(express.json());
  const fetch = async (url, init) => {
    sent.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return { ok: status < 400, status, json: async () => ({ id: 'm1' }) };
  };
  registerAuthEmailRoutes(a, { firebaseAuth: auth, fetch, firestoreDb: db, env: { RESEND_API_KEY: apiKey, ACCOUNT_ACTION_URL: 'https://hesap.kocamind.com' } });
  return a;
}

test('şablon: e-posta kaçışlanır, bağlantı ve başlık yerleşir', () => {
  const mail = renderAuthEmail('reset', { email: '<b>x@y.com</b>', link: 'https://a.test/?a=1&b=2' });
  assert.equal(mail.subject, 'KocaMind şifreni sıfırla');
  assert.match(mail.html, /Şifreni sıfırla/);
  assert.match(mail.html, /&lt;b&gt;x@y\.com&lt;\/b&gt;/);
  assert.match(mail.html, /href="https:\/\/a\.test\/\?a=1&amp;b=2"/);
  assert.doesNotMatch(mail.html, /%LINK%|%EMAIL%/);
  assert.match(mail.text, /https:\/\/a\.test\/\?a=1&b=2/);
  assert.equal(renderAuthEmail('verify', { email: 'a@b.c', link: 'https://l' }).subject, 'KocaMind e-postanı doğrula');
});

test('şifre sıfırlama: kayıtlı adrese tasarımlı mail Resend ile gider', async () => {
  const sent = [];
  const res = await request(app({ sent })).post('/auth/email/password-reset').send({ email: ' Ali@Ornek.com ' });
  assert.equal(res.status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://api.resend.com/emails');
  assert.equal(sent[0].headers.Authorization, 'Bearer test-key');
  assert.equal(sent[0].body.from, 'KocaMind <noreply@kocamind.com>');
  assert.deepEqual(sent[0].body.to, ['ali@ornek.com']);
  assert.match(sent[0].body.html, /href="https:\/\/hesap\.kocamind\.com\/auth\/action\?mode=resetPassword&amp;oobCode=R"/);
  assert.doesNotMatch(sent[0].body.html, /firebaseapp\.com/);
});

test('şifre sıfırlama: kayıtsız adres de 200 döner, mail gitmez (hesap var mı sızmaz)', async () => {
  const sent = [];
  const res = await request(app({ sent })).post('/auth/email/password-reset').send({ email: 'yok@ornek.com' });
  assert.equal(res.status, 200);
  assert.equal(sent.length, 0);
});

test('şifre sıfırlama: geçersiz e-posta 400', async () => {
  const res = await request(app()).post('/auth/email/password-reset').send({ email: 'adres-degil' });
  assert.equal(res.status, 400);
});

test('anahtar yoksa 503 ve fallback: uygulama Firebase mailine döner', async () => {
  const res = await request(app({ apiKey: '' })).post('/auth/email/password-reset').send({ email: 'ali@ornek.com' });
  assert.equal(res.status, 503);
  assert.equal(res.body.fallback, true);
});

test('Resend hata verirse 502 ve fallback', async () => {
  const res = await request(app({ status: 500 })).post('/auth/email/password-reset').send({ email: 'ali@ornek.com' });
  assert.equal(res.status, 502);
  assert.equal(res.body.fallback, true);
});

test('doğrulama: oturum belirteci şart, maile kullanıcının kendi adresi yazılır', async () => {
  const sent = [];
  const a = app({ sent });
  assert.equal((await request(a).post('/auth/email/verification').send({})).status, 401);
  const res = await request(a).post('/auth/email/verification').set('Authorization', 'Bearer u1').send({ email: 'baskasi@ornek.com' });
  assert.equal(res.status, 200);
  assert.deepEqual(sent[0].body.to, ['ali@ornek.com']);
  assert.match(sent[0].body.html, /mode=verifyEmail/);
  assert.equal(sent[0].body.subject, 'KocaMind e-postanı doğrula');
});

test('hoş geldin: doğrulanmış kullanıcıya adıyla bir kez gider', async () => {
  const sent = [];
  const db = fakeFirestore();
  const a = app({ sent, db });
  const first = await request(a).post('/auth/email/welcome').set('Authorization', 'Bearer u2').send({});
  const second = await request(a).post('/auth/email/welcome').set('Authorization', 'Bearer u2').send({});
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.body.alreadySent, true);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].body.to, ['ayse@ornek.com']);
  assert.match(sent[0].body.html, /Aramıza hoş geldin, Ayşe/);
});

test('hoş geldin: doğrulanmamış hesaba gitmez', async () => {
  const sent = [];
  const res = await request(app({ sent })).post('/auth/email/welcome').set('Authorization', 'Bearer u1').send({});
  assert.equal(res.status, 403);
  assert.equal(sent.length, 0);
});
