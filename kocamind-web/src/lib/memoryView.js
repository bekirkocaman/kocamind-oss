// Ayarlar > Hafıza (Android MemoryScreen / MemoryImport): kategori grupları, yorum ve başka
// uygulamadan taşıma. Metinler Android ile aynıdır.

// Backend'in hafıza sınırı (memoryAssist.MAX_MEMORIES_PER_USER).
export const MEMORY_LIMIT = 100

export const MEMORY_IMPORT_MAX = 20000

const CATEGORY_LABELS = [
  ['kisisel', 'Kişisel'],
  ['tercih', 'Tercihler'],
  ['is', 'İş'],
  ['saglik', 'Sağlık'],
  ['proje', 'Projeler'],
  ['genel', 'Diğer'],
]

const KNOWN = new Set(CATEGORY_LABELS.map(([id]) => id))

// Kullanıcının ChatGPT, Gemini, Claude gibi uygulamalara yapıştıracağı istem; cevabı KocaMind'e aktarılır.
export const MEMORY_IMPORT_PROMPT = `Bir yapay zeka asistanından diğerine bağlam aktarmama yardımcı oluyorsun. Görevin, geçmişteki sohbetlerimizi inceleyerek benimle ilgili bildiklerini özetlemek.
Çıktıda lütfen birinci şahıs zamirlerini (ben, bana, beni, bende, benden, benim, biz, bize, bizi, bizde, bizden, bizim) ve ikinci şahıs zamirlerini (sen, sana, seni, sende, senden, senin, siz, size, sizi, sizde, sizden, sizin) kullanma. Bunun yerine, hakkında bilgi edindiğin kişiden "kullanıcı" olarak bahset veya tarafsız ifadeler kullan.
Talimatlar ve tercihler başta olmak üzere kullanıcının sözlerini mümkün olduğunca harfiyen koru.
Kategoriler (bu sırayla sunulacak):

1. Demografik Bilgiler: Tercih edilen adlar, meslek, eğitim ve genel ikamet yeri
2. İlgi Alanları ve Tercihler: Devamlılığı olan aktif etkileşimler (yalnızca bir nesneye sahip olmak veya tek seferlik satın alım değil)
3. İlişkiler: Doğrulanmış ve devamlılığı olan ilişkiler
4. Tarihli Etkinlikler, Projeler ve Planlar: Önemli ve son etkinliklerin günlüğü
5. Talimatlar: Bundan sonra uymanı açıkça istediğim kurallar ("her zaman X yap", "asla Y yapma") ve davranışınla ilgili düzeltmeler. Yalnızca kayıtlı hafızalardaki kuralları dahil et, sohbetlerdekileri ekleme.

Biçim:
Yukarıdaki kategorileri kullanarak içeriği etiketli bölümlere ayır. İstemlerimden kelimesi kelimesine alıntılar ekleyerek her girişi kanıta dayandırmaya çalış. Her girişi şu biçimi kullanarak yapılandır:
Kullanıcının adı <name>.

* Kanıt: Kullanıcı, "Bana <name> de" dedi. Tarih: [YYYY-AA-GG].

Çıktı:

* YALNIZCA istenen bilgileri çıktı olarak sun. Sohbetlerde kullanılan dolgu sözcükleri, giriş metni veya kapanış ifadesi ekleme.

Son olarak, "Şuradan içe aktarıldı: <ad>" cümlesini tamamla (burada ad olarak ChatGPT, Claude, Grok vb. yazabilirsin). Bu, yanıtındaki en son metin olmalıdır.`

// Hafızayı kategori sırasına göre gruplar; bilinmeyen ya da boş kategori "Diğer"e düşer.
export function groupMemories(memories = []) {
  const byCategory = new Map()
  for (const memory of memories) {
    const category = KNOWN.has(memory.category) ? memory.category : 'genel'
    if (!byCategory.has(category)) byCategory.set(category, [])
    byCategory.get(category).push(memory)
  }
  return CATEGORY_LABELS.filter(([id]) => byCategory.has(id)).map(([id, label]) => ({ id, label, items: byCategory.get(id) }))
}

// /memory/extract sonucundan "Geri al" ile silinebilecek kayıtlar: yalnızca yeni eklenenler.
// Güncellenen kaydı silmek eski değeri de yok eder.
export function undoableMemoryKeys(saved = []) {
  return (saved || []).filter(m => m?.isNew !== false).map(m => m.key)
}

// İçe aktarma sonucunun kullanıcıya gösterilen cümlesi.
export function importSummary({ saved = 0, skippedForLimit = 0, from } = {}) {
  const prefix = from ? `${from}'den ` : ''
  let text = saved > 0 ? `${prefix}${saved} bilgi hafızana eklendi.` : 'Yeni bir bilgi bulunamadı.'
  if (skippedForLimit > 0) text += ` ${skippedForLimit} bilgi ${MEMORY_LIMIT} kayıt sınırı nedeniyle eklenmedi.`
  return text
}

// Yorumun neye dayandığı: "12 sohbete ve 4 bilgiye dayanır".
export function insightBasis(chats = 0, memories = 0) {
  const parts = [chats > 0 && `${chats} sohbete`, memories > 0 && `${memories} bilgiye`].filter(Boolean)
  const basis = parts.length ? `${parts.join(' ve ')} dayanır` : 'Sohbetlerine dayanır'
  return `${basis} · başka uygulamalardan taşınanlar dahil değil`
}
