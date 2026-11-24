// Bağlantı tokenlarını Firestore'a yazmadan önce AES-256-GCM ile şifreler.
// Biçim: v1.<iv>.<tag+şifreli metin> (base64). Anahtar: CONNECTOR_TOKEN_KEY (32 bayt, base64).
const crypto = require('crypto');

function createTokenCipher(base64Key) {
  if (!base64Key) return null;
  const key = Buffer.from(String(base64Key), 'base64');
  if (key.length !== 32) return null;

  return {
    encrypt(value) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
      return ['v1', iv.toString('base64'), Buffer.concat([cipher.getAuthTag(), encrypted]).toString('base64')].join('.');
    },
    decrypt(sealed) {
      const [version, ivText, payloadText] = String(sealed).split('.');
      if (version !== 'v1' || !ivText || !payloadText) throw new Error('Geçersiz şifreli veri.');
      const payload = Buffer.from(payloadText, 'base64');
      if (payload.length < 17) throw new Error('Geçersiz şifreli veri.');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64'));
      decipher.setAuthTag(payload.subarray(0, 16));
      const plain = Buffer.concat([decipher.update(payload.subarray(16)), decipher.final()]);
      return JSON.parse(plain.toString('utf8'));
    },
  };
}

module.exports = { createTokenCipher };
