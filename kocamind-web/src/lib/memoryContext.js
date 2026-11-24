const MAX_PROMPT_MEMORIES = 20
const ALWAYS_INCLUDED_CATEGORIES = new Set(['kisisel', 'tercih', 'saglik'])

// Son mesajlar modele aynen gider; bütçeyi aşan eski kısım özetlenir. Geniş bağlamlı bulut
// modellerinde ~30-40 bin token, Groq'un dakikalık token sınırı dar olduğu için orada küçük tutulur.
const RECENT_BUDGET_CHARS = 120000
const SMALL_RECENT_BUDGET_CHARS = 12000
const SMALL_CONTEXT_PROVIDERS = new Set(['groq', 'local'])
const RECENT_MIN_MESSAGES = 6
const SUMMARIZE_AFTER_CHARS = 6000
const SUMMARIZE_AFTER_MESSAGES = 12
const SUMMARY_MESSAGE_CHARS = 6000

function terms(text) {
  return String(text || '')
    .toLocaleLowerCase('tr')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(word => word.length >= 3)
    .map(word => word.slice(0, 5))
}

export function selectRelevantMemories(memories = [], text = '', limit = MAX_PROMPT_MEMORIES) {
  if (!Array.isArray(memories) || memories.length <= limit) return Array.isArray(memories) ? memories : []
  const queryTerms = new Set(terms(text))
  const scored = memories.map((memory, index) => {
    const memoryTerms = terms(`${memory.key} ${memory.value}`)
    const overlap = memoryTerms.filter(term => queryTerms.has(term)).length
    const core = ALWAYS_INCLUDED_CATEGORIES.has(memory.category) ? 1 : 0
    return { memory, index, score: overlap * 3 + core }
  })
  scored.sort((a, b) => b.score - a.score || a.index - b.index)
  return scored.slice(0, limit).map(item => item.memory)
}

export function formatMemoriesForPrompt(memories = []) {
  if (!memories.length) return ''
  return `\n\nKullanıcı hakkında hafızandaki bilgiler (yalnızca konuyla ilgiliyse doğal biçimde kullan, her cevapta tekrar etme):\n${memories.map(m => `- ${m.key}: ${m.value}`).join('\n')}`
}

const contentSize = message => String(message?.content || '').length

export function contextBudgetChars(provider) {
  return SMALL_CONTEXT_PROVIDERS.has(provider) ? SMALL_RECENT_BUDGET_CHARS : RECENT_BUDGET_CHARS
}

export function planConversationContext(history = [], budgetChars = RECENT_BUDGET_CHARS) {
  let summaryIndex = -1
  let summary = ''
  history.forEach((message, index) => {
    if (typeof message?.contextSummary === 'string' && message.contextSummary) {
      summaryIndex = index
      summary = message.contextSummary
    }
  })

  const uncovered = history.slice(summaryIndex + 1)
  let start = uncovered.length
  let recentChars = 0
  while (start > 0) {
    const size = contentSize(uncovered[start - 1])
    if (uncovered.length - start >= RECENT_MIN_MESSAGES && recentChars + size > budgetChars) break
    recentChars += size
    start -= 1
  }

  const older = uncovered.slice(0, start)
  const olderChars = older.reduce((sum, message) => sum + contentSize(message), 0)
  const needsSummary = older.length > 0 && (olderChars >= SUMMARIZE_AFTER_CHARS || older.length >= SUMMARIZE_AFTER_MESSAGES)

  return {
    summary,
    needsSummary,
    toSummarize: needsSummary ? older : [],
    newSummaryIndex: needsSummary ? summaryIndex + older.length : summaryIndex,
    recent: needsSummary ? uncovered.slice(start) : uncovered,
  }
}

export function toSummaryMessages(messages = []) {
  return messages.map(message => ({
    role: message.role === 'user' ? 'user' : 'ai',
    content: String(message.content || '').slice(0, SUMMARY_MESSAGE_CHARS),
  }))
}

// Özet modele verilirken başına eklenir; backend memoryAssist.js ile aynı metin. Kullanıcının
// söyledikleri bilgi kabul edilir, asistanın eski cevapları doğrulanmamış sayılır.
export const SUMMARY_HEADER = 'BU SOHBETİN ÖNCEKİ KISMININ ÖZETİ (eski mesajlar yer kazanmak için özetlendi). "Kullanıcının söyledikleri" bölümünü kullanıcının verdiği bilgi olarak kabul et. "Asistanın önceki cevapları" bölümü senin eski cevaplarındır; doğrulanmış bilgi değildir ve yanlış olabilir: kesin bilgi gibi tekrarlama, gerekirse kontrol edip düzelt.'
