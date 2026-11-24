const crypto = require('node:crypto');
const memoryStore = require('../memoryStore');

// Kullanıcıya ait üst düzey koleksiyonlar ve kullanıcı kimliğini tutan alan adı.
// Dışa aktarma ve silme aynı listeyi kullanır; yeni kullanıcı verisi eklenince buraya da eklenmeli.
const USER_OWNED_COLLECTIONS = [
  ['feedback', 'uid'],
  ['bug_reports', 'uid'],
  ['usage_daily', 'uid'],
  ['usage_keys', 'uid'],
  ['client_errors', 'uid'],
  ['product_events', 'uid'],
  ['video_jobs', 'uid'],
  ['agent_runs', 'userId'],
  ['tool_executions', 'userId'],
  ['confirmation_requests', 'userId'],
  ['welcome_emails', 'uid'],
  // Bağlı hesaplar (Notion, Google...): şifreli tokenlar kalıcı silmede bununla gider.
  ['connector_connections', 'uid'],
  // Kendini geliştiren döngü: beğenilmeyen cevaplardan test seti ve öğrenilen yanıt tarzı.
  ['eval_cases', 'uid'],
  ['user_style', 'uid'],
];

// Silme talebinden sonra hesap bu süre boyunca kilitli bekler; kullanıcı giriş
// yapıp geri alabilir. Süre dolunca günlük cron verileri kalıcı olarak siler.
const DELETION_GRACE_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
// Kullanıcının Storage'daki dosyaları `{önek}/{uid}/...` altında durur.
const USER_STORAGE_PREFIXES = ['generated-images', 'generated-videos'];
// Kilitli hesabın erişebildiği tek uçlar: durum, geri alma ve hemen silme.
const PENDING_DELETION_ALLOWED = new Set(['GET /account/deletion', 'POST /account/restore', 'DELETE /account/now']);

function formatPurgeDate(iso) {
  return new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Istanbul' });
}

// requireAuth'tan sonra çalışır: silinmeyi bekleyen hesap yalnızca izinli uçlara erişir.
function blockPendingDeletion(req, res, next) {
  if (req.user?.deletionPending !== true) return next();
  if (PENDING_DELETION_ALLOWED.has(`${req.method} ${req.path}`)) return next();
  return res.status(423).json({ error: 'Hesabın silinmeyi bekliyor. Kullanmaya devam etmek için önce hesabını geri al.', code: 'ACCOUNT_PENDING_DELETION' });
}

