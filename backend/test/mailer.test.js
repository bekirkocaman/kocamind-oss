const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEmail, createMailer, EMAIL_KINDS } = require('../mailer');

const sample = {
  reset: { email: 'a@b.co', link: 'https://l.test/?x=1&y=2' },
  verify: { email: 'a@b.co', link: 'https://l.test/v' },
  welcome: { name: 'Bekir' },
  passwordChanged: { email: 'a@b.co' },
  accountDeletionScheduled: { email: 'a@b.co', purgeDate: '11 Aralık 2026' },
  accountDeleted: { email: 'a@b.co' },
  billingActivated: { appUrl: 'https://kocamind.com' },
  billingPaid: { orderReference: 'ORD-1' },
  billingFailed: { appUrl: 'https://kocamind.com' },
  billingCanceled: {},
};

test('her mail türü ortak tasarımla, konu ve düz metinle üretilir', () => {
  assert.deepEqual(Object.keys(sample).sort(), [...EMAIL_KINDS].sort());
  for (const kind of EMAIL_KINDS) {
    const mail = buildEmail(kind, sample[kind]);
    assert.ok(mail.subject.startsWith('KocaMind'), kind);
    assert.match(mail.html, /KocaMind/, kind);
    assert.match(mail.html, /<h1 /, kind);
    assert.ok(mail.text.length > 20, kind);
    assert.doesNotMatch(mail.html, /undefined|%[A-Z]+%/, kind);
  }
});

test('kullanıcıdan gelen değerler kaçışlanır, bağlantı düğmede kalır', () => {
  const mail = buildEmail('welcome', { name: '<script>x</script>' });
  assert.doesNotMatch(mail.html, /<script>/);
  assert.match(mail.html, /&lt;script&gt;/);
  const reset = buildEmail('reset', sample.reset);
  assert.match(reset.html, /href="https:\/\/l\.test\/\?x=1&amp;y=2"/);
  assert.equal((reset.html.match(/l\.test/g) || []).length, 1);
  assert.match(reset.text, /https:\/\/l\.test\/\?x=1&y=2/);
});

test('gönderici: anahtar yoksa false döner, hata fırlatmaz; varsa Resend çağrılır', async () => {
  assert.equal(await createMailer({ fetch: async () => { throw new Error('x'); }, env: {} }).send('welcome', 'a@b.co', sample.welcome), false);
  const sent = [];
  const mailer = createMailer({ fetch: async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true }; }, env: { RESEND_API_KEY: 'k' } });
  assert.equal(await mailer.send('billingCanceled', 'a@b.co', {}), true);
  assert.equal(sent[0].from, 'KocaMind <noreply@kocamind.com>');
  assert.deepEqual(sent[0].to, ['a@b.co']);
  const failing = createMailer({ fetch: async () => { throw new Error('ağ'); }, env: { RESEND_API_KEY: 'k' } });
  assert.equal(await failing.send('billingCanceled', 'a@b.co', {}), false);
  assert.equal(await mailer.send('billingCanceled', '', {}), false);
});
