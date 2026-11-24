const { buildEmail, createMailer, escapeHtml } = require('./mailer');
const { actionLink } = require('./authAction');

// Firebase doğrulama mailinin metnini kilitlediği için kimlik e-postaları kendimiz gönderilir:
// bağlantıyı Firebase Admin üretir, tasarımlı maili Resend iletir, bağlantı bizim sayfamızı açar.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Eski ad korunur: şifre ve doğrulama maillerinin içeriği. */
function renderAuthEmail(kind, data) {
  return buildEmail(kind, data);
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function firstName(name) {
  const first = String(name || '').trim().split(/\s+/)[0];
  return first ? first.slice(0, 40) : '';
}

function registerAuthEmailRoutes(app, { firebaseAuth, fetch, firestoreDb, env = process.env }) {
  const mailer = createMailer({ fetch, env });
  const actionBase = env.ACCOUNT_ACTION_URL || env.PUBLIC_BACKEND_URL || 'https://api.kocamind.com';
  const fail = res => res.status(502).json({ fallback: true, error: 'E-posta gönderilemedi.' });
  const notConfigured = res => res.status(503).json({ fallback: true, error: 'E-posta servisi yapılandırılmadı.' });

  async function bearerUser(req) {
    const authorization = req.headers.authorization || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!token) return null;
    try {
      return await firebaseAuth.verifyIdToken(token);
    } catch {
      return null;
    }
  }

  app.post('/auth/email/password-reset', async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Geçerli bir e-posta adresi gir.' });
    if (!mailer.configured()) return notConfigured(res);
    let link;
    try {
      link = await firebaseAuth.generatePasswordResetLink(email);
    } catch (error) {
      // Kayıtlı olmayan adres için de aynı yanıt: hangi adreslerin hesabı olduğu dışarı sızmaz.
      if (error.code === 'auth/user-not-found' || error.code === 'auth/email-not-found') return res.json({ success: true });
      console.error('Sıfırlama bağlantısı üretilemedi:', error.code || error.message);
      return fail(res);
    }
    const sent = await mailer.send('reset', email, { email, link: actionLink(link, actionBase) });
    return sent ? res.json({ success: true }) : fail(res);
  });

  app.post('/auth/email/verification', async (req, res) => {
    if (!req.headers.authorization) return res.status(401).json({ error: 'Oturum açman gerekiyor.' });
    const user = await bearerUser(req);
    if (!user) return res.status(401).json({ error: 'Oturum süresi dolmuş veya geçersiz.' });
    // Mail yalnızca oturumdaki hesabın kendi adresine gider; gövdedeki adres yok sayılır.
    const email = normalizeEmail(user.email);
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Hesapta e-posta adresi yok.' });
    if (!mailer.configured()) return notConfigured(res);
    try {
      const link = await firebaseAuth.generateEmailVerificationLink(email);
      const sent = await mailer.send('verify', email, { email, link: actionLink(link, actionBase) });
      return sent ? res.json({ success: true }) : fail(res);
    } catch (error) {
      console.error('Doğrulama maili gönderilemedi:', error.code || error.message);
      return fail(res);
    }
  });

  // Hoş geldin: e-postası doğrulanmış her hesaba bir kez (Google ile girenler dahil).
  app.post('/auth/email/welcome', async (req, res) => {
    const user = await bearerUser(req);
    if (!user) return res.status(401).json({ error: 'Oturum açman gerekiyor.' });
    if (user.email_verified !== true) return res.status(403).json({ error: 'E-posta doğrulanmadı.' });
    const email = normalizeEmail(user.email);
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Hesapta e-posta adresi yok.' });
    if (!mailer.configured() || !firestoreDb) return notConfigured(res);
    try {
      const ref = firestoreDb.collection('welcome_emails').doc(user.uid);
      const claimed = await firestoreDb.runTransaction(async tx => {
        const doc = await tx.get(ref);
        if (doc.exists) return false;
        tx.set(ref, { uid: user.uid, sentAt: new Date().toISOString() });
        return true;
      });
      if (!claimed) return res.json({ success: true, alreadySent: true });
      await mailer.send('welcome', email, { name: firstName(user.name) });
      return res.json({ success: true });
    } catch (error) {
      console.error('Hoş geldin maili gönderilemedi:', error.message);
      return fail(res);
    }
  });
}

module.exports = { renderAuthEmail, registerAuthEmailRoutes, escapeHtml };
