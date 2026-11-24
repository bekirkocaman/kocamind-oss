const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const TOKEN_PARAM_RE = /^[A-Za-z0-9_-]{32,200}$/;
const CODE_TTL_MS = 120 * 1000;

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function isValidTokenParam(value) {
  return typeof value === 'string' && TOKEN_PARAM_RE.test(value);
}

function registerIdeAuthPublicRoutes(app, {
  firestoreDb,
  firebaseAuth,
  now = () => Date.now(),
  randomBytes = crypto.randomBytes,
} = {}) {
  void randomBytes;
  const exchangeLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    message: { error: { message: 'Çok fazla istek gönderdin, biraz bekle.' } },
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.post('/ide/auth/exchange', exchangeLimiter, async (req, res) => {
    const code = req.body?.code;
    const state = req.body?.state;
    if (!isValidTokenParam(code) || !isValidTokenParam(state)) {
      return res.status(400).json({ error: { message: 'Geçersiz istek.' } });
    }

    const codeHash = sha256Hex(code);
    const stateHash = sha256Hex(state);
    const docRef = firestoreDb.collection('ide_login_codes').doc(codeHash);

    try {
      const uid = await firestoreDb.runTransaction(async (tx) => {
        const snap = await tx.get(docRef);
        if (!snap || !snap.exists) return null;
        const data = snap.data() || {};
        if (data.used === true) return null;
        if (typeof data.expiresAt !== 'number' || now() > data.expiresAt) return null;
        if (!timingSafeEqualHex(data.stateHash, stateHash)) return null;
        if (typeof data.uid !== 'string' || !data.uid) return null;
        await tx.set(docRef, { ...data, used: true });
        return data.uid;
      });

      if (!uid) {
        return res.status(400).json({ error: { message: 'Giriş kodu geçersiz ya da süresi dolmuş.' } });
      }

      const customToken = await firebaseAuth.createCustomToken(uid, { ide: true });
      return res.json({ customToken });
    } catch {
      return res.status(500).json({ error: { message: 'Sunucu hatası.' } });
    }
  });
}

function registerIdeAuthPrivateRoutes(app, {
  firestoreDb,
  firebaseAuth,
  now = () => Date.now(),
  randomBytes = crypto.randomBytes,
} = {}) {
  void firebaseAuth;
  const codeLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    keyGenerator: (req) => req.user?.uid || req.ip,
    message: { error: { message: 'Çok fazla istek gönderdin, biraz bekle.' } },
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.post('/ide/auth/code', codeLimiter, async (req, res) => {
    const uid = req.user?.uid;
    if (!uid) {
      return res.status(401).json({ error: { message: 'Oturum açman gerekiyor.' } });
    }

    const state = req.body?.state;
    if (!isValidTokenParam(state)) {
      return res.status(400).json({ error: { message: 'Geçersiz istek.' } });
    }

    try {
      const currentNow = now();
      const existingSnap = await firestoreDb
        .collection('ide_login_codes')
        .where('uid', '==', uid)
        .limit(20)
        .get();
      if (existingSnap && !existingSnap.empty) {
        const staleDocs = existingSnap.docs.filter((doc) => {
          const data = doc.data() || {};
          return data.used === true || (typeof data.expiresAt === 'number' && data.expiresAt < currentNow);
        });
        if (staleDocs.length > 0) {
          const batch = firestoreDb.batch();
          for (const doc of staleDocs) {
            batch.delete(doc.ref);
          }
          await batch.commit();
        }
      }

      const code = randomBytes(32).toString('base64url');
      const codeHash = sha256Hex(code);
      const stateHash = sha256Hex(state);

      await firestoreDb.collection('ide_login_codes').doc(codeHash).set({
        uid,
        stateHash,
        expiresAt: currentNow + CODE_TTL_MS,
        used: false,
      });

      return res.json({ code });
    } catch {
      return res.status(500).json({ error: { message: 'Sunucu hatası.' } });
    }
  });
}

module.exports = {
  registerIdeAuthPublicRoutes,
  registerIdeAuthPrivateRoutes,
};
