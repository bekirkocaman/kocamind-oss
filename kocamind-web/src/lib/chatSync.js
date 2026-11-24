// ═══ Sohbet eşitleme motoru ═══
// Tasarım: docs/superpowers/specs/2026-10-18-sohbet-esitleme-design.md
// Android karşılığı: CloudChatSync.kt. Firestore erişimi `api` ile verilir (testte sahtesi):
//   list(uid) → [[id, data]], delete(uid, id), transact(uid, id, update), listen(uid, onDocs) → kapat
// Taban ve bekleyen işlemler kullanıcı başına `storage`da (localStorage) tutulur.
import { fromCloudChat, normalizeChat, toCloudChat } from './chatSchema'
import { baseOf, mergeChat, planSync, sameInCloud } from './chatMerge'
import { stripEphemeralMessages } from './messagePrivacy'

const baseKey = (uid) => `kocamind_chat_sync_base_${uid}`
const pendingKey = (uid) => `kocamind_chat_sync_pending_${uid}`

const clean = (chat) => normalizeChat({ ...chat, messages: stripEphemeralMessages(chat.messages) })

// Ağ işlemleri sürerken kullanıcının yaptığı değişiklik korunur (kendi yazması onu birleştirir).
// now: şimdiki liste, before: plan yapılırken okunan liste, finals: planın sonucu.
export function reconcileChats(now, before, finals) {
  const beforeById = new Map(before.map(c => [String(c.id), c]))
  const nowById = new Map(now.map(c => [String(c.id), c]))
  const finalIds = new Set(finals.map(c => String(c.id)))
  const result = []
  for (const chat of finals) {
    const id = String(chat.id)
    const was = beforeById.get(id)
    const current = nowById.get(id)
    if (was && !current) continue // bu arada silindi
    result.push(current && current !== was ? current : chat)
  }
  for (const current of now) {
    const id = String(current.id)
    const was = beforeById.get(id)
    if (!finalIds.has(id) && (!was || current !== was)) result.push(current)
  }
  return result
}

export function createChatSync({ api, storage = globalThis.localStorage }) {
  // Yazma ve eşitlemeler sırayla: biri bitmeden öbürü tabanı okumasın.
  let chain = Promise.resolve()
  const serial = (fn) => {
    const run = chain.then(fn)
    chain = run.catch(() => {})
    return run
  }

  const read = (key, fallback) => {
    try { return JSON.parse(storage.getItem(key)) ?? fallback } catch { return fallback }
  }
  const write = (key, value) => {
    try { storage.setItem(key, JSON.stringify(value)) } catch { /* depolama dolu ya da kapalı */ }
  }
  const loadBases = (uid) => read(baseKey(uid), {})
  const editBases = (uid, change) => write(baseKey(uid), change({ ...loadBases(uid) }))
  const loadPending = (uid) => {
    const p = read(pendingKey(uid), {})
    return { upserts: p.upserts || [], deletes: p.deletes || [] }
  }
  const editPending = (uid, change) => {
    const next = change(loadPending(uid))
    write(pendingKey(uid), { upserts: [...new Set(next.upserts)], deletes: [...new Set(next.deletes)] })
  }

  async function pushLocked(uid, chat) {
    const id = String(chat.id)
    const local = clean(chat)
    try {
      const base = loadBases(uid)[id]
      let merged = local
      await api.transact(uid, id, (raw) => {
        const cloud = raw ? fromCloudChat(id, { ...raw, messages: stripEphemeralMessages(raw.messages) }) : null
        merged = cloud ? mergeChat(local, cloud, base) : local
        return cloud && sameInCloud(merged, cloud) ? null : toCloudChat(merged)
      })
      editBases(uid, (b) => ({ ...b, [id]: baseOf(merged) }))
      editPending(uid, (p) => ({ ...p, upserts: p.upserts.filter(x => x !== id) }))
      return merged
    } catch (error) {
      console.error('Sohbet buluta yazılamadı, sonra tekrar denenecek:', error)
      editPending(uid, (p) => ({ ...p, upserts: [...p.upserts, id] }))
      return null
    }
  }

  async function deleteLocked(uid, chatId) {
    const id = String(chatId)
    editPending(uid, (p) => ({ upserts: p.upserts.filter(x => x !== id), deletes: [...p.deletes, id] }))
    try {
      await api.delete(uid, id)
      editPending(uid, (p) => ({ ...p, deletes: p.deletes.filter(x => x !== id) }))
      editBases(uid, (b) => { delete b[id]; return b })
      return true
    } catch (error) {
      console.error('Sohbet buluttan silinemedi, sonra tekrar denenecek:', error)
      return false
    }
  }

  async function applyLocked(uid, localChats, docs) {
    const cloud = docs.map(([id, data]) => fromCloudChat(id, { ...data, messages: stripEphemeralMessages(data.messages) }))
    const plan = planSync(localChats.map(clean), cloud, loadBases(uid), new Set(loadPending(uid).deletes))
    for (const id of plan.deleteCloud) await deleteLocked(uid, id)
    const upload = new Set(plan.upload)
    const finals = []
    for (const chat of plan.chats) finals.push(upload.has(String(chat.id)) ? (await pushLocked(uid, chat)) || chat : chat)
    editBases(uid, (b) => {
      for (const id of plan.forget) delete b[id]
      return { ...b, ...plan.agreed }
    })
    editPending(uid, (p) => ({ ...p, upserts: p.upserts.filter(id => !(id in plan.agreed)) }))
    // Değişmeyen sohbet aynı nesne kalsın: ekran gereksiz yere yenilenmesin.
    const localById = new Map(localChats.map(c => [String(c.id), c]))
    return finals.map(final => {
      const original = localById.get(String(final.id))
      return original && JSON.stringify(original) === JSON.stringify(final) ? original : final
    })
  }

  return {
    // İşlemle birleştirip yazar; başarılıysa birleşik sohbeti, değilse null döndürür (bekleyenlere eklenir).
    push: (uid, chat) => serial(() => pushLocked(uid, chat)),
    deleteCloud: (uid, chatId) => serial(() => deleteLocked(uid, chatId)),
    // Bulutu okuyup yerelle üç yönlü birleştirir; yerel sohbetlerin yeni listesini döndürür.
    sync: (uid, localChats) => serial(async () => applyLocked(uid, localChats, await api.list(uid))),
    // Dinleyiciden gelen koleksiyonla aynı birleştirme.
    applyRemote: (uid, localChats, docs) => serial(() => applyLocked(uid, localChats, docs)),
    listen: (uid, onDocs) => api.listen(uid, onDocs),
    hasPending: (uid) => {
      const p = loadPending(uid)
      return p.upserts.length > 0 || p.deletes.length > 0
    },
    // Başarısız yazma ve silmeleri yeniden dener; yazılan sohbetlerin birleşik hâllerini döndürür.
    retryPending: (uid, getChat) => serial(async () => {
      const merged = []
      const { upserts, deletes } = loadPending(uid)
      for (const id of deletes) await deleteLocked(uid, id)
      for (const id of upserts) {
        const chat = getChat(id)
        if (!chat) { editPending(uid, (p) => ({ ...p, upserts: p.upserts.filter(x => x !== id) })); continue }
        const result = await pushLocked(uid, chat)
        if (result) merged.push(result)
      }
      return merged
    }),
    // Tüm sohbetler silindi: taban ve bekleyenler de unutulur.
    forgetAll: (uid) => serial(async () => {
      write(baseKey(uid), {})
      write(pendingKey(uid), { upserts: [], deletes: [] })
    }),
  }
}
