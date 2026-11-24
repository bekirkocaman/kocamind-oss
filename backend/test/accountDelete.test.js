const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const {
  registerAccountRoutes,
  registerAccountCronRoutes,
  blockPendingDeletion,
  createAccountDeletion,
  USER_OWNED_COLLECTIONS,
  DELETION_GRACE_DAYS,
} = require('../routes/account');
const { fakeFirestore } = require('./fakeFirestore');

function fakeAuth(claims = { u1: { admin: true } }) {
  const calls = { deleted: [], revoked: [] };
  return {
    calls,
    claims,
    getUser: async uid => ({ uid, customClaims: claims[uid] }),
    setCustomUserClaims: async (uid, value) => { claims[uid] = value; },
    revokeRefreshTokens: async uid => calls.revoked.push(uid),
    deleteUser: async uid => calls.deleted.push(uid),
  };
}

function fakeBucket() {
  const prefixes = [];
  return { prefixes, deleteFiles: async ({ prefix }) => prefixes.push(prefix) };
}

function setup({ user = { uid: 'u1', email: 'ali@ornek.com' }, ragEnabled = true, qdrantClient = null } = {}) {
  const db = fakeFirestore();
  db.docs.set('users/u1', { name: 'Ali' });
  db.docs.set('users/u1/chats/c1', { title: 'Merhaba' });
  db.docs.set('welcome_emails/u1', { uid: 'u1' });
  const mails = [];
  const auth = fakeAuth();
  const bucket = fakeBucket();
  const deps = {
    firestoreDb: db,
    qdrantClient,
    ragEnabled,
    QDRANT_COLLECTION: 'docs',
    firebaseAuth: auth,
    storageBucket: bucket,
    mailer: { send: async (kind, to, data) => { mails.push({ kind, to, data }); return true; } },
  };
  const app = express();
  registerAccountCronRoutes(app, deps, { cronSecret: 'gizli' });
  app.use((req, res, next) => { req.user = { ...user }; next(); });
  app.use(blockPendingDeletion);
  registerAccountRoutes(app, deps);
  app.get('/chat-ornek', (req, res) => res.json({ ok: true }));
  return { app, db, auth, bucket, mails, deps };
}

test('hesap silme hemen silmez: 60 gün sonrası planlanır, hesap kilitlenir, veriler durur', async () => {
  const { app, db, auth, mails } = setup();
  const before = Date.now();
  const res = await request(app).delete('/account');
  assert.equal(res.status, 200);
  assert.equal(res.body.scheduled, true);
  const days = (Date.parse(res.body.purgeAfter) - before) / (24 * 60 * 60 * 1000);
  assert.ok(Math.abs(days - DELETION_GRACE_DAYS) < 0.01);
  assert.equal(db.docs.has('users/u1/chats/c1'), true);
  assert.equal(db.docs.has('users/u1'), true);
  assert.deepEqual(auth.calls.deleted, []);
  assert.deepEqual(auth.claims.u1, { admin: true, deletionPending: true });
  assert.deepEqual(auth.calls.revoked, ['u1']);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].kind, 'accountDeletionScheduled');
  assert.equal(mails[0].to, 'ali@ornek.com');
});

test('aktif Plus aboneliği varken silme planlanmaz', async () => {
  const { app, db } = setup();
  db.docs.set('users/u1', { billing: { plan: 'pro', status: 'active' } });
  const res = await request(app).delete('/account');
  assert.equal(res.status, 409);
  assert.equal(db.docs.has('account_deletions/u1'), false);
});

test('bekleyen hesap yalnızca durum, geri alma ve hemen silme uçlarına erişir', async () => {
  const { app } = setup({ user: { uid: 'u1', email: 'ali@ornek.com', deletionPending: true } });
  const blocked = await request(app).get('/chat-ornek');
  assert.equal(blocked.status, 423);
  assert.equal(blocked.body.code, 'ACCOUNT_PENDING_DELETION');
  assert.equal((await request(app).get('/account/deletion')).status, 200);
});

test('geri alınca kilit kalkar, silme kaydı silinir, diğer claimler korunur', async () => {
  const { app, db, auth } = setup();
  await request(app).delete('/account');
  const status = await request(app).get('/account/deletion');
  assert.equal(status.body.pending, true);
  const res = await request(app).post('/account/restore');
  assert.equal(res.status, 200);
  assert.deepEqual(auth.claims.u1, { admin: true });
  assert.equal(db.docs.has('account_deletions/u1'), false);
  assert.equal(db.docs.has('users/u1/chats/c1'), true);
});

