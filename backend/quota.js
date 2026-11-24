const { createHash, randomUUID } = require('node:crypto');

// Günlük kullanım kotaları. Sayaçlar usage_daily/<uid>_<gün> belgesinde tür bazında tutulur.
// agent ayrı türdür: tek /agent/run isteği birden çok model ve araç çağrısı yapar
// (runner.js DEFAULT_LIMITS), bu yüzden sohbetten düşük sınırı vardır.
// usage_keys icin Firestore TTL politikasi expiresAt alanina kurulmali (konsoldan, elle).
const REFUND_STATUS_CODES = new Set([500, 502, 503, 504]);
const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9_-]{8,128}$/;
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;

function toDate(value) {
  return value instanceof Date ? value : new Date(value);
}

function toMs(value) {
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value === 'string') return Date.parse(value);
  return 0;
}

function normalizeIdempotencyKey(key) {
  return typeof key === 'string' && IDEMPOTENCY_KEY_REGEX.test(key) ? key : null;
}

function createQuota({ firestoreDb, FieldValue, env = process.env, now = () => new Date() }) {
  const FREE_DAILY_QUOTAS = {
    chat: Number(env.FREE_DAILY_CHAT_LIMIT || 50),
    agent: Number(env.FREE_DAILY_AGENT_LIMIT || 10),
    image: Number(env.FREE_DAILY_IMAGE_LIMIT || 5),
    video: Number(env.FREE_DAILY_VIDEO_LIMIT || 2),
    code: Number(env.FREE_DAILY_CODE_LIMIT || 10),
    upload: Number(env.FREE_DAILY_UPLOAD_LIMIT || 5),
    search: Number(env.FREE_DAILY_SEARCH_LIMIT || 30),
    assist: Number(env.FREE_DAILY_ASSIST_LIMIT || 60),
    ide: Number(env.FREE_DAILY_IDE_LIMIT || 150),
    feedback: Number(env.FREE_DAILY_FEEDBACK_LIMIT || 100),
  };
  const PRO_DAILY_QUOTAS = {
    chat: Number(env.PRO_DAILY_CHAT_LIMIT || 1000),
    agent: Number(env.PRO_DAILY_AGENT_LIMIT || 200),
    image: Number(env.PRO_DAILY_IMAGE_LIMIT || 50),
    video: Number(env.PRO_DAILY_VIDEO_LIMIT || 10),
    code: Number(env.PRO_DAILY_CODE_LIMIT || 300),
    upload: Number(env.PRO_DAILY_UPLOAD_LIMIT || 100),
    search: Number(env.PRO_DAILY_SEARCH_LIMIT || 300),
    assist: Number(env.PRO_DAILY_ASSIST_LIMIT || 600),
    ide: Number(env.PRO_DAILY_IDE_LIMIT || 3000),
    feedback: Number(env.PRO_DAILY_FEEDBACK_LIMIT || 300),
  };

  function quotasFromBilling(billing) {
    return billing?.plan === 'pro' && billing?.status === 'active' ? PRO_DAILY_QUOTAS : FREE_DAILY_QUOTAS;
  }

  async function quotasForUser(uid) {
    const user = await firestoreDb.collection('users').doc(uid).get();
    return quotasFromBilling(user.data()?.billing);
  }

  function currentDay() {
    return toDate(now()).toISOString().slice(0, 10);
  }

  async function consumeQuota(uid, kind, rawIdempotencyKey = null, req = null) {
    const nowDate = toDate(now());
    const nowMs = nowDate.getTime();
    const day = nowDate.toISOString().slice(0, 10);
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    const attemptId = idempotencyKey ? randomUUID() : null;
    const route = idempotencyKey ? `${req.method} ${req.baseUrl || ''}${req.path}` : null;
    const bodyHash = idempotencyKey
      ? createHash('sha256').update(JSON.stringify(req.body) ?? '').digest('hex').slice(0, 16)
      : null;
    const ref = firestoreDb.collection('usage_daily').doc(`${uid}_${day}`);
    const userRef = firestoreDb.collection('users').doc(uid);
    const keyRef = idempotencyKey
      ? firestoreDb.collection('usage_keys').doc(`${uid}_${kind}_${idempotencyKey}`)
      : null;
    let limit = 0;
    const { nextCount, consumed } = await firestoreDb.runTransaction(async transaction => {
      const snapshots = keyRef
        ? await transaction.getAll(userRef, ref, keyRef)
        : await transaction.getAll(userRef, ref);
      const [user, snapshot, keySnapshot] = snapshots;
      limit = Number(quotasFromBilling(user.data()?.billing)[kind] || 0);
      if (!limit) return { nextCount: undefined, consumed: false };
      const current = Number(snapshot.data()?.[kind] || 0);
      if (keyRef && keySnapshot?.exists) {
        const keyData = keySnapshot.data() || {};
        if (
          !keyData.refunded &&
          toMs(keyData.expiresAt) > nowMs &&
          keyData.route === route &&
          keyData.bodyHash === bodyHash &&
          keyData.interrupted === true &&
          keyData.replayUsed !== true
        ) {
          transaction.set(keyRef, {
            replayUsed: true,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          return { nextCount: current, consumed: false };
        }
      }
      if (current >= limit) return { nextCount: null, consumed: false };
      transaction.set(ref, {
        uid,
        day,
        [kind]: current + 1,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      if (keyRef) {
        transaction.set(keyRef, {
          uid,
          kind,
          day,
          attemptId,
          route,
          bodyHash,
          expiresAt: new Date(nowMs + IDEMPOTENCY_TTL_MS),
          refunded: false,
          interrupted: false,
          replayUsed: false,
        });
      }
      return { nextCount: current + 1, consumed: true };
    });
    if (nextCount === undefined) {
      return { allowed: true, limit: 0, remaining: null, day, idempotencyKey, consumed: false };
    }
    if (nextCount === null) {
      return { allowed: false, limit, remaining: 0, day, idempotencyKey, consumed: false };
    }
    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - nextCount),
      day,
      idempotencyKey,
      attemptId,
      consumed,
    };
  }

  async function consumeDailyQuota(uid, kind) {
    const { allowed, limit, remaining } = await consumeQuota(uid, kind);
    return { allowed, limit, remaining };
  }

  async function refundDailyQuota(uid, kind, day = currentDay(), rawIdempotencyKey = null, attemptId = null) {
    const ref = firestoreDb.collection('usage_daily').doc(`${uid}_${day}`);
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    const keyRef = idempotencyKey
      ? firestoreDb.collection('usage_keys').doc(`${uid}_${kind}_${idempotencyKey}`)
      : null;
    return firestoreDb.runTransaction(async transaction => {
      const [snapshot, keySnapshot] = keyRef
        ? await transaction.getAll(ref, keyRef)
        : [await transaction.get(ref)];
      const current = Number(snapshot.data()?.[kind] || 0);
      const keyData = keySnapshot?.data();
      if (keyRef && (!attemptId || keyData?.attemptId !== attemptId || keyData.refunded || keyData.replayUsed)) return current;
      const nextCount = Math.max(0, current - 1);
      if (snapshot.exists && current > 0) {
        transaction.set(ref, {
          uid,
          day,
          [kind]: nextCount,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      if (keyRef) {
        transaction.set(keyRef, {
          refunded: true,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      return nextCount;
    });
  }

  async function markKeyInterrupted(uid, kind, idempotencyKey, attemptId) {
    if (!idempotencyKey) return;
    const keyRef = firestoreDb.collection('usage_keys').doc(`${uid}_${kind}_${idempotencyKey}`);
    return firestoreDb.runTransaction(async transaction => {
      const keySnapshot = await transaction.get(keyRef);
      const keyData = keySnapshot.data();
      if (keyData?.attemptId === attemptId && !keyData.refunded) {
        transaction.set(keyRef, {
          interrupted: true,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    });
  }

  function enforceDailyQuota(kind) {
    return async (req, res, next) => {
      const uid = req.user?.uid;
      if (!uid) return next();
      try {
        const rawKey = typeof req.get === 'function' ? req.get('Idempotency-Key') : req.headers?.['idempotency-key'];
        const { allowed, limit, remaining, day, idempotencyKey, attemptId, consumed } = await consumeQuota(uid, kind, rawKey, req);
        if (consumed) {
          res.locals ??= {};
          let refund;
          const refundOnce = () => {
            refund ??= refundDailyQuota(uid, kind, day, idempotencyKey, attemptId).catch(error => {
              console.warn('Kota iadesi yapılamadı:', error.message);
            });
            return refund;
          };
          res.locals.quotaRefund = refundOnce;

          if (res.destroyed || res.closed) {
            // /agent/run kotası sunucuda yönlendiriciden önce çalışır. Bu dalda
            // istek yönlendiriciye hiç ulaşmaz ve hiçbir ajan işi başlatılmaz.
            if (res.locals.quotaCancelsOnClose || (kind === 'agent' && req.route?.path === '/agent/run')) refundOnce();
            return;
          }

          let finished = false;
          res.once('finish', () => {
            finished = true;
            if (REFUND_STATUS_CODES.has(res.statusCode)) refundOnce();
          });
          res.once('close', () => {
            if (REFUND_STATUS_CODES.has(res.statusCode)) {
              refundOnce();
            } else if (!finished && !res.writableFinished && res.locals.quotaCancelsOnClose) {
              if (!res.headersSent) refundOnce();
              else if (!refund) markKeyInterrupted(uid, kind, idempotencyKey, attemptId).catch(error => {
                console.warn('Kesilen istek anahtarı işaretlenemedi:', error.message);
              });
            }
          });
        }
        if (res.destroyed || res.closed) return;
        if (remaining === null) return next();
        res.setHeader('X-Daily-Limit', String(limit));
        if (!allowed) {
          res.setHeader('X-Daily-Remaining', '0');
          return res.status(429).json({ error: `Günlük ${kind} kullanım sınırına ulaştın.`, code: 'daily_limit' });
        }
        res.setHeader('X-Daily-Remaining', String(remaining));
        return next();
      } catch (error) {
        // Kota doğrulanamazsa maliyetli işlemi sınırsız çalıştırma.
        console.warn('Kota kontrolü yapılamadı:', error.message);
        if (res.destroyed || res.closed) return;
        return res.status(503).json({ error: 'Kullanım kotası şu anda doğrulanamıyor, biraz sonra tekrar dene.' });
      }
    };
  }

  return {
    FREE_DAILY_QUOTAS,
    PRO_DAILY_QUOTAS,
    quotasForUser,
    consumeDailyQuota,
    refundDailyQuota,
    enforceDailyQuota,
  };
}

module.exports = { createQuota };