function createAccountDeletion({ firestoreDb, qdrantClient, QDRANT_COLLECTION, firebaseAuth, storageBucket = null, mailer = null, ragEnabled = true }) {
  const deletionsRef = () => firestoreDb.collection('account_deletions');

  async function deleteQueryInBatches(query) {
    while (true) {
      const snapshot = await query.limit(300).get();
      if (snapshot.empty) return;
      const batch = firestoreDb.batch();
      snapshot.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      if (snapshot.size < 300) return;
    }
  }

  // Custom claim'ler toptan yazılır; admin gibi diğer claim'ler korunur.
  async function setDeletionClaim(uid, pending) {
    const user = await firebaseAuth.getUser(uid);
    const { deletionPending, ...claims } = user.customClaims || {};
    await firebaseAuth.setCustomUserClaims(uid, pending ? { ...claims, deletionPending: true } : claims);
  }

  async function hasDeletionClaim(uid) {
    const user = await firebaseAuth.getUser(uid);
    return user.customClaims?.deletionPending === true;
  }

  // Mail gönderilemezse işlem başarısız sayılmaz; yalnızca kaydedilir.
  async function sendMail(kind, email, data = { email }) {
    if (!mailer || !email) return;
    try {
      await mailer.send(kind, email, data);
    } catch (error) {
      console.error('Hesap silme maili gönderilemedi:', kind, error.message);
    }
  }

  // Kayıt yazılıp kilit konamadıysa (yarım kalan talep) tekrar denemede kilit yine konur.
  async function schedule(uid, email) {
    const existing = await deletionsRef().doc(uid).get();
    let record = existing.exists ? existing.data() : null;
    if (!record) {
      const now = Date.now();
      record = {
        uid,
        email: email || null,
        requestedAt: new Date(now).toISOString(),
        purgeAfter: new Date(now + DELETION_GRACE_DAYS * DAY_MS).toISOString(),
      };
      await deletionsRef().doc(uid).set(record);
    }
    if (await hasDeletionClaim(uid)) return record;
    await setDeletionClaim(uid, true);
    // Diğer cihazlardaki oturumlar da kapanır; tekrar giriş yapan kilit ekranını görür.
    await firebaseAuth.revokeRefreshTokens(uid);
    await sendMail('accountDeletionScheduled', email, { email, purgeDate: formatPurgeDate(record.purgeAfter) });
    return record;
  }

  // Önce silme kaydı kaldırılır: kayıt kaldırılamazsa hesap kilitli kalır ve geri alma tekrar denenir.
  // Ters sırada, kilidi kalkmış ama kaydı duran hesap 60 gün sonra cron tarafından silinirdi.
  async function restore(uid) {
    await deletionsRef().doc(uid).delete();
    await setDeletionClaim(uid, false);
  }

  // Silme adımları: her biri tekrar çalıştırılabilir. Biten adımlar silme kaydına yazılır;
  // yarıda kalan silme bir sonraki denemede yalnızca kalan adımları çalıştırır.
  function purgeSteps(uid) {
    const firestore = firestoreDb;
    const userRef = firestore.collection('users').doc(uid);
    return [
      ['chats', () => deleteQueryInBatches(userRef.collection('chats'))],
      ['settings', () => deleteQueryInBatches(userRef.collection('settings'))],
      // İnternetten kurulan skill'ler ve bekleyen kurulumlar.
      ['skills', () => deleteQueryInBatches(userRef.collection('skills'))],
      ['skillInstalls', () => deleteQueryInBatches(userRef.collection('skillInstalls'))],
      ['memories', () => memoryStore.deleteAllMemories(firestore, uid)],
      ['memory_pack', () => userRef.collection('memory_pack').doc('current').delete()],
      ['profile', () => memoryStore.deleteProfile(firestore, uid)],
      ...USER_OWNED_COLLECTIONS.map(([name, field]) => [name, () => deleteQueryInBatches(firestore.collection(name).where(field, '==', uid))]),
      ...(storageBucket ? USER_STORAGE_PREFIXES.map(prefix => [`storage:${prefix}`, () => storageBucket.deleteFiles({ prefix: `${prefix}/${uid}/` })]) : []),
    ];
  }

  // Yapılandırılmış Qdrant'a erişilemezse silme cron için kuyruğa alınır.
  async function deleteQdrant(uid) {
    if (!ragEnabled || !qdrantClient) return;
    try {
      await qdrantClient.delete(QDRANT_COLLECTION, { filter: { must: [{ key: 'userId', match: { value: uid } }] } });
    } catch (qdrantError) {
      console.error('Qdrant verisi silinemedi, bekleyen silme kuyruğa alınıyor.');
      await firestoreDb.collection('pending_deletions').doc(uid).set({
        uid,
        target: 'qdrant',
        reason: String(qdrantError.message || '').slice(0, 300),
        createdAt: new Date().toISOString(),
      });
    }
  }

  // Hatalar yutulmaz: herhangi bir adım başarısız olursa kimlik ve silme kaydı kalır,
  // kalan adımlar bir sonraki denemede tekrarlanır. Faturalar (`users/{uid}/invoices`)
  // yasal saklama yükümlülüğü nedeniyle silinmez.
  async function purge(uid, email) {
    const recordRef = deletionsRef().doc(uid);
    const recordSnap = await recordRef.get();
    const record = recordSnap.exists ? recordSnap.data() : null;
    const done = new Set(record?.progress?.done || []);
    const steps = purgeSteps(uid).filter(([name]) => !done.has(name));
    const results = await Promise.allSettled(steps.map(([, run]) => run()));
    const failed = {};
    results.forEach((result, i) => {
      const [name] = steps[i];
      if (result.status === 'fulfilled') done.add(name);
      else failed[name] = String(result.reason?.message || result.reason || '').slice(0, 300);
    });
    if (record) {
      await recordRef.set({ ...record, progress: { done: [...done], failed, updatedAt: new Date().toISOString() } });
    }
    const failedNames = Object.keys(failed);
    if (failedNames.length > 0) {
      const error = new Error(failed[failedNames[0]]);
      error.failedSteps = failedNames;
      throw error;
    }
    await deleteQdrant(uid);
    await firestoreDb.collection('users').doc(uid).delete();
    try {
      await firebaseAuth.deleteUser(uid);
    } catch (error) {
      if (error?.code !== 'auth/user-not-found') throw error;
    }
    await recordRef.delete();
    // Onay maili silme sonrası gider; gönderilemezse silme yine başarılıdır.
    await sendMail('accountDeleted', email);
  }

  async function retryPendingQdrant(limit) {
    if (ragEnabled && !qdrantClient) return;
    const snapshot = await firestoreDb.collection('pending_deletions').where('target', '==', 'qdrant').limit(limit).get();
    for (const doc of snapshot.docs) {
      try {
        if (ragEnabled) {
          const { uid } = doc.data();
          await qdrantClient.delete(QDRANT_COLLECTION, { filter: { must: [{ key: 'userId', match: { value: uid } }] } });
        }
        await doc.ref.delete();
      } catch {
        console.error('Bekleyen Qdrant silmesi tamamlanamadı.');
      }
    }
  }

  // Cron her çalıştığında süresi dolan hesapları sınırlı sayıda siler; kalanlar ertesi güne kalır.
  async function purgeExpired({ now = new Date(), limit = 25 } = {}) {
    const snapshot = await deletionsRef().where('purgeAfter', '<=', now.toISOString()).limit(limit).get();
    const result = { purged: 0, failed: 0 };
    for (const doc of snapshot.docs) {
      const { uid, email } = doc.data();
      try {
        await purge(uid, email);
        result.purged += 1;
      } catch (error) {
        result.failed += 1;
        console.error('Süresi dolan hesap silinemedi:', uid, error.message);
        // purge ilerlemeyi kayda yazdı; güncel kaydın üstüne hata bilgisi eklenir.
        const current = (await doc.ref.get()).data() || doc.data();
        await doc.ref.set({ ...current, lastError: String(error.message || '').slice(0, 300), lastAttemptAt: new Date().toISOString() });
      }
    }
    await retryPendingQdrant(limit);
    return result;
  }

  return { schedule, restore, purge, purgeExpired };
}