test('cron yalnızca süresi dolanları siler: veriler, Storage dosyaları ve kimlik gider', async () => {
  const { db, auth, bucket, mails, deps } = setup();
  db.docs.set('account_deletions/u1', { uid: 'u1', email: 'ali@ornek.com', purgeAfter: '2026-01-01T00:00:00.000Z' });
  db.docs.set('account_deletions/u2', { uid: 'u2', email: 'veli@ornek.com', purgeAfter: '2099-01-01T00:00:00.000Z' });
  const result = await createAccountDeletion(deps).purgeExpired({ now: new Date('2026-10-12T00:00:00.000Z') });
  assert.deepEqual(result, { purged: 1, failed: 0 });
  assert.deepEqual(auth.calls.deleted, ['u1']);
  assert.deepEqual(bucket.prefixes.sort(), ['generated-images/u1/', 'generated-videos/u1/']);
  assert.equal(db.docs.has('users/u1'), false);
  assert.equal(db.docs.has('users/u1/chats/c1'), false);
  assert.equal(db.docs.has('welcome_emails/u1'), false);
  assert.ok(USER_OWNED_COLLECTIONS.some(([name]) => name === 'welcome_emails'));
  assert.equal(db.docs.has('account_deletions/u1'), false);
  assert.equal(db.docs.has('account_deletions/u2'), true);
  assert.deepEqual(mails, [{ kind: 'accountDeleted', to: 'ali@ornek.com', data: { email: 'ali@ornek.com' } }]);
});

test('silme yarıda kalırsa kimlik silinmez, kayıt hata bilgisiyle kalır', async () => {
  const { db, auth, deps } = setup();
  deps.storageBucket.deleteFiles = async () => { throw new Error('storage kapalı'); };
  db.docs.set('account_deletions/u1', { uid: 'u1', email: 'ali@ornek.com', purgeAfter: '2026-01-01T00:00:00.000Z' });
  const result = await createAccountDeletion(deps).purgeExpired({ now: new Date('2026-10-12T00:00:00.000Z') });
  assert.deepEqual(result, { purged: 0, failed: 1 });
  assert.deepEqual(auth.calls.deleted, []);
  assert.equal(db.docs.get('account_deletions/u1').lastError, 'storage kapalı');
});

test('cron uç noktası CRON_SECRET olmadan çalışmaz', async () => {
  const { app } = setup();
  assert.equal((await request(app).get('/cron/purge-deleted-accounts')).status, 401);
  assert.equal((await request(app).get('/cron/purge-deleted-accounts').set('Authorization', 'Bearer yanlis')).status, 401);
  const ok = await request(app).get('/cron/purge-deleted-accounts').set('Authorization', 'Bearer gizli');
  assert.equal(ok.status, 200);
});

test('hemen silme yalnızca bekleyen hesapta çalışır', async () => {
  const normal = setup();
  assert.equal((await request(normal.app).delete('/account/now')).status, 409);
  const pending = setup({ user: { uid: 'u1', email: 'ali@ornek.com', deletionPending: true } });
  const res = await request(pending.app).delete('/account/now');
  assert.equal(res.status, 200);
  assert.deepEqual(pending.auth.calls.deleted, ['u1']);
});

test('kalıcı silme bağlı hesap tokenlarını da siler; dışa aktarma token içermez', async () => {
  const { app, db, deps } = setup();
  db.docs.set('connector_connections/u1__notion', { uid: 'u1', connectorId: 'notion', status: 'active', createdAt: '2026-10-12T00:00:00.000Z', tokens: 'v1.sifreli.token' });
  db.docs.set('connector_connections/u2__notion', { uid: 'u2', connectorId: 'notion', tokens: 'v1.baska.kullanici' });
  const exported = await request(app).get('/account/export');
  assert.equal(exported.status, 200);
  assert.deepEqual(exported.body.connections, [{ connectorId: 'notion', status: 'active', createdAt: '2026-10-12T00:00:00.000Z' }]);
  assert.doesNotMatch(JSON.stringify(exported.body), /sifreli/);
  db.docs.set('account_deletions/u1', { uid: 'u1', email: 'ali@ornek.com', purgeAfter: '2026-01-01T00:00:00.000Z' });
  await createAccountDeletion(deps).purgeExpired({ now: new Date('2026-10-12T00:00:00.000Z') });
  assert.equal(db.docs.has('connector_connections/u1__notion'), false);
  assert.equal(db.docs.has('connector_connections/u2__notion'), true);
});

test('kilit konamazsa tekrar denemede hesap yine kilitlenir', async () => {
  const { app, auth } = setup();
  const original = auth.setCustomUserClaims;
  auth.setCustomUserClaims = async () => { throw new Error('auth kapalı'); };
  assert.equal((await request(app).delete('/account')).status, 500);
  auth.setCustomUserClaims = original;
  assert.equal((await request(app).delete('/account')).status, 200);
  assert.deepEqual(auth.claims.u1, { admin: true, deletionPending: true });
  assert.deepEqual(auth.calls.revoked, ['u1']);
});

