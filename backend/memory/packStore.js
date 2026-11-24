// Kullanıcı hafıza paketini Firestore'da saklar, önbellekler ve zaman aşımıyla okur.

const memoryStore = require('../memoryStore');
const { buildPack } = require('./pack');

function nowMs(now) {
  const value = now();
  return typeof value === 'number' ? value : value.getTime();
}

function nowDate(now) {
  const value = now();
  return value instanceof Date ? value : new Date(value);
}

function withTimeout(promise, ms) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Zaman aşımı (${ms} ms)`));
    }, ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
}

function createPackStore({
  firestoreDb,
  now = () => new Date(),
  timeoutMs = 150,
  firstBuildTimeoutMs = 1000,
  cacheMs = 60000,
}) {
  const cache = new Map();

  function packRef(uid) {
    return firestoreDb.collection('users').doc(uid).collection('memory_pack').doc('current');
  }

  async function rebuild(uid, { lastLearn } = {}) {
    const ref = packRef(uid);
    const pack = await firestoreDb.runTransaction(async transaction => {
      const existingDoc = await transaction.get(ref);
      const memories = await memoryStore.listMemories(firestoreDb, uid, { transaction });
      const existing = existingDoc.exists ? existingDoc.data() : null;
      const previousVersion = Number(existing?.version) || 0;
      const resolvedLastLearn = lastLearn !== undefined ? lastLearn : (existing?.lastLearn ?? null);
      const nextPack = buildPack(memories, {
        previousVersion,
        lastLearn: resolvedLastLearn,
        now: () => nowDate(now),
      });
      await transaction.set(ref, nextPack);
      return nextPack;
    });
    cache.set(uid, { at: nowMs(now), pack });
    return pack;
  }

  async function get(uid) {
    if (!uid) return null;
    const cached = cache.get(uid);
    if (cached && nowMs(now) - cached.at < cacheMs) {
      return cached.pack;
    }
    try {
      const snapshot = await withTimeout(packRef(uid).get(), timeoutMs);
      if (snapshot && snapshot.exists) {
        const pack = snapshot.data();
        cache.set(uid, { at: nowMs(now), pack });
        return pack;
      }
      return await withTimeout(rebuild(uid), firstBuildTimeoutMs);
    } catch (error) {
      console.warn('Hafıza paketi okunamadı:', error.message);
      return null;
    }
  }

  async function remove(uid) {
    if (!uid) return;
    cache.delete(uid);
    await packRef(uid).delete();
  }

  return { get, rebuild, remove };
}

module.exports = { createPackStore };
