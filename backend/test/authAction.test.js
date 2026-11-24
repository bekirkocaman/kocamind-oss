const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { registerAuthActionRoutes, actionLink } = require('../authAction');

// Identity Toolkit REST taklidi: oobCode 'GOOD' geçerli, 'USED' kullanılmış.
function fakeToolkit(calls) {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    if (body.oobCode !== 'GOOD') {
      return { ok: false, status: 400, json: async () => ({ error: { message: 'INVALID_OOB_CODE' } }) };
    }
    if (url.includes('accounts:update')) return { ok: true, json: async () => ({ email: 'ali@ornek.com', emailVerified: true }) };
    return { ok: true, json: async () => ({ email: 'ali@ornek.com', requestType: 'PASSWORD_RESET' }) };
  };
}

function app() {
  const calls = [];
  const mails = [];
  const a = express();
  a.use(express.json());
  a.use(express.urlencoded({ extended: false }));
  registerAuthActionRoutes(a, {
    fetch: fakeToolkit(calls),
    mailer: { send: async (kind, to, data) => { mails.push({ kind, to, data }); return true; } },
    env: { FIREBASE_WEB_API_KEY: 'web-key' },
  });
  return { a, calls, mails };
}

test('bağlantı: Firebase bağlantısındaki kod ve tür bizim sayfamıza taşınır', () => {
  const link = actionLink('https://kocamind.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=AB%2BC&apiKey=x&lang=tr', 'https://hesap.kocamind.com');
  assert.equal(link, 'https://hesap.kocamind.com/auth/action?mode=resetPassword&oobCode=AB%2BC');
});

test('doğrulama: kod uygulanır, KocaMind tasarımlı başarı sayfası döner', async () => {
  const { a, calls } = app();
  const res = await request(a).get('/auth/action?mode=verifyEmail&oobCode=GOOD');
  assert.equal(res.status, 200);
  assert.match(res.text, /E-postan doğrulandı/);
  assert.match(res.text, /KocaMind/);
  assert.ok(calls[0].url.includes('accounts:update?key=web-key'));
});

test('şifre: geçerli kodda form gösterilir, e-posta yazar', async () => {
  const { a } = app();
  const res = await request(a).get('/auth/action?mode=resetPassword&oobCode=GOOD');
  assert.equal(res.status, 200);
  assert.match(res.text, /Yeni şifre belirle/);
  assert.match(res.text, /ali@ornek\.com/);
  assert.match(res.text, /name="newPassword"/);
});

test('şifre: kaydedilince "şifren değiştirildi" maili gider', async () => {
  const { a, calls, mails } = app();
  const res = await request(a).post('/auth/action/reset').type('form').send({ oobCode: 'GOOD', newPassword: 'yeni-sifre-1', confirm: 'yeni-sifre-1' });
  assert.equal(res.status, 200);
  assert.match(res.text, /Şifren değiştirildi/);
  assert.equal(calls.at(-1).body.newPassword, 'yeni-sifre-1');
  assert.deepEqual(mails, [{ kind: 'passwordChanged', to: 'ali@ornek.com', data: { email: 'ali@ornek.com' } }]);
});

test('şifre: eşleşmeyen ya da kısa şifre kaydedilmez, form hatayla döner', async () => {
  const { a, calls } = app();
  const short = await request(a).post('/auth/action/reset').type('form').send({ oobCode: 'GOOD', newPassword: '123', confirm: '123' });
  assert.equal(short.status, 400);
  assert.match(short.text, /en az 6 karakter/);
  const mismatch = await request(a).post('/auth/action/reset').type('form').send({ oobCode: 'GOOD', newPassword: 'abcdef', confirm: 'abcdeg' });
  assert.equal(mismatch.status, 400);
  assert.match(mismatch.text, /eşleşmiyor/);
  assert.equal(calls.filter(c => c.body.newPassword).length, 0);
});

test('kullanılmış ya da bozuk bağlantı anlaşılır bir sayfa gösterir', async () => {
  const { a } = app();
  const used = await request(a).get('/auth/action?mode=verifyEmail&oobCode=USED');
  assert.equal(used.status, 400);
  assert.match(used.text, /süresi dolmuş ya da daha önce kullanılmış/);
  const unknown = await request(a).get('/auth/action?mode=baska&oobCode=GOOD');
  assert.equal(unknown.status, 400);
});

test('sayfa içerik güvenlik başlığıyla döner, kod sayfaya kaçışlanarak yazılır', async () => {
  const { a } = app();
  const res = await request(a).get('/auth/action?mode=resetPassword&oobCode=GOOD');
  assert.match(res.headers['content-security-policy'], /default-src 'none'/);
  assert.equal(res.headers['cache-control'], 'no-store');
});