test('planlama maili gitmezse talep yine başarılıdır', async () => {
  const { app, db, deps } = setup();
  deps.mailer.send = async () => { throw new Error('smtp kapalı'); };
  assert.equal((await request(app).delete('/account')).status, 200);
  assert.equal(db.docs.has('account_deletions/u1'), true);
});

test('geri almada silme kaydı önce silinir: kayıt silinemezse hesap kilitli kalır', async () => {
  const { app, db, auth } = setup();
  await request(app).delete('/account');
  const realDelete = db.collection('account_deletions').doc('u1').delete;
  const realCollection = db.collection;
  db.collection = name => {
    const col = realCollection(name);
    if (name !== 'account_deletions') return col;
    return { ...col, doc: id => ({ ...col.doc(id), delete: async () => { throw new Error('firestore kapalı'); } }) };
  };
  assert.equal((await request(app).post('/account/restore')).status, 500);
  assert.equal(db.docs.has('account_deletions/u1'), true);
  assert.equal(auth.claims.u1.deletionPending, true);
  db.collection = realCollection;
  void realDelete;
  assert.equal((await request(app).post('/account/restore')).status, 200);
  assert.deepEqual(auth.claims.u1, { admin: true });
});

test('yarıda kalan silme adımları kaydedilir; tekrar denemede biten adım yeniden çalışmaz', async () => {
  const { db, auth, deps } = setup();
  let storageCalls = 0;
  let storageFails = true;
  deps.storageBucket.deleteFiles = async () => { storageCalls += 1; if (storageFails) throw new Error('storage kapalı'); };
  db.docs.set('account_deletions/u1', { uid: 'u1', email: 'ali@ornek.com', purgeAfter: '2026-01-01T00:00:00.000Z' });
  const deletion = createAccountDeletion(deps);
  await deletion.purgeExpired({ now: new Date('2026-10-12T00:00:00.000Z') });
  const record = db.docs.get('account_deletions/u1');
  assert.ok(record.progress.done.includes('chats'))
  assert.ok(record.progress.failed['storage:generated-images']);
  assert.equal(db.docs.has('users/u1/chats/c1'), false);
  assert.deepEqual(auth.calls.deleted, []);
  storageFails = false;
  db.docs.set('users/u1/chats/c2', { title: 'yeni' });
  const callsBefore = storageCalls;
  const result = await deletion.purgeExpired({ now: new Date('2026-10-12T00:00:00.000Z') });
  assert.deepEqual(result, { purged: 1, failed: 0 });
  assert.equal(storageCalls - callsBefore, 2);
  assert.deepEqual(auth.calls.deleted, ['u1']);
  assert.equal(db.docs.has('account_deletions/u1'), false);
});

test('silme sonrası mail gitmezse silme başarılı sayılır', async () => {
  const pending = setup({ user: { uid: 'u1', email: 'ali@ornek.com', deletionPending: true } });
  pending.deps.mailer.send = async () => { throw new Error('smtp kapalı'); };
  const res = await request(pending.app).delete('/account/now');
  assert.equal(res.status, 200);
  assert.deepEqual(pending.auth.calls.deleted, ['u1']);
});

test('bekleyen Qdrant silmeleri cron her çalıştığında yeniden denenir', async () => {
  const { db, deps } = setup();
  const deleted = [];
  deps.qdrantClient = { delete: async (col, { filter }) => { deleted.push(filter.must[0].match.value); } };
  db.docs.set('pending_deletions/u9', { uid: 'u9', target: 'qdrant', createdAt: '2026-10-01T00:00:00.000Z' });
  await createAccountDeletion(deps).purgeExpired({ now: new Date('2026-10-12T00:00:00.000Z') });
  assert.deepEqual(deleted, ['u9']);
  assert.equal(db.docs.has('pending_deletions/u9'), false);
});

test('Qdrant yapılandırılmadığında hesap ve eski Qdrant kayıtları Qdrant çağrısı olmadan silinir', async () => {
  let qdrantCalls = 0;
  const { app, db, auth } = setup({
    user: { uid: 'u1', deletionPending: true },
    ragEnabled: false,
    qdrantClient: { delete: async () => { qdrantCalls++; } },
  });
  db.docs.set('pending_deletions/u9', { uid: 'u9', target: 'qdrant' });
  db.docs.set('pending_deletions/u8', { uid: 'u8', target: 'storage' });
  assert.equal((await request(app).delete('/account/now')).status, 200);
  assert.deepEqual(auth.calls.deleted, ['u1']);
  assert.equal(db.docs.has('pending_deletions/u1'), false);

  const cron = await request(app).get('/cron/purge-deleted-accounts').set('Authorization', 'Bearer gizli');
  assert.equal(cron.status, 200);
  assert.equal(db.docs.has('pending_deletions/u9'), false);
  assert.equal(db.docs.has('pending_deletions/u8'), true);
  assert.equal(qdrantCalls, 0);
});

