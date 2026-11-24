const test = require('node:test');
const assert = require('node:assert/strict');
const memoryStore = require('../memoryStore');
const { createPackStore } = require('../memory/packStore');
const { createLearner } = require('../memory/learn');
const { fakeFirestore } = require('./fakeFirestore');

const fixedNow = () => new Date('2026-11-10T12:00:00.000Z');

function withAssistKey(fn) {
  return async () => {
    const prev = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = 'test-key';
    try {
      await fn();
    } finally {
      if (prev === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = prev;
    }
  };
}

function modelFetch(resultObj, usage = { total_tokens: 42 }) {
  let calls = 0;
  const fetch = async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(resultObj) } }],
        usage,
      }),
    };
  };
  return { fetch, calls: () => calls };
}

test('kişisel bilgi içermeyen mesajda model çağrılmaz ve kota düşülmez', withAssistKey(async () => {
  const db = fakeFirestore();
  const { fetch, calls } = modelFetch({ memories: [{ key: 'isim', value: 'Bekir', category: 'kisisel' }], forget: [] });
  let quotaCalls = 0;
  const learner = createLearner({ firestoreDb: db, fetch, now: fixedNow });

  const result = await learner.learn({
    uid: 'u1',
    message: 'Türkiye Cumhuriyeti hangi yılda kuruldu?',
    consumeQuota: async () => {
      quotaCalls += 1;
      return true;
    },
  });

  assert.deepEqual(result, { saved: [], forgotten: [], skipped: true, usage: null });
  assert.equal(calls(), 0);
  assert.equal(quotaCalls, 0);
}));

test('yeni bilgi kaydedilir ve isNew true gelir', withAssistKey(async () => {
  const db = fakeFirestore();
  const { fetch } = modelFetch({
    memories: [{ key: 'isim', value: 'Bekir', category: 'kisisel' }],
    forget: [],
  });
  const learner = createLearner({ firestoreDb: db, fetch, now: fixedNow });

  const result = await learner.learn({
    uid: 'u1',
    message: 'Benim adım Bekir, bunu hatırla.',
  });

  assert.equal(result.skipped, false);
  assert.equal(result.saved.length, 1);
  assert.equal(result.saved[0].key, 'isim');
  assert.equal(result.saved[0].value, 'Bekir');
  assert.equal(result.saved[0].isNew, true);
}));

test('aynı değer tekrar kaydedilmez', withAssistKey(async () => {
  const db = fakeFirestore();
  await memoryStore.saveMemory(db, 'u1', { key: 'isim', value: 'Bekir', category: 'kisisel' });

  const { fetch } = modelFetch({
    memories: [{ key: 'isim', value: 'Bekir', category: 'kisisel' }],
    forget: [],
  });
  const learner = createLearner({ firestoreDb: db, fetch, now: fixedNow });

  const result = await learner.learn({
    uid: 'u1',
    message: 'Benim adım Bekir.',
  });

  assert.deepEqual(result.saved, []);
  assert.deepEqual(result.forgotten, []);
}));

test('100 kayıt sınırında yeni kayıt atlanır, güncelleme yapılır', withAssistKey(async () => {
  const db = fakeFirestore();
  for (let i = 0; i < 100; i++) {
    await memoryStore.saveMemory(db, 'u1', { key: `k_${i}`, value: `v_${i}`, category: 'genel' });
  }

  const { fetch } = modelFetch({
    memories: [
      { key: 'yeni_anahtar', value: 'yeni_deger', category: 'genel' },
      { key: 'k_0', value: 'guncel_deger', category: 'genel' },
    ],
    forget: [],
  });
  const learner = createLearner({ firestoreDb: db, fetch, now: fixedNow });

  const result = await learner.learn({
    uid: 'u1',
    message: 'Benim yeni bilgim ve güncellenen bilgim.',
  });

  assert.equal(result.saved.length, 1);
  assert.equal(result.saved[0].key, 'k_0');
  assert.equal(result.saved[0].value, 'guncel_deger');
  assert.equal(result.saved[0].isNew, false);
}));

test('kayıt sonrası paketin lastLearn alanı dolar', withAssistKey(async () => {
  const db = fakeFirestore();
  const packStore = createPackStore({ firestoreDb: db, now: fixedNow });
  const { fetch } = modelFetch({
    memories: [{ key: 'isim', value: 'Bekir', category: 'kisisel' }],
    forget: [],
  });
  const learner = createLearner({ firestoreDb: db, fetch, packStore, now: fixedNow });

  await learner.learn({
    uid: 'u1',
    message: 'Benim adım Bekir.',
  });

  const pack = await packStore.get('u1');
  assert.deepEqual(pack.lastLearn, {
    at: '2026-11-10T12:00:00.000Z',
    saved: [{ key: 'isim', isNew: true }],
    forgotten: [],
  });
}));