function registerAccountRoutes(app, deps) {
  const { firestoreDb } = deps;
  const deletion = createAccountDeletion(deps);

  app.get('/account/export', async (req, res) => {
    try {
      const uid = req.user.uid;
      const userRef = firestoreDb.collection('users').doc(uid);
      const [userDoc, chatsSnapshot, memories, memoryPackDoc, ...ownedSnapshots] = await Promise.all([
        userRef.get(),
        userRef.collection('chats').get(),
        memoryStore.listMemories(firestoreDb, uid),
        userRef.collection('memory_pack').doc('current').get(),
        ...USER_OWNED_COLLECTIONS.map(([name, field]) => firestoreDb.collection(name).where(field, '==', uid).get()),
      ]);
      const owned = Object.fromEntries(USER_OWNED_COLLECTIONS.map(([name], index) => [
        name,
        ownedSnapshots[index].docs.map(doc => ({ id: doc.id, ...doc.data() })),
      ]));
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        exportedAt: new Date().toISOString(),
        account: { uid, email: req.user.email || null },
        profile: userDoc.data() || {},
        chats: chatsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
        memories,
        memoryPack: memoryPackDoc.exists ? memoryPackDoc.data() : null,
        feedback: owned.feedback,
        bugReports: owned.bug_reports,
        usage: owned.usage_daily.map(({ id, ...data }) => data),
        videoJobs: owned.video_jobs,
        agentRuns: owned.agent_runs.map(({ pending, ...run }) => run),
        toolExecutions: owned.tool_executions,
        confirmations: owned.confirmation_requests,
        // Tokenlar dışa aktarılmaz; yalnızca hangi hesabın ne zaman bağlandığı.
        connections: owned.connector_connections.map(({ connectorId, status, createdAt }) => ({ connectorId, status, createdAt })),
      });
    } catch (error) {
      console.error('Hesap verileri dışa aktarılamadı:', error.message);
      res.status(500).json({ error: 'Hesap verileri hazırlanamadı.' });
    }
  });

  // Hesabı hemen silmez: 60 günlük bekleme başlatır ve hesabı kilitler.
  app.delete('/account', async (req, res) => {
    const uid = req.user.uid;
    try {
      const user = await firestoreDb.collection('users').doc(uid).get();
      if (user.data()?.billing?.plan === 'pro' && user.data()?.billing?.status === 'active') {
        return res.status(409).json({ error: 'Hesabı silmeden önce aktif Plus aboneliğini Faturalama bölümünden iptal etmelisin.' });
      }
      const record = await deletion.schedule(uid, req.user.email);
      res.json({ success: true, scheduled: true, requestedAt: record.requestedAt, purgeAfter: record.purgeAfter });
    } catch (error) {
      console.error('Hesap silme planlanamadı:', error.message);
      res.status(500).json({ error: 'Hesap silme talebi kaydedilemedi. Lütfen tekrar dene.' });
    }
  });

  app.get('/account/deletion', async (req, res) => {
    try {
      const doc = await firestoreDb.collection('account_deletions').doc(req.user.uid).get();
      res.setHeader('Cache-Control', 'no-store');
      if (!doc.exists) return res.json({ pending: false });
      const { requestedAt, purgeAfter } = doc.data();
      res.json({ pending: true, requestedAt, purgeAfter });
    } catch (error) {
      console.error('Silme durumu okunamadı:', error.message);
      res.status(500).json({ error: 'Hesap durumu okunamadı.' });
    }
  });

  app.post('/account/restore', async (req, res) => {
    try {
      await deletion.restore(req.user.uid);
      res.json({ success: true });
    } catch (error) {
      console.error('Hesap geri alınamadı:', error.message);
      res.status(500).json({ error: 'Hesap geri alınamadı. Lütfen tekrar dene.' });
    }
  });

  // Bekleme süresindeki kullanıcı 60 günü beklemeden kalıcı silmeyi seçebilir.
  app.delete('/account/now', async (req, res) => {
    if (req.user.deletionPending !== true) {
      return res.status(409).json({ error: 'Önce hesap silme talebi oluşturmalısın.' });
    }
    try {
      await deletion.purge(req.user.uid, req.user.email);
      res.json({ success: true });
    } catch (error) {
      console.error('Hesap silinemedi:', error.message);
      res.status(500).json({ error: 'Hesap ve veriler tamamen silinemedi. Lütfen tekrar dene.' });
    }
  });
}

// Vercel Cron günde bir kez çağırır; Vercel isteğe `Authorization: Bearer $CRON_SECRET` ekler.
function registerAccountCronRoutes(app, deps, { cronSecret = process.env.CRON_SECRET } = {}) {
  const deletion = createAccountDeletion(deps);
  app.get('/cron/purge-deleted-accounts', async (req, res) => {
    const expected = Buffer.from(`Bearer ${cronSecret || ''}`);
    const received = Buffer.from(req.headers.authorization || '');
    if (!cronSecret || expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
      return res.status(401).json({ error: 'Yetkisiz.' });
    }
    try {
      const result = await deletion.purgeExpired();
      res.json(result);
    } catch (error) {
      console.error('Hesap silme cron hatası:', error.message);
      res.status(500).json({ error: 'Silme işi çalışmadı.' });
    }
  });
}

module.exports = {
  registerAccountRoutes,
  registerAccountCronRoutes,
  blockPendingDeletion,
  createAccountDeletion,
  USER_OWNED_COLLECTIONS,
  DELETION_GRACE_DAYS,
};