test('Qdrant yapılandırıldığında başarısız silme kuyrukta kalır ve cron tekrar dener', async () => {
  let unavailable = true;
  const calls = [];
  const qdrantClient = { delete: async (collection, { filter }) => {
    calls.push({ collection, filter });
    if (unavailable) throw new Error('Qdrant kapalı');
  } };
  const { app, db, auth, deps } = setup({ user: { uid: 'u1', deletionPending: true }, qdrantClient });
  assert.equal((await request(app).delete('/account/now')).status, 200);
  assert.deepEqual(auth.calls.deleted, ['u1']);
  const deletion = createAccountDeletion(deps);
  await deletion.purgeExpired();
  assert.equal(db.docs.get('pending_deletions/u1').target, 'qdrant');
  unavailable = false;
  await deletion.purgeExpired();
  assert.equal(db.docs.has('pending_deletions/u1'), false);
  assert.deepEqual(calls, Array(3).fill({ collection: 'docs', filter: { must: [{ key: 'userId', match: { value: 'u1' } }] } }));
});

test('hesap silme memory_pack belgesini siler ve dışa aktarma memoryPack içerir', async () => {
  const { app, db, deps } = setup();
  const packData = { version: 2, builtAt: '2026-11-10T12:00:00.000Z', core: [{ key: 'isim', value: 'Ali' }], optional: [], lastLearn: null };
  db.docs.set('users/u1/memory_pack/current', packData);
  db.docs.set('users/u2/memory_pack/current', packData);

  const exported = await request(app).get('/account/export');
  assert.equal(exported.status, 200);
  assert.deepEqual(exported.body.memoryPack, packData);

  db.docs.set('account_deletions/u1', { uid: 'u1', email: 'ali@ornek.com', purgeAfter: '2026-01-01T00:00:00.000Z' });
  await createAccountDeletion(deps).purgeExpired({ now: new Date('2026-10-12T00:00:00.000Z') });
  assert.equal(db.docs.has('users/u1/memory_pack/current'), false);
  assert.equal(db.docs.has('users/u2/memory_pack/current'), true);
});

test('kalıcı silme usage_keys belgelerini siler', async () => {
  const { db, deps } = setup();
  assert.ok(USER_OWNED_COLLECTIONS.some(([name, field]) => name === 'usage_keys' && field === 'uid'));
  db.docs.set('usage_keys/u1_chat_key12345', { uid: 'u1', kind: 'chat', day: '2026-11-19' });
  db.docs.set('usage_keys/u2_chat_key12345', { uid: 'u2', kind: 'chat', day: '2026-11-19' });

  db.docs.set('account_deletions/u1', { uid: 'u1', email: 'ali@ornek.com', purgeAfter: '2026-01-01T00:00:00.000Z' });
  await createAccountDeletion(deps).purgeExpired({ now: new Date('2026-10-12T00:00:00.000Z') });

  assert.equal(db.docs.has('usage_keys/u1_chat_key12345'), false);
  assert.equal(db.docs.has('usage_keys/u2_chat_key12345'), true);
});

test('kalıcı silme yalnızca silinen hesabın settings belgelerini temizler', async () => {
  const { db, deps } = setup();
  db.docs.set('users/u1/settings/assistants', { sample: true });
  db.docs.set('users/u1/settings/another_setting', { sample: true });
  db.docs.set('users/u2/settings/assistants', { sample: true });

  await createAccountDeletion(deps).purge('u1', null);

  assert.equal(db.docs.has('users/u1/settings/assistants'), false);
  assert.equal(db.docs.has('users/u1/settings/another_setting'), false);
  assert.deepEqual(db.docs.get('users/u2/settings/assistants'), { sample: true });
});

test('bug_reports USER_OWNED_COLLECTIONS içindedir: dışa aktarma içerir ve kalıcı silme temizler', async () => {
  const { app, db, deps } = setup();
  assert.ok(USER_OWNED_COLLECTIONS.some(([name, field]) => name === 'bug_reports' && field === 'uid'));
  db.docs.set('bug_reports/b1', { uid: 'u1', text: 'Buton çalışmıyor', status: 'open' });
  db.docs.set('bug_reports/b2', { uid: 'u2', text: 'Başka kullanıcı hatası', status: 'open' });

  const exported = await request(app).get('/account/export');
  assert.equal(exported.status, 200);
  assert.deepEqual(exported.body.bugReports, [{ id: 'b1', uid: 'u1', text: 'Buton çalışmıyor', status: 'open' }]);

  await createAccountDeletion(deps).purge('u1', null);
  assert.equal(db.docs.has('bug_reports/b1'), false);
  assert.equal(db.docs.has('bug_reports/b2'), true);
});