test('hiçbir şey değişmediyse paket yeniden derlenmez', withAssistKey(async () => {
  const db = fakeFirestore();
  await memoryStore.saveMemory(db, 'u1', { key: 'isim', value: 'Bekir', category: 'kisisel' });

  let rebuildCalls = 0;
  const packStore = {
    rebuild: async () => { rebuildCalls += 1; },
  };
  const { fetch } = modelFetch({
    memories: [{ key: 'isim', value: 'Bekir', category: 'kisisel' }],
    forget: [],
  });
  const learner = createLearner({ firestoreDb: db, fetch, packStore, now: fixedNow });

  await learner.learn({
    uid: 'u1',
    message: 'Benim adım Bekir.',
  });

  assert.equal(rebuildCalls, 0);
}));

test('consumeQuota false dönerse model çağrılmaz', withAssistKey(async () => {
  const db = fakeFirestore();
  const { fetch, calls } = modelFetch({
    memories: [{ key: 'isim', value: 'Bekir', category: 'kisisel' }],
    forget: [],
  });
  const learner = createLearner({ firestoreDb: db, fetch, now: fixedNow });

  const result = await learner.learn({
    uid: 'u1',
    message: 'Benim adım Bekir.',
    consumeQuota: async () => false,
  });

  assert.deepEqual(result, { saved: [], forgotten: [], skipped: true, usage: null });
  assert.equal(calls(), 0);
}));

test('kayıt döngüsü ortada hata verirse o ana kadar yazılanlar pakete girer ve hata fırlatılır', withAssistKey(async () => {
  const baseDb = fakeFirestore();
  const packStore = createPackStore({ firestoreDb: baseDb, now: fixedNow });

  let saveCount = 0;
  const origRunTx = baseDb.runTransaction;
  const db = {
    ...baseDb,
    runTransaction: async fn => {
      return origRunTx(async tx => {
        const wrappedTx = {
          ...tx,
          set: (ref, data, options) => {
            if (ref.path.startsWith('users/u1/memories/')) {
              saveCount += 1;
              if (saveCount === 2) {
                throw new Error('ikinci kayıtta yazma hatası');
              }
            }
            return tx.set(ref, data, options);
          },
        };
        return fn(wrappedTx);
      });
    },
  };

  const { fetch } = modelFetch({
    memories: [
      { key: 'isim', value: 'Bekir', category: 'kisisel' },
      { key: 'şehir', value: 'İstanbul', category: 'kisisel' },
    ],
    forget: [],
  });
  const learner = createLearner({ firestoreDb: db, fetch, packStore, now: fixedNow });

  await assert.rejects(
    () => learner.learn({ uid: 'u1', message: 'Benim adım Bekir ve İstanbulda yaşıyorum.' }),
    /ikinci kayıtta yazma hatası/
  );

  const pack = await packStore.get('u1');
  assert.deepEqual(pack.core, [{ key: 'isim', value: 'Bekir' }]);
  assert.deepEqual(pack.lastLearn, {
    at: '2026-11-10T12:00:00.000Z',
    saved: [{ key: 'isim', isNew: true }],
    forgotten: [],
  });
}));

test('unutulan anahtar silinir ve lastLearn.forgotten içinde görünür', withAssistKey(async () => {
  const db = fakeFirestore();
  await memoryStore.saveMemory(db, 'u1', { key: 'şehir', value: 'İstanbul', category: 'kisisel' });
  const packStore = createPackStore({ firestoreDb: db, now: fixedNow });

  const { fetch } = modelFetch({
    memories: [],
    forget: ['şehir'],
  });
  const learner = createLearner({ firestoreDb: db, fetch, packStore, now: fixedNow });

  const result = await learner.learn({
    uid: 'u1',
    message: 'Benim yaşadığım şehri artık unut.',
  });

  assert.deepEqual(result.forgotten, ['şehir']);
  const pack = await packStore.get('u1');
  assert.deepEqual(pack.core, []);
  assert.deepEqual(pack.lastLearn, {
    at: '2026-11-10T12:00:00.000Z',
    saved: [],
    forgotten: ['şehir'],
  });
}));
