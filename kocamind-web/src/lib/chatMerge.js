// ═══ Üç yönlü sohbet birleştirme ═══
// Tasarım: docs/superpowers/specs/2026-10-18-sohbet-esitleme-design.md
// Android karşılığı: kocamind-android/.../data/sync/ChatMerge.kt (aynı test vakaları).
// Taban: bir sohbetin bulutla en son anlaşılan hâli → { updatedAt, ids }.
import { toCloudChat, toMillis } from './chatSchema'

const idsOf = (messages = []) => messages.map(m => String(m.id))

export const baseOf = (chat) => ({ updatedAt: toMillis(chat.updatedAt), ids: idsOf(chat.messages) })

// Sohbet tabandan bu yana hiç değişmemiş mi (zaman ve mesajlar birebir aynı).
export function unchangedSince(chat, base) {
  const ids = idsOf(chat.messages)
  return toMillis(chat.updatedAt) === base.updatedAt
    && ids.length === base.ids.length
    && ids.every((id, i) => id === base.ids[i])
}

const timeOf = (m) => toMillis(m.timestamp) || toMillis(m.id)

// `newer` sırası korunur. Tabanda olup bir tarafta olmayan mesaj o tarafta silinmiştir.
// `older`daki yeni mesajlar zamanına göre araya yerleşir. Taban yoksa `newer` kazanır.
export function mergeMessages(newer = [], older = [], base = null) {
  if (!base) return newer
  const newerIds = new Set(idsOf(newer))
  const olderIds = new Set(idsOf(older))
  const removed = new Set([...base].map(String).filter(id => !newerIds.has(id) || !olderIds.has(id)))
  const result = newer.filter(m => !removed.has(String(m.id)))
  const present = new Set(idsOf(result))
  for (const m of older) {
    const id = String(m.id)
    if (removed.has(id) || present.has(id)) continue
    let at = 0
    for (let i = result.length - 1; i >= 0; i--) {
      if (timeOf(result[i]) <= timeOf(m)) { at = i + 1; break }
    }
    result.splice(at, 0, m)
    present.add(id)
  }
  return result
}

// Aynı sohbetin iki hâli: başlık/sabitleme/arşiv yeni olandan, mesajlar üç yönlü birleşir.
export function mergeChat(local, cloud, base) {
  const localAt = toMillis(local.updatedAt)
  const cloudAt = toMillis(cloud.updatedAt)
  const [newer, older] = localAt >= cloudAt ? [local, cloud] : [cloud, local]
  return {
    ...newer,
    messages: mergeMessages(newer.messages, older.messages, base?.ids),
    updatedAt: Math.max(localAt, cloudAt),
    createdAt: local.createdAt || cloud.createdAt,
  }
}

// Alan sırasından bağımsız karşılaştırma: Firestore'dan dönen belgede alan sırası garanti değil.
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

// Bulutta yazılacak içerik aynı mı (yazmaya gerek var mı).
export function sameInCloud(a, b) {
  return stableStringify(toCloudChat(a)) === stableStringify(toCloudChat(b))
}

// Tam eşitleme planı. chats: yerelin yeni listesi; upload: işlemle yazılacaklar;
// deleteCloud: buluttan silinecekler; agreed: bulutla aynı olanların yeni tabanı; forget: tabandan çıkacaklar.
export function planSync(local, cloud, bases = {}, pendingDeletes = new Set()) {
  const localById = new Map(local.map(c => [String(c.id), c]))
  const cloudById = new Map(cloud.map(c => [String(c.id), c]))
  const plan = { chats: [], upload: [], deleteCloud: [], agreed: {}, forget: [] }
  for (const id of new Set([...localById.keys(), ...cloudById.keys()])) {
    const l = localById.get(id)
    const c = cloudById.get(id)
    const base = bases[id]
    if (pendingDeletes.has(id)) {
      if (c) plan.deleteCloud.push(id); else plan.forget.push(id)
      continue
    }
    if (l && c) {
      const merged = mergeChat(l, c, base)
      plan.chats.push(merged)
      if (sameInCloud(merged, c)) plan.agreed[id] = baseOf(merged); else plan.upload.push(id)
    } else if (l) {
      // Başka cihazda silinmiş ve burada sonradan değişmemiş.
      if (base && unchangedSince(l, base)) plan.forget.push(id)
      else { plan.chats.push(l); plan.upload.push(id) }
    } else if (c) {
      // Bu cihazda silinmiş (silme buluta ulaşamamış) ve bulutta sonradan değişmemiş.
      if (base && unchangedSince(c, base)) plan.deleteCloud.push(id)
      else { plan.chats.push(c); plan.agreed[id] = baseOf(c) }
    }
  }
  plan.chats.sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt))
  return plan
}
