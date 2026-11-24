// Kullanıcı hafızası ve yönetici profil analizleri için kalıcı Firestore deposu.
// Eskiden /tmp altındaki JSON dosyalarında tutuluyordu; serverless ortamda her
// soğuk başlatmada kayboluyor ve instance'lar arasında paylaşılmıyordu.
// Agent'ın save_memory aracı, web ve mobil aynı `users/{uid}/memories` koleksiyonunu kullanır.

const MAX_KEY_LENGTH = 80;
const MAX_VALUE_LENGTH = 1000;

// Firestore belge kimliği `/` içeremez, `.`/`..` veya `__x__` olamaz.
function memoryDocId(key) {
  const id = String(key || '').trim().replace(/\//g, '-').slice(0, MAX_KEY_LENGTH);
  if (!id || id === '.' || id === '..' || /^__.*__$/.test(id)) throw new Error('Geçersiz hafıza anahtarı.');
  return id;
}

function memoriesRef(firestoreDb, uid) {
  return firestoreDb.collection('users').doc(uid).collection('memories');
}

function toMemory(doc) {
  const data = doc.data() || {};
  return {
    key: data.key || doc.id,
    value: data.value || '',
    category: data.category || 'general',
    source: data.source || 'chat',
    createdAt: data.createdAt || data.updatedAt || null,
    updatedAt: data.updatedAt || null,
  };
}

async function listMemories(firestoreDb, uid, { transaction } = {}) {
  const ref = memoriesRef(firestoreDb, uid);
  const snapshot = await (transaction ? transaction.get(ref) : ref.get());
  return snapshot.docs.map(toMemory).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

async function saveMemory(firestoreDb, uid, { key, value, category, source }) {
  const id = memoryDocId(key);
  const cleanValue = String(value || '').trim().slice(0, MAX_VALUE_LENGTH);
  if (!cleanValue) throw new Error('Hafıza değeri boş olamaz.');
  const ref = memoriesRef(firestoreDb, uid).doc(id);
  const now = new Date().toISOString();
  const memory = await firestoreDb.runTransaction(async transaction => {
    const existing = await transaction.get(ref);
    const next = {
      key: String(key).trim().slice(0, MAX_KEY_LENGTH),
      value: cleanValue,
      category: String(category || 'general').slice(0, 50),
      // Başka uygulamadan taşınan bilgi "import"; sohbetten gelen kayıt bu işareti kaldırır.
      source: source === 'import' ? 'import' : 'chat',
      createdAt: existing.exists ? (existing.data().createdAt || now) : now,
      updatedAt: now,
    };
    transaction.set(ref, next);
    return next;
  });
  return memory;
}

async function deleteMemory(firestoreDb, uid, key) {
  await memoriesRef(firestoreDb, uid).doc(memoryDocId(key)).delete();
}

async function deleteAllMemories(firestoreDb, uid) {
  const ref = memoriesRef(firestoreDb, uid);
  while (true) {
    const snapshot = await ref.limit(300).get();
    if (snapshot.empty) return;
    const batch = firestoreDb.batch();
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    if (snapshot.size < 300) return;
  }
}

// Yönetici profil analizleri istemci kurallarıyla kapalı `admin_profiles` koleksiyonunda durur.
function profilesRef(firestoreDb) {
  return firestoreDb.collection('admin_profiles');
}

async function getProfile(firestoreDb, uid) {
  const doc = await profilesRef(firestoreDb).doc(uid).get();
  return doc.exists ? doc.data() : null;
}

async function saveProfile(firestoreDb, uid, profile) {
  await profilesRef(firestoreDb).doc(uid).set(profile);
  return profile;
}

async function listProfiles(firestoreDb) {
  const snapshot = await profilesRef(firestoreDb).get();
  return Object.fromEntries(snapshot.docs.map(doc => [doc.id, doc.data()]));
}

async function deleteProfile(firestoreDb, uid) {
  await profilesRef(firestoreDb).doc(uid).delete();
}

module.exports = {
  memoryDocId,
  listMemories,
  saveMemory,
  deleteMemory,
  deleteAllMemories,
  getProfile,
  saveProfile,
  listProfiles,
  deleteProfile,
};
