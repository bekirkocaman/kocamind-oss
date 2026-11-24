const test = require('node:test');
const assert = require('node:assert/strict');
const memoryStore = require('../memoryStore');
const { createPackStore } = require('../memory/packStore');
const { fakeFirestore } = require('./fakeFirestore');

test('belge yoksa paket bir kez derlenir ve döner', async () => {
  const db = fakeFirestore();
  await memoryStore.saveMemory(db, 'u1', { key: 'isim', value: 'Bekir', category: 'kisisel' });
  await memoryStore.saveMemory(db, 'u1', { key: 'şehir', value: 'İstanbul', category: 'konum' });

  const store = createPackStore({
    firestoreDb: db,
    now: () => new Date('2026-11-10T12:00:00.000Z'),
  });

  const pack = await store.get('u1');
  assert.ok(pack);
  assert.equal(pack.version, 1);
  assert.deepEqual(pack.core, [{ key: 'isim', value: 'Bekir' }]);
  assert.deepEqual(pack.optional, [{ key: 'şehir', value: 'İstanbul' }]);
  assert.ok(db.docs.has('users/u1/memory_pack/current'));
  assert.equal(db.docs.get('users/u1/memory_pack/current').version, 1);
});

test('ikinci okuma Firestore\'a gitmez', async () => {
  const baseDb = fakeFirestore();
  await memoryStore.saveMemory(baseDb, 'u1', { key: 'isim', value: 'Bekir', category: 'kisisel' });

  let packGetCount = 0;
  const origCollection = baseDb.collection;
  const db = {
    ...baseDb,
    collection: name => {
      const col = origCollection(name);
      if (name !== 'users') return col;
      return {
        ...col,
        doc: uid => {
          const userDoc = col.doc(uid);
          return {
            ...userDoc,
            collection: sub => {
              const subCol = userDoc.collection(sub);
              if (sub !== 'memory_pack') return subCol;
              return {
                ...subCol,
                doc: id => {
                  const ref = subCol.doc(id);
                  return {
                    ...ref,
                    get: async () => {
                      packGetCount += 1;
                      return ref.get();
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  const store = createPackStore({
    firestoreDb: db,
    now: () => new Date('2026-11-10T12:00:00.000Z'),
  });

  await store.rebuild('u1');
  const countAfterRebuild = packGetCount;

  const first = await store.get('u1');
  const second = await store.get('u1');
  assert.equal(first.version, 1);
  assert.equal(second.version, 1);
  assert.equal(packGetCount, countAfterRebuild);
});

test('60 saniye sonra önbellek yenilenir', async () => {
  const db = fakeFirestore();
  let currentMs = Date.parse('2026-11-10T12:00:00.000Z');
  const store = createPackStore({
    firestoreDb: db,
    now: () => new Date(currentMs),
    cacheMs: 60000,
  });

  await memoryStore.saveMemory(db, 'u1', { key: 'isim', value: 'Bekir', category: 'kisisel' });
  await store.get('u1');

  // Doğrudan Firestore'daki belgeyi güncelle
  db.docs.set('users/u1/memory_pack/current', {
    version: 9,
    builtAt: '2026-11-10T12:00:30.000Z',
    core: [{ key: 'isim', value: 'Yeni' }],
    optional: [],
    lastLearn: null,
  });

  // 59. saniyede hala önbellekten döner
  currentMs += 59000;
  assert.equal((await store.get('u1')).version, 1);

  // 61. saniyede Firestore'dan yenilenir
  currentMs += 2000;
  const refreshed = await store.get('u1');
  assert.equal(refreshed.version, 9);
  assert.deepEqual(refreshed.core, [{ key: 'isim', value: 'Yeni' }]);
});

test('okuma 150 ms\'yi aşarsa null döner', async () => {
  const slowDb = {
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: () => ({
            get: () => new Promise(resolve => setTimeout(() => resolve({ exists: true, data: () => ({ version: 1 }) }), 100)),
          }),
        }),
      }),
    }),
  };

  const store = createPackStore({
    firestoreDb: slowDb,
    timeoutMs: 20,
  });

  const result = await store.get('u1');
  assert.equal(result, null);
});

test('Firestore hata verirse null döner, fırlatmaz', async () => {
  const failingDb = {
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: () => ({
            get: async () => {
              throw new Error('firestore bağlantı hatası');
            },
          }),
        }),
      }),
    }),
  };

  const store = createPackStore({ firestoreDb: failingDb });
  const result = await store.get('u1');
  assert.equal(result, null);
});

test('eşzamanlı iki rebuild sürümü geri götürmez', async () => {
  const db = fakeFirestore();
  await memoryStore.saveMemory(db, 'u1', { key: 'isim', value: 'Bekir', category: 'kisisel' });

  const store = createPackStore({
    firestoreDb: db,
    now: () => new Date('2026-11-10T12:00:00.000Z'),
  });

  const [p1, p2] = await Promise.all([store.rebuild('u1'), store.rebuild('u1')]);
  const versions = [p1.version, p2.version].sort((a, b) => a - b);

  assert.deepEqual(versions, [1, 2]);
  assert.equal(db.docs.get('users/u1/memory_pack/current').version, 2);
});

test('rebuild lastLearn verilmezse eskisini korur', async () => {
  const db = fakeFirestore();
  const store = createPackStore({
    firestoreDb: db,
    now: () => new Date('2026-11-10T12:00:00.000Z'),
  });

  const learnInfo = { at: '2026-11-10T11:59:00.000Z', saved: [{ key: 'isim', isNew: true }], forgotten: [] };
  await store.rebuild('u1', { lastLearn: learnInfo });

  const second = await store.rebuild('u1');
  assert.deepEqual(second.lastLearn, learnInfo);
});

