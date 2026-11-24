// ═══ Web ve Android'in ortak sohbet şeması ═══
// Android karşılığı: kocamind-android/.../data/sync/CloudChatMapping.kt
//
// users/{uid}/chats/{chatId}: { title, messages, pinned, archived, createdAt, updatedAt }
// Mesaj: { id, role: 'user' | 'ai', content, timestamp } + web'e özgü isteğe bağlı alanlar
// (imageUrl, agentSteps). Bütün zamanlar milisaniye cinsinden sayıdır.

// Sayı, ISO metni ya da Firestore Timestamp'i milisaniyeye çevirir; çözülemezse 0.
export function toMillis(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : 0
  if (typeof value === 'string') {
    // Rakamlardan oluşan metin doğrudan sayıdır; Date.parse("12") gibi tahminlere bırakılmaz.
    if (/^\d+$/.test(value)) return Number(value)
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  if (value && typeof value.toMillis === 'function') return value.toMillis()
  return 0
}

// Sohbet kimliğindeki oluşturma zamanı: web `1739…`, Android `chat_1739…`.
function idMillis(id) {
  const match = /^(?:chat_)?(\d+)$/.exec(String(id ?? ''))
  return match ? Number(match[1]) : 0
}

export function normalizeRole(role) {
  return role === 'user' ? 'user' : 'ai'
}

// Her mesaja kalıcı bir kimlik ve zaman verir. Kimliği/zamanı olmayan mesaj, aynı sıradaki
// önceki kayıtla (aynı rol ve içerik) eşleşirse onun değerlerini alır; böylece her kayıtta
// yeni değer üretilmez. Eşleşme yoksa ilk kaydedildiği an kullanılır.
export function normalizeMessages(messages, previous = [], now = Date.now()) {
  if (!Array.isArray(messages)) return []
  return messages.map((message, index) => {
    const role = normalizeRole(message.role)
    const prior = previous[index]
    const sameAsPrior = prior && normalizeRole(prior.role) === role && prior.content === message.content
    const timestamp = toMillis(message.timestamp) || (sameAsPrior && toMillis(prior.timestamp)) || now
    const id = message.id != null && message.id !== ''
      ? String(message.id)
      : (sameAsPrior && prior.id != null ? String(prior.id) : `${timestamp}-${index}`)
    return { ...message, id, role, timestamp }
  })
}

// Yerelde kimliksiz mesaj kalmasın (eski kayıtlar): buluttan okuma ile aynı kural, her seferinde aynı sonuç.
export function normalizeChat(chat) {
  const createdAt = toMillis(chat.createdAt) || idMillis(chat.id)
  return { ...chat, createdAt: createdAt || chat.createdAt, messages: normalizeMessages(chat.messages, [], createdAt) }
}

// Buluta yazılacak belge. Mesajlar zaten normalleştirilmişse aynen kalır.
export function toCloudChat(chat, now = Date.now()) {
  const createdAt = toMillis(chat.createdAt) || idMillis(chat.id) || now
  return {
    title: chat.title || 'Yeni sohbet',
    messages: normalizeMessages(chat.messages, [], createdAt),
    pinned: Boolean(chat.pinned),
    archived: Boolean(chat.archived),
    createdAt,
    updatedAt: toMillis(chat.updatedAt) || createdAt,
  }
}

// Buluttan okunan belge: eski kayıtlardaki ISO metni ya da Timestamp zamanları sayıya çevrilir.
export function fromCloudChat(id, data = {}) {
  const createdAt = toMillis(data.createdAt) || idMillis(id)
  return {
    ...data,
    id,
    createdAt,
    updatedAt: toMillis(data.updatedAt) || createdAt,
    messages: normalizeMessages(data.messages, [], createdAt),
  }
}
