const test = require('node:test');
const assert = require('node:assert/strict');
const memoryStore = require('../memoryStore');
const { createDefaultToolRegistry } = require('../agent/tools');

const { fakeFirestore } = require('./fakeFirestore');

test('hafıza kaydedilir, güncellenir, listelenir ve silinir', async () => {
  const db = fakeFirestore();
  const first = await memoryStore.saveMemory(db, 'u1', { key: 'şehir', value: 'İstanbul' });
  const second = await memoryStore.saveMemory(db, 'u1', { key: 'şehir', value: 'Ankara', category: 'konum' });
  assert.equal(second.createdAt, first.createdAt);
  assert.deepEqual((await memoryStore.listMemories(db, 'u1')).map(m => [m.key, m.value, m.category]), [['şehir', 'Ankara', 'konum']]);
  assert.deepEqual(await memoryStore.listMemories(db, 'u2'), []);

  await memoryStore.saveMemory(db, 'u1', { key: 'dil', value: 'Türkçe' });
  await memoryStore.deleteMemory(db, 'u1', 'şehir');
  assert.deepEqual((await memoryStore.listMemories(db, 'u1')).map(m => m.key), ['dil']);
  await memoryStore.deleteAllMemories(db, 'u1');
  assert.deepEqual(await memoryStore.listMemories(db, 'u1'), []);
});

test('hafıza anahtarı Firestore yolunu bozamaz', async () => {
  const db = fakeFirestore();
  await memoryStore.saveMemory(db, 'u1', { key: '../../users/u2', value: 'x' });
  assert.ok([...db.docs.keys()].every(path => path.startsWith('users/u1/memories/')));
  assert.throws(() => memoryStore.memoryDocId('..'));
  assert.throws(() => memoryStore.memoryDocId('__name__'));
  assert.throws(() => memoryStore.memoryDocId('  '));
});

test('agent save_memory aracı web hafızasıyla aynı depoya yazar', async () => {
  const db = fakeFirestore();
  const tool = createDefaultToolRegistry({ env: {} }).get('save_memory');
  await tool.execute({ key: 'renk', value: 'mavi', category: 'general' }, { userId: 'u1', firestoreDb: db });
  assert.deepEqual((await memoryStore.listMemories(db, 'u1')).map(m => [m.key, m.value]), [['renk', 'mavi']]);
});

test('yönetici profilleri kalıcı depoda tutulur', async () => {
  const db = fakeFirestore();
  await memoryStore.saveProfile(db, 'u1', { analysis: 'a', messageCount: 3 });
  assert.equal((await memoryStore.getProfile(db, 'u1')).analysis, 'a');
  assert.deepEqual(Object.keys(await memoryStore.listProfiles(db)), ['u1']);
  await memoryStore.deleteProfile(db, 'u1');
  assert.equal(await memoryStore.getProfile(db, 'u1'), null);
});

test('listMemories transaction verilince onunla okur', async () => {
  const db = fakeFirestore();
  await memoryStore.saveMemory(db, 'u1', { key: 'isim', value: 'Bekir', category: 'kisisel' });

  let txGetCalled = false;
  const transaction = {
    get: async ref => {
      txGetCalled = true;
      return ref.get();
    },
  };

  const list = await memoryStore.listMemories(db, 'u1', { transaction });
  assert.equal(txGetCalled, true);
  assert.deepEqual(list.map(m => [m.key, m.value, m.category]), [['isim', 'Bekir', 'kisisel']]);
});

test('save_memory aracı kayıttan sonra paketi yeniler; rebuild hata verse de araç başarılı döner', async () => {
  const db = fakeFirestore();
  const tool = createDefaultToolRegistry({ env: {} }).get('save_memory');

  const rebuiltUids = [];
  const packStore = {
    rebuild: async uid => {
      rebuiltUids.push(uid);
    },
  };

  const res1 = await tool.execute(
    { key: 'isim', value: 'Bekir', category: 'kisisel' },
    { userId: 'u1', firestoreDb: db, packStore }
  );
  assert.deepEqual(res1, { saved: true, key: 'isim' });
  assert.deepEqual(rebuiltUids, ['u1']);

  const failingPackStore = {
    rebuild: async () => {
      throw new Error('rebuild hatası');
    },
  };
  const res2 = await tool.execute(
    { key: 'şehir', value: 'Ankara', category: 'konum' },
    { userId: 'u1', firestoreDb: db, packStore: failingPackStore }
  );
  assert.deepEqual(res2, { saved: true, key: 'şehir' });
});
