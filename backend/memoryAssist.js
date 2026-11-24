// Ucuz bir yardımcı modelle iki arka plan işi yapar:
// 1) Kullanıcı mesajından kalıcı kişisel bilgi çıkarmak (otomatik hafıza).
// 2) Uzun sohbetlerin eski kısmını özetlemek (bağlam sıkıştırma).
// Ana sohbet modelinden ve OpenAI kredisinden bağımsız çalışır; bir sağlayıcı düşerse sıradakine geçer.
const { disabledProviders, isDisabledEndpoint } = require('./learning/providerAvailability');

// Adresler server.js PROVIDERS ile aynıdır; yalnızca Chat Completions biçimini konuşan açık sağlayıcılar.
const ASSIST_PROVIDERS = {
  deepseek: { envKey: 'DEEPSEEK_API_KEY', url: 'https://api.deepseek.com/v1/chat/completions' },
  evren: { envKey: 'EVREN_LLM_API_KEY', url: 'https://evren-llmapi.ssyz.org.tr/v1/chat/completions' },
};
const DEFAULT_ASSIST_CHAIN = 'deepseek:deepseek-chat,evren:qwen3.8-flash-next';
// Anahtarı geçersiz ya da bakiyesi bitmiş sağlayıcıya her mesajda boşuna gitmemek için bir süre atlanır.
const AUTH_BLOCK_STATUSES = new Set([401, 402, 403]);
const AUTH_BLOCK_MS = 10 * 60 * 1000;
const blockedUntil = new Map();
let loggedDisabledSkip = false;

// Sıra: MEMORY_ASSIST_CHAIN ("sağlayıcı:model,..."), yoksa DeepSeek sonra EVREN. Eski MEMORY_ASSIST_URL/MODEL/KEY_ENV
// ayarı varsa en başa özel aday olarak girer; MEMORY_ASSIST_MODEL DeepSeek modelini değiştirir.
function assistCandidates(env = process.env) {
  const list = [];
  if (env.MEMORY_ASSIST_URL) {
    list.push({ id: 'custom', url: env.MEMORY_ASSIST_URL, model: env.MEMORY_ASSIST_MODEL || 'deepseek-chat', envKey: env.MEMORY_ASSIST_KEY_ENV || 'DEEPSEEK_API_KEY' });
  }
  for (const item of String(env.MEMORY_ASSIST_CHAIN || DEFAULT_ASSIST_CHAIN).split(',')) {
    const [id, ...rest] = item.trim().split(':');
    const provider = ASSIST_PROVIDERS[id];
    const model = rest.join(':');
    if (!provider || !model) continue;
    list.push({ id, url: provider.url, model: id === 'deepseek' && env.MEMORY_ASSIST_MODEL ? env.MEMORY_ASSIST_MODEL : model, envKey: provider.envKey });
  }
  return list;
}

function availableCandidates(env = process.env) {
  const disabled = disabledProviders(env);
  const configured = assistCandidates(env).filter(candidate => env[candidate.envKey]);
  const available = configured.filter(candidate => !disabled.has(candidate.id)
    && (candidate.id !== 'custom' || !isDisabledEndpoint(disabled, candidate)));
  if (configured.length && !available.length && !loggedDisabledSkip) {
    console.info('Yardımcı model işi atlandı: yapılandırılmış sağlayıcılar kapalı.');
    loggedDisabledSkip = true;
  }
  return available;
}

// Metriklerde etiket: ilk aday.
function primaryAssist(env = process.env) {
  const first = availableCandidates(env)[0];
  return { provider: first?.id, model: first?.model };
}

function resetAssistProviderState() {
  blockedUntil.clear();
  loggedDisabledSkip = false;
}

const MAX_MEMORIES_PER_USER = 100;
const MAX_EXTRACTED_PER_MESSAGE = 3;
const MAX_SUMMARY_CHARS = 6000;
// İstemcinin son-mesaj bütçesi (120 bin karakter) ve bir miktar pay.
const MAX_HISTORY_CHARS = 150000;

