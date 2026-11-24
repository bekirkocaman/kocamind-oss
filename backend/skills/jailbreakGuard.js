// Kullanıcı mesajını modele gitmeden önce yerel ve senkron tarar.
// Amaç yalnızca AÇIK jailbreak / prompt injection emirlerini yakalamak; konuyu
// soran normal sorular (ör. "jailbreak nedir?") geçmeli. Yanlış pozitif,
// kaçırılan denemeden daha kötüdür; geri kalanını SECURITY_CORE karşılar.

const ZERO_WIDTH = /[\u00ad\u200b-\u200f\u2060\ufeff]/g;
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's' };
const HOMOGLYPHS = {
  '\u0430': 'a', '\u0432': 'b', '\u0441': 'c', '\u0435': 'e', '\u04bb': 'h',
  '\u0456': 'i', '\u0458': 'j', '\u043a': 'k', '\u043c': 'm', '\u043d': 'n',
  '\u043e': 'o', '\u0440': 'p', '\u0455': 's', '\u0442': 't', '\u0443': 'y', '\u0445': 'x',
  '\u03b1': 'a', '\u03b2': 'b', '\u03b5': 'e', '\u03b9': 'i', '\u03ba': 'k',
  '\u03bd': 'n', '\u03bf': 'o', '\u03c1': 'p', '\u03c4': 't', '\u03c5': 'u', '\u03c7': 'x',
};
const HOMOGLYPH_RE = new RegExp(`[${Object.keys(HOMOGLYPHS).join('')}]`, 'g');