test('rebuild lastLearn verilirse yazar', async () => {
  const db = fakeFirestore();
  const store = createPackStore({
    firestoreDb: db,
    now: () => new Date('2026-11-10T12:00:00.000Z'),
  });

  await store.rebuild('u1');
  const learnInfo = { at: '2026-11-10T12:00:00.000Z', saved: [{ key: 'dil', isNew: true }], forgotten: ['eski'] };
  const updated = await store.rebuild('u1', { lastLearn: learnInfo });

  assert.deepEqual(updated.lastLearn, learnInfo);
  assert.deepEqual(db.docs.get('users/u1/memory_pack/current').lastLearn, learnInfo);
});

test('remove belgeyi ve önbelleği siler', async () => {
  const db = fakeFirestore();
  await memoryStore.saveMemory(db, 'u1', { key: 'isim', value: 'Bekir', category: 'kisisel' });

  const store = createPackStore({
    firestoreDb: db,
    now: () => new Date('2026-11-10T12:00:00.000Z'),
  });

  await store.get('u1');
  assert.ok(db.docs.has('users/u1/memory_pack/current'));

  await memoryStore.deleteAllMemories(db, 'u1');
  await store.remove('u1');
  assert.ok(!db.docs.has('users/u1/memory_pack/current'));

  // Önbellek silindiği için sonraki get yeniden derler (artık hafıza boş)
  const fresh = await store.get('u1');
  assert.deepEqual(fresh.core, []);
  assert.equal(fresh.version, 1);
});

test('uid yoksa get null döner', async () => {
  const db = fakeFirestore();
  const store = createPackStore({ firestoreDb: db });

  assert.equal(await store.get(''), null);
  assert.equal(await store.get(null), null);
  assert.equal(await store.get(undefined), null);
});

test('rebuild kayıtları transaction içinde okur', async () => {
  const baseDb = fakeFirestore();
  await memoryStore.saveMemory(baseDb, 'u1', { key: 'isim', value: 'Bekir', category: 'kisisel' });

  const events = [];
  let inTx = false;
  const origCollection = baseDb.collection;

  const db = {
    ...baseDb,
    collection: name => {
      const col = origCollection(name);
      if (name !== 'users') return col;
      return {
        ...col,
        doc: uid => {
          const userDoc = col.doc(uid);
          return {
            ...userDoc,
            collection: sub => {
              const subCol = userDoc.collection(sub);
              if (sub !== 'memories') return subCol;
              return {
                ...subCol,
                get: async () => {
                  events.push(inTx ? 'list:inTx' : 'list:outTx');
                  return subCol.get();
                },
              };
            },
          };
        },
      };
    },
    runTransaction: async fn => {
      events.push('tx');
      inTx = true;
      try {
        return await baseDb.runTransaction(fn);
      } finally {
        inTx = false;
      }
    },
  };

  const store = createPackStore({
    firestoreDb: db,
    now: () => new Date('2026-11-10T12:00:00.000Z'),
  });

  await store.rebuild('u1');
  assert.deepEqual(events, ['tx', 'list:inTx']);
});

test('yavaş başlayan eski derleme yeni kaydı ezmez', async () => {
  const baseDb = fakeFirestore();
  await memoryStore.saveMemory(baseDb, 'u1', { key: 'isim', value: 'Bekir', category: 'kisisel' });

  let firstMemoriesRead = true;
  const origCollection = baseDb.collection;
  const db = {
    ...baseDb,
    collection: name => {
      const col = origCollection(name);
      if (name !== 'users') return col;
      return {
        ...col,
        doc: uid => {
          const userDoc = col.doc(uid);
          return {
            ...userDoc,
            collection: sub => {
              const subCol = userDoc.collection(sub);
              if (sub !== 'memories') return subCol;
              return {
                ...subCol,
                get: async () => {
                  const snapPromise = subCol.get();
                  if (firstMemoriesRead) {
                    firstMemoriesRead = false;
                    await new Promise(resolve => setTimeout(resolve, 20));
                  }
                  return snapPromise;
                },
              };
            },
          };
        },
      };
    },
  };

  const store = createPackStore({
    firestoreDb: db,
    now: () => new Date('2026-11-10T12:00:00.000Z'),
  });

  const rebuildA = store.rebuild('u1');
  await memoryStore.saveMemory(db, 'u1', { key: 'şehir', value: 'İstanbul', category: 'kisisel' });
  const rebuildB = store.rebuild('u1');

  await Promise.all([rebuildA, rebuildB]);

  const finalPack = db.docs.get('users/u1/memory_pack/current');
  assert.equal(finalPack.version, 2);
  assert.deepEqual(finalPack.core.map(m => m.key).sort(), ['isim', 'şehir']);
});

test('transaction başarısız olursa önbelleğe paket yazılmaz', async () => {
  const baseDb = fakeFirestore();
  await memoryStore.saveMemory(baseDb, 'u1', { key: 'isim', value: 'Bekir', category: 'kisisel' });

  const failingTxDb = {
    ...baseDb,
    runTransaction: async fn => {
      await fn({
        get: ref => ref.get(),
        getAll: (...refs) => Promise.all(refs.map(ref => ref.get())),
        set: () => {},
        delete: () => {},
      });
      throw new Error('commit başarısız');
    },
  };

  const store = createPackStore({
    firestoreDb: failingTxDb,
    now: () => new Date('2026-11-10T12:00:00.000Z'),
  });

  await assert.rejects(() => store.rebuild('u1'), /commit başarısız/);
  const result = await store.get('u1');
  assert.equal(result, null);
});