const PERSONAL_WORDS = new Set([
  'ben', 'benim', 'bana', 'beni', 'bende', 'benden', 'bizim', 'bize',
  'hatırla', 'hatirla', 'unutma', 'unut', 'kaydet', 'aklında', 'aklinda',
  'adım', 'adim', 'ismim', 'yaşım', 'yasim', 'mesleğim', 'meslegim', 'hobim',
  'yaşıyorum', 'yasiyorum', 'oturuyorum', 'çalışıyorum', 'calisiyorum', 'okuyorum',
  'seviyorum', 'sevmiyorum', 'sevmem', 'severim', 'tercih', 'alerjim', 'favori',
]);
const FIRST_PERSON_SUFFIX = /(ım|im|um|üm)$/u;

// Model çağrısı yapmadan önce mesajın kişisel bilgi içerip içeremeyeceğini kaba biçimde eler.
function mightContainPersonalInfo(text) {
  const clean = String(text || '').trim();
  if (clean.length < 8 || clean.length > 4000) return false;
  const words = clean.toLocaleLowerCase('tr').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words.some(word => PERSONAL_WORDS.has(word) || (word.length >= 5 && FIRST_PERSON_SUFFIX.test(word)));
}

function parseJsonObject(text) {
  const raw = String(text || '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

function isAssistAvailable() {
  return availableCandidates().length > 0;
}

async function callAssistModel(fetch, { system, user, maxTokens, json }) {
  const candidates = availableCandidates();
  if (candidates.length === 0) throw Object.assign(new Error('Yardımcı model yapılandırılmamış.'), { unavailable: true });
  // Hepsi engelliyse yine de sırayla denenir; süre dolmuş ya da anahtar düzelmiş olabilir.
  const open = candidates.filter(candidate => (blockedUntil.get(candidate.id) || 0) <= Date.now());
  for (const candidate of open.length > 0 ? open : candidates) {
    try {
      const response = await fetch(candidate.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env[candidate.envKey]}` },
        body: JSON.stringify({
          model: candidate.model,
          temperature: 0,
          max_tokens: maxTokens,
          ...(json ? { response_format: { type: 'json_object' } } : {}),
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        console.error('Yardımcı model hatası:', candidate.model, response.status, data?.error?.message || data?.error);
        if (AUTH_BLOCK_STATUSES.has(response.status)) blockedUntil.set(candidate.id, Date.now() + AUTH_BLOCK_MS);
        continue;
      }
      return { text: data.choices?.[0]?.message?.content || '', usage: data.usage || null, via: { provider: candidate.id, model: candidate.model } };
    } catch (error) {
      console.error('Yardımcı model hatası:', candidate.model, error.message);
    }
  }
  throw Object.assign(new Error('Yardımcı model yanıt vermedi.'), { upstream: true });
}

const EXTRACT_PROMPT = `Kullanıcının bir sohbet asistanına yazdığı mesajı inceliyorsun.
Görevin: Mesajda kullanıcının KENDİSİ hakkında, gelecekteki sohbetlerde işe yarayacak KALICI bilgi varsa çıkarmak.

Kaydet: isim, yaş, şehir, meslek/okul, aile durumu, hobiler, kalıcı tercihler (dil, üslup, beslenme), sağlık kısıtları (alerji vb.), süren uzun projeler, kullanıcının açıkça "hatırla/unutma" dediği şeyler.
Kaydetme: tek seferlik istekler, sorular, anlık ruh hâli, başkaları hakkındaki bilgiler, genel bilgi, şaka/varsayım, parola, kart, T.C. kimlik, adres, telefon gibi hassas kimlik verileri.
Kullanıcı bir bilgiyi unutmanı istiyorsa o bilginin anahtarını "forget" listesine koy.

Mevcut anahtarlar verilir; aynı konudaki bilgi güncellenecekse AYNI anahtarı kullan.
Anahtarlar kısa ve Türkçe olsun (ör. "isim", "şehir", "meslek", "kahve tercihi"). Değerler tek kısa cümle olsun.
Emin değilsen hiçbir şey kaydetme.

Yalnızca şu JSON'u döndür:
{"memories":[{"key":"...","value":"...","category":"kisisel|tercih|is|saglik|proje|genel"}],"forget":["..."]}`;

const ALLOWED_CATEGORIES = new Set(['kisisel', 'tercih', 'is', 'saglik', 'proje', 'genel']);
const SENSITIVE_VALUE = /\b\d{11}\b|\b(?:\d[ -]?){13,19}\b|parola|şifre|sifre|password|iban/iu;

function sanitizeExtraction(parsed, existingKeys, limit = MAX_EXTRACTED_PER_MESSAGE) {
  const memories = (Array.isArray(parsed?.memories) ? parsed.memories : [])
    .filter(item => item && typeof item.key === 'string' && typeof item.value === 'string')
    .map(item => ({
      key: item.key.trim().slice(0, 60),
      value: item.value.trim().slice(0, 300),
      category: ALLOWED_CATEGORIES.has(item.category) ? item.category : 'genel',
    }))
    .filter(item => item.key && item.value && !SENSITIVE_VALUE.test(item.value))
    .slice(0, limit);
  const known = new Set(existingKeys);
  const forget = (Array.isArray(parsed?.forget) ? parsed.forget : [])
    .filter(key => typeof key === 'string' && known.has(key))
    .slice(0, MAX_EXTRACTED_PER_MESSAGE);
  return { memories, forget };
}

async function extractMemories(fetch, { message, existing = [] }) {
  const existingKeys = existing.map(memory => memory.key);
  const existingList = existing.length
    ? existing.slice(0, 60).map(memory => `- ${memory.key}: ${memory.value}`).join('\n')
    : '(yok)';
  const { text, usage, via } = await callAssistModel(fetch, {
    system: EXTRACT_PROMPT,
    user: `Mevcut hafıza:\n${existingList}\n\nKullanıcı mesajı:\n"""${String(message).slice(0, 4000)}"""`,
    maxTokens: 400,
    json: true,
  });
  return { ...sanitizeExtraction(parseJsonObject(text), existingKeys), usage, via };
}

const MAX_IMPORTED = 60;
const MAX_IMPORT_CHARS = 20000;

const IMPORT_PROMPT = `Kullanıcı, başka bir yapay zekâ uygulamasının (ChatGPT, Gemini, Claude vb.) onun hakkında hatırladıklarını dökümü olarak yapıştırdı.
Döküm genelde şu bölümlerden oluşur: Demografik Bilgiler, İlgi Alanları ve Tercihler, İlişkiler, Tarihli Etkinlikler/Projeler/Planlar, Talimatlar. Her girişin altında "Kanıt:" satırı ve tarih olabilir; en sonda "Şuradan içe aktarıldı: <uygulama>" satırı bulunur.
Görevin: Bu dökümden kullanıcının KENDİSİ hakkındaki kalıcı bilgileri KocaMind hafızasına uygun kayıtlara çevirmek.

Kurallar:
- Her girişi tek kayda çevir; "Kanıt:" satırlarını ayrı kayıt yapma, yalnızca bilginin doğruluğunu anlamak için kullan.
- Kategori eşleşmesi: Demografik → kisisel; İlgi alanları ve tercihler → tercih (iş/okulla ilgiliyse is); İlişkiler → kisisel; Projeler ve planlar → proje; Talimatlar → tercih; sağlık kısıtları → saglik.
- İlişkilerde yalnızca kullanıcıyla ilgili kalıcı gerçeği al (ör. "evli", "bir kardeşi var"); diğer kişilerin adı dışındaki ayrıntılarını alma.
- Tarihli etkinliklerden yalnızca hâlâ geçerli olan projeleri, hedefleri ve planları al; bitmiş tek seferlik olayları alma. Tarih önemliyse değere ekle (ör. "2026 güzünde başladı").
- Talimatları kullanıcının sözlerine sadık kalarak kısa bir tercih cümlesine çevir (ör. "cevap üslubu": "Kısa ve net cevap istiyor").
- Yalnızca dökümde açıkça yazan bilgileri al; tahmin, yorum veya ek bilgi ekleme.
- Asistanın kendisi ve uygulama ayarlarıyla ilgili bilgileri alma.
- Parola, kart, T.C. kimlik, IBAN, açık adres, telefon gibi hassas kimlik verilerini asla alma.
- Mevcut anahtarlar verilir; aynı konudaki bilgi için AYNI anahtarı kullan.
- Anahtarlar kısa ve Türkçe olsun (ör. "isim", "şehir", "meslek", "kahve tercihi"); değerler tek kısa Türkçe cümle olsun.
- Döküm başka dildeyse Türkçeye çevir.
- "(eski olabilir)" notu düşülmüş satırları alma; yalnızca güncel bilgileri al.

Yalnızca şu JSON'u döndür ("from" dökümün sonundaki uygulama adıdır, yoksa boş bırak):
{"from":"ChatGPT","memories":[{"key":"...","value":"...","category":"kisisel|tercih|is|saglik|proje|genel"}]}`;

const KNOWN_SOURCES = ['ChatGPT', 'Claude', 'Gemini', 'Grok', 'Copilot', 'Perplexity', 'DeepSeek', 'Meta AI', 'Mistral', 'Le Chat'];

// Dökümün sonundaki "Şuradan içe aktarıldı: X" satırından ya da modelin cevabından uygulama adı.
function importSource(text, parsed) {
  const line = String(text || '').match(/(?:Şuradan içe aktarıldı|Imported from)\s*:\s*([^\n]{1,40})/iu)?.[1]
    || (typeof parsed?.from === 'string' ? parsed.from : '');
  const clean = line.replace(/[<>*_`"']/g, '').trim();
  if (!clean) return null;
  return KNOWN_SOURCES.find(name => clean.toLocaleLowerCase('tr').includes(name.toLocaleLowerCase('tr'))) || clean.slice(0, 30);
}

async function importMemories(fetch, { text, existing = [] }) {
  const existingKeys = existing.map(memory => memory.key);
  const existingList = existing.length
    ? existing.slice(0, 100).map(memory => `- ${memory.key}: ${memory.value}`).join('\n')
    : '(yok)';
  const { text: output, usage, via } = await callAssistModel(fetch, {
    system: IMPORT_PROMPT,
    user: `Mevcut hafıza:\n${existingList}\n\nYapıştırılan döküm:\n"""${String(text).slice(0, MAX_IMPORT_CHARS)}"""`,
    maxTokens: 2500,
    json: true,
  });
  const parsed = parseJsonObject(output);
  const { memories } = sanitizeExtraction(parsed, existingKeys, MAX_IMPORTED);
  return { memories, from: importSource(text, parsed), usage, via };
}

const MIN_INSIGHT_MEMORIES = 3;
const MIN_INSIGHT_MESSAGES = 8;
const INSIGHT_CHAT_LIMIT = 30;
const INSIGHT_MESSAGE_CHARS = 400;
const INSIGHT_MESSAGES_BUDGET = 16000;

const INSIGHT_PROMPT = `Bir yapay zekâ asistanısın. Kullanıcının seninle yaptığı sohbetlerdeki KENDİ mesajlarına ve hafızandaki kayıtlara bakarak onun hakkında kısa, OBJEKTİF bir değerlendirme yazıyorsun.
Kullanıcı bu metni kendi hafıza sayfasında okuyacak.

Neye bak:
- Hangi konularda ve ne tür işler için sana geliyor (ör. kod, ders, iş, günlük sorular), hangileri tekrar ediyor.
- Nasıl çalışıyor ve nasıl soruyor: kısa ve hızlı mı, ayrıntılı mı, adım adım mı istiyor, ne sıklıkla düzeltme veya tekrar istiyor.
- Süren projeleri, hedefleri ve ilgi alanları; bunların birbirine bağlantısı.

Kurallar:
- Yalnızca mesajlarda ve kayıtlarda görünenlere dayan; görünmeyeni uydurma. Az veriye dayanan çıkarımları "görünüşe göre" gibi ifadelerle yumuşat.
- Tarafsız ol: övgü, iltifat, abartı, nasihat ve yargı yok. Gözlem gibi yaz ("...için sık sık geliyorsun", "...üzerinde çalışıyorsun").
- Mesajlardan birebir alıntı yapma, kişileri ve hassas ayrıntıları (adres, telefon, para, ilişki ayrıntıları) anma.
- Sağlık, din, siyaset, cinsel yönelim, etnik köken veya psikolojik durum hakkında çıkarım yapma.
- Kullanıcıya "sen" diye hitap et, Türkçe, düz metin; başlık, madde işareti ve emoji kullanma.
- Kısa tut: en fazla 4 cümle ve 80 kelime. En belirgin 2-3 gözlemi seç, her şeyi sayma.`;

// Son sohbetlerden yalnızca kullanıcının kendi mesajları; en yeniler önce, bütçeye sığdığı kadar.
function recentUserMessages(chats = []) {
  const sorted = [...chats].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)).slice(0, INSIGHT_CHAT_LIMIT);
  const out = [];
  let used = 0;
  for (const chat of sorted) {
    const messages = (Array.isArray(chat.messages) ? chat.messages : [])
      .filter(m => m && m.role === 'user' && typeof m.content === 'string' && m.content.trim().length > 3)
      .reverse();
    for (const message of messages) {
      const content = message.content.trim().replace(/\s+/g, ' ').slice(0, INSIGHT_MESSAGE_CHARS);
      if (used + content.length > INSIGHT_MESSAGES_BUDGET) return out;
      out.push(content);
      used += content.length;
    }
  }
  return out;
}

async function describeUser(fetch, { memories = [], messages = [] }) {
  const parts = [];
  if (memories.length) parts.push(`Hafızadaki kayıtlar:\n${memories.slice(0, 100).map(m => `- ${m.key}: ${m.value}`).join('\n')}`);
  if (messages.length) parts.push(`Kullanıcının son sohbetlerindeki kendi mesajları (en yeniden eskiye):\n${messages.map(m => `- ${m}`).join('\n')}`);
  const { text, usage, via } = await callAssistModel(fetch, {
    system: INSIGHT_PROMPT,
    user: parts.join('\n\n'),
    maxTokens: 300,
    json: false,
  });
  return { insight: text.trim().slice(0, 900), usage, via };
}

// Özet iki bölümdür: kullanıcının kendi söyledikleri ile asistanın eski cevapları ayrı tutulur;
// asistanın iddiaları sonraki turlarda doğrulanmış bilgi gibi geri verilmesin diye.
const SUMMARY_PROMPT = `Bir sohbetin eski kısmını, asistanın konuşmaya kaldığı yerden devam edebilmesi için özetliyorsun.
Özeti tam olarak şu iki başlıkla yaz:

Kullanıcının söyledikleri:
- Kullanıcının amacı, kendisi hakkında verdiği bilgiler, kısıtları, kararları ve açık kalan istekleri.

Asistanın önceki cevapları (doğrulanmamış):
- Asistanın verdiği bilgiler, iddialar, öneriler ve ürettiği önemli çıktılar (kod, liste, plan adları).

Kurallar:
- Asistanın söylediği bir şeyi kullanıcının bilgisi gibi yazma; kullanıcı açıkça onayladıysa "kullanıcı onayladı" diye belirt.
- Asistanın cevaplarını kesin gerçek gibi değil, "asistan şunu söyledi/önerdi" biçiminde yaz.
- Önceki özet verilmişse onu yeni mesajlarla birleştirip aynı iki başlıkla tek bir güncel özet yaz.
- Türkçe, madde işaretli, en fazla 1800 karakter. Yalnızca özeti döndür.`;

// Özet modele verilirken başına eklenen açıklama (web ve Android de aynı metni kullanır).
const SUMMARY_HEADER = 'BU SOHBETİN ÖNCEKİ KISMININ ÖZETİ (eski mesajlar yer kazanmak için özetlendi). "Kullanıcının söyledikleri" bölümünü kullanıcının verdiği bilgi olarak kabul et. "Asistanın önceki cevapları" bölümü senin eski cevaplarındır; doğrulanmış bilgi değildir ve yanlış olabilir: kesin bilgi gibi tekrarlama, gerekirse kontrol edip düzelt.';

function transcript(messages) {
  return messages
    .map(message => `${message.role === 'user' ? 'Kullanıcı' : 'Asistan'}: ${String(message.content || '').slice(0, 6000)}`)
    .join('\n\n');
}

async function summarizeConversation(fetch, { previousSummary = '', messages = [] }) {
  const parts = [];
  if (previousSummary) parts.push(`Önceki özet:\n${previousSummary.slice(0, MAX_SUMMARY_CHARS)}`);
  parts.push(`Özetlenecek mesajlar:\n${transcript(messages).slice(0, 60000)}`);
  const { text, usage, via } = await callAssistModel(fetch, {
    system: SUMMARY_PROMPT,
    user: parts.join('\n\n'),
    maxTokens: 2000,
    json: false,
  });
  return { summary: text.trim().slice(0, MAX_SUMMARY_CHARS), usage, via };
}

// Sunucu tarafı emniyet sınırı: istemci ne gönderirse göndersin geçmiş
// bağlam sınırını aşmasın diye en yeni mesajlar bütçeye sığacak kadar tutulur.
function trimHistory(history, maxChars = MAX_HISTORY_CHARS) {
  if (!Array.isArray(history)) return [];
  let total = 0;
  let start = history.length;
  while (start > 0) {
    const size = String(history[start - 1]?.content || '').length;
    if (total + size > maxChars && start < history.length) break;
    total += size;
    start -= 1;
  }
  const kept = history.slice(start);
  // Geçmiş asistan mesajıyla başlarsa bazı sağlayıcılar reddeder.
  while (kept.length && kept[0].role !== 'user') kept.shift();
  return kept;
}

function cleanSummary(value) {
  return typeof value === 'string' ? value.trim().slice(0, MAX_SUMMARY_CHARS) : '';
}

function withConversationSummary(systemPrompt, summary) {
  const clean = cleanSummary(summary);
  if (!clean) return systemPrompt;
  return `${systemPrompt}\n\n${SUMMARY_HEADER}\n${clean}`;
}

module.exports = {
  MAX_MEMORIES_PER_USER,
  MAX_HISTORY_CHARS,
  mightContainPersonalInfo,
  parseJsonObject,
  sanitizeExtraction,
  isAssistAvailable,
  assistCandidates,
  primaryAssist,
  resetAssistProviderState,
  extractMemories,
  importMemories,
  importSource,
  describeUser,
  MIN_INSIGHT_MEMORIES,
  MIN_INSIGHT_MESSAGES,
  recentUserMessages,
  MAX_IMPORT_CHARS,
  summarizeConversation,
  trimHistory,
  cleanSummary,
  withConversationSummary,
  SUMMARY_PROMPT,
  SUMMARY_HEADER,
};
