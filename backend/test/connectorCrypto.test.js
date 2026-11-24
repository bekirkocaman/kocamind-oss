const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createTokenCipher } = require('../connectors/crypto');

const key = crypto.randomBytes(32).toString('base64');

test('şifreli token gidiş-dönüş aynı veriyi verir ve düz metin içermez', () => {
  const cipher = createTokenCipher(key);
  const sealed = cipher.encrypt({ access_token: 'gizli-erisim', refresh_token: 'gizli-yenileme' });
  assert.equal(typeof sealed, 'string');
  assert.doesNotMatch(sealed, /gizli/);
  assert.deepEqual(cipher.decrypt(sealed), { access_token: 'gizli-erisim', refresh_token: 'gizli-yenileme' });
});

test('her şifreleme farklı IV kullanır', () => {
  const cipher = createTokenCipher(key);
  assert.notEqual(cipher.encrypt({ a: 1 }), cipher.encrypt({ a: 1 }));
});

test('bozulmuş veri ve yanlış anahtar reddedilir', () => {
  const cipher = createTokenCipher(key);
  const sealed = cipher.encrypt({ a: 1 });
  const parts = sealed.split('.');
  const tampered = [parts[0], parts[1], Buffer.from('bozuk').toString('base64')].join('.');
  assert.throws(() => cipher.decrypt(tampered));
  assert.throws(() => createTokenCipher(crypto.randomBytes(32).toString('base64')).decrypt(sealed));
  assert.throws(() => cipher.decrypt('saçma'));
});

test('anahtar yoksa ya da 32 bayt değilse şifreleyici oluşmaz', () => {
  assert.equal(createTokenCipher(''), null);
  assert.equal(createTokenCipher(undefined), null);
  assert.equal(createTokenCipher(Buffer.from('kisa').toString('base64')), null);
});