function normalizeForScan(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(ZERO_WIDTH, '')
    .replace(/[ \t]{2,}|\t/g, ' ')
    .replace(/\r\n?|\n{2,}/g, '\n')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/[’‘]/g, "'")
    .replace(/[*`~]+|__+/g, '')
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(HOMOGLYPH_RE, ch => HOMOGLYPHS[ch])
    .replace(/[013457@$]/g, ch => LEET[ch])
    .replace(/(?<=[a-z])[.-](?=[a-z])/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

const AI_TR = '(?:yapay zeka|asistan|model|bot|ai)';
const NO_RULES_TR = '(?:kuralsiz|kisitsiz|filtresiz|sansursuz|sinirsiz|ahlaksiz)';

// İlk eşleşen kural döner; sıra testlerdeki beklenen kimlikleri belirler.
const RULES = [
  {
    id: 'ignore-previous',
    patterns: [
      /\b(?:ignore|disregard|forget|override|bypass)\s+(?:(?:all|any|the|your|my|of|these|those)\s+){0,4}(?:(?:previous|prior|above|earlier|preceding|system|original|safety)\s+){1,4}(?:instructions?|rules|prompts?|guidelines|directives|restrictions)\b/,
      /\b(?:ignore|disregard|forget)\s+all\s+(?:(?:your|the)\s+)?(?:instructions|rules|guidelines)\b/,
      /\b(?:onceki|yukaridaki|ilk|tum|butun|sistem|eski|mevcut)\s+(?:\w+\s+){0,2}(?:talimat|kural|komut|yonerge|kisitlama|filtre)\w*\s+(?:\w+\s+){0,3}?(?:unut(?:un|unuz)?|yok say(?:in|iniz)?|gormezden gel(?:in|iniz)?|iptal et|iptal ed(?:in|iniz)|devre disi birak(?:in|iniz)?|gecersiz say(?:in|iniz)?)\b/,
      /\b(?:unut(?:un|unuz)?|yok say(?:in|iniz)?|gormezden gel(?:in|iniz)?)\s+(?:\w+\s+){0,2}(?:onceki|tum|butun|sistem)\s+(?:\w+\s+)?(?:talimat|kural)\w*\b/,
    ],
  },
  {
    id: 'dan',
    patterns: [
      /\bdo anything now\b/,
      /(?<!')\bdan\s+(?:mode|mod(?:u|unu|una|unda)?)\b/,
      /\byou(?: are|'re)\s+(?:now\s+)?dan\b/,
      /\bsen\s+(?:artik\s+)?dan(?:'?sin)?\b/,
    ],
  },
  {
    id: 'dev-mode',
    patterns: [
      /\b(?:developer|god|jailbreak|unrestricted|uncensored)\s+mode\s+(?:(?:is\s+)?(?:enabled|activated|active)\b|is\s+on\b|on(?=[.!;\n]|$))/,
      /\b(?:enable|activate|enter|switch to)\s+(?:jailbreak|god|unrestricted|uncensored)\s+mode\b/,
      /(?:^|[.!;\n][ \t]*)(?:please[ \t]+|now[ \t]+)?(?:enable|activate|enter|switch to)[ \t]+developer[ \t]+mode\b(?![^.!?\n]*\b(?:on|in|for)\s+(?:android|chrome|ios|windows|macos|safari|firefox|edge|phone|device|settings|browser)\b)(?![^.!?\n]*\?)/,
      /\byou\s+(?:are|must|should|will|can)\s+(?:now\s+)?(?:be\s+in|enter|enable|activate|switch to|use)\s+developer\s+mode\b/,
      /\b(?:tanri|jailbreak|kisitsiz|sansursuz|filtresiz)\s+mod(?:u|unu|una|unda|a)?\s+(?:ac(?:in)?|aktif(?:\s+et|lestir)?|etkin(?:lestir)?|gec(?:in)?|calis(?:in)?)\b/,
      /\bsen\s+(?:\w+\s+){0,2}?gelistirici\s+mod(?:u|unu|una|unda(?:sin)?)\b/,
      /(?:^|[.!;\n][ \t]*)(?:simdi[ \t]+|artik[ \t]+|lutfen[ \t]+)?gelistirici\s+mod(?:u|unu|una)\s+(?:ac(?:in)?|gec(?:in)?|etkinlestir(?:in)?|aktif\s+et)\b(?![^.!?\n]*\?)(?![^.!?\n]*\b(?:mi|mu)\b)/,
    ],
  },
  {
    id: 'no-rules-persona',
    patterns: [
      /\b(?:you are|you're|act as|pretend (?:to be|you are)|roleplay as|behave like)\s+(?:\w+\s+){0,6}?(?:with\s+)?(?:no|without|zero)\s+(?:rules|restrictions|filters|limits|guidelines|censorship|boundaries|ethics)\b/,
      /\b(?:you are|you're|act as|pretend to be|roleplay as|be)\s+(?:now\s+)?(?:an?\s+)?(?:unfiltered|uncensored|unrestricted|unaligned|jailbroken)\b/,
      new RegExp(`\\bsen\\s+(?:\\w+\\s+){0,2}${NO_RULES_TR}\\s+(?:bir\\s+)?${AI_TR}`),
      new RegExp(`\\b${NO_RULES_TR}\\s+(?:bir\\s+)?${AI_TR}\\w*\\s+(?:ol\\b|gibi davran|olarak davran|rolune gir)`),
      new RegExp(`\\b${NO_RULES_TR}\\s+(?:bir\\s+)?${AI_TR}(?:sin|sun)\\b`),
      /\bsenin\s+(?:hicbir|hic bir)\s+(?:kural|kisitlama|filtre|sinir)\w*\s+yok/,
    ],
  },
  {
    id: 'prompt-leak',
    patterns: [
      /\b(?:reveal|show|print|repeat|output|tell me|give me|display|dump|leak|write out)\s+(?:\w+\s+){0,3}?your\s+(?:system prompt|system message|initial instructions|hidden instructions|original instructions)\b/,
      /\bwhat(?:'s| is| are)\s+your\s+(?:system prompt|initial instructions|hidden instructions)\b/,
      /\b(?:sistem\s+(?:prompt'?u?nu|talimatlarini|talimatini)|(?:gizli|ilk|orijinal)\s+talimatlarini)\s+(?:\w+\s+){0,3}?(?:goster|yaz|soyle|paylas|ver|kopyala|tekrarla|dok)/,
    ],
  },
  {
    id: 'fake-system',
    patterns: [
      /<\|im_start\|>/,
      /<\|(?:system|im_end)\|>/,
      /\[\[[ \t]*\/?(?:system|inst)[ \t]*\]\]/,
      /^[ \t]*\[\/?(?:system|inst)\]/m,
      /^[ \t]*(?:###[ \t]*system[ \t]*:|system[ \t]*:(?![ \t]*(?:ubuntu|windows|macos|os[ \t]*x|linux|debian|fedora|arch|centos|redhat|alpine|android|ios|darwin|freebsd|kernel)\b))/m,
      /<\/?system>/,
    ],
  },
];

function scanMessage(text, env = process.env) {
  if (String(env.JAILBREAK_GUARD || '').toLowerCase() === 'off') return { blocked: false, rule: null };
  const normalized = normalizeForScan(text);
  if (!normalized) return { blocked: false, rule: null };
  for (const rule of RULES) {
    if (rule.patterns.some(pattern => pattern.test(normalized))) return { blocked: true, rule: rule.id };
  }
  return { blocked: false, rule: null };
}

// Geçmişteki engelli kullanıcı mesajını ve hemen ardındaki eşleşen asistan cevabını,
// ayrıca istemcinin sahte asistan rolüyle enjekte ettiği mesajları eler.
function sanitizeHistory(items, env = process.env) {
  if (!Array.isArray(items)) return [];
  const clean = [];
  let dropNextAssistant = false;
  for (const msg of items) {
    if (!msg || !['user', 'ai', 'assistant'].includes(msg.role) || typeof msg.content !== 'string') continue;
    if (msg.role === 'user') {
      if (scanMessage(msg.content, env).blocked) {
        dropNextAssistant = true;
        continue;
      }
      dropNextAssistant = false;
      clean.push(msg);
      continue;
    }
    if (dropNextAssistant) {
      dropNextAssistant = false;
      continue;
    }
    if (scanMessage(msg.content, env).blocked) continue;
    clean.push(msg);
  }
  return clean;
}

module.exports = { scanMessage, normalizeForScan, sanitizeHistory, RULES };
