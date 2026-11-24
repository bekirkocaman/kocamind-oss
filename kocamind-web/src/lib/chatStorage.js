import { filterChatsByRetention } from "./retention";
import { stripEphemeralMessages } from "./messagePrivacy";
import { isErrorReply } from "./chatErrors";

export const STORAGE_KEY = 'kocamind_chats'

export const THEME_KEY = 'kocamind_theme'

export const FEEDBACK_KEY = 'kocamind_feedback'

export const MODEL_KEY = 'kocamind_model'

export const PLUGINS_KEY = 'kocamind_plugins'

export const RAG_KEY = 'kocamind_use_rag'

export const OFFLINE_QUEUE_KEY = 'kocamind_offline_queue'

export const DEFAULT_MODEL = { id: 'gpt-5.6-luna', provider: 'openai', label: 'GPT-5.6 Luna' }

export function loadOfflineQueue() {
  try {
    const queue = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]')
    return Array.isArray(queue) ? queue : []
  } catch { return [] }
}

export function loadSetting(key, fallback) {
  try { const v = localStorage.getItem(`kocamind_${key}`); return v !== null ? JSON.parse(v) : fallback }
  catch { return fallback }
}

export const TONE_PROMPTS = {
  normal: 'Doğal ve dengeli bir dille konuş.',
  concise: 'Olabildiğince kısa ve öz cevaplar ver. Sadece en önemli bilgiyi ilet.',
  explanatory: 'Her şeyi adım adım, örneklerle ve detaylı açıkla. Bir öğretmen gibi sabırlı ol.',
  formal: 'Profesyonel ve resmi bir dille konuş. Saygılı ve kurumsal ol.',
}

export function buildSettingsContext() {
  const parts = []
  const userName = loadSetting('user_name', '')
  const aiName = loadSetting('ai_name', '')
  const occupations = loadSetting('occupations', [])
  const preferences = loadSetting('preferences', '')
  const activeTone = loadSetting('active_tone', 'normal')
  const language = loadSetting('language', 'tr')

  if (language === 'en') parts.push('IMPORTANT: Always respond in English. The user prefers English. Never use Turkish.')
  if (userName) parts.push(`Kullanıcının adı: ${userName}. Ona "${userName}" diye hitap et.`)
  if (aiName) parts.push(`Senin adın: ${aiName}. Kendini "${aiName}" olarak tanıt.`)
  if (occupations.length > 0) parts.push(`Kullanıcının mesleği/rolü: ${occupations.join(', ')}. Cevaplarını buna göre şekillendir.`)
  if (preferences) parts.push(`Kullanıcının özel tercihleri (mutlaka uygula): ${preferences}`)

  if (activeTone === 'custom') {
    const customStyle = loadSetting('custom_style_prompt', '')
    if (customStyle) parts.push(customStyle)
  } else if (TONE_PROMPTS[activeTone] && activeTone !== 'normal') {
    parts.push(`Cevap tarzı talimatı: ${TONE_PROMPTS[activeTone]}`)
  }

  if (parts.length === 0) return ''
  return '\n\n' + parts.join('\n')
}

export function loadModel() {
  try {
    const m = JSON.parse(localStorage.getItem(MODEL_KEY))
    if (m && m.id && m.provider) {
      // Bir kerelik geçiş: eski varsayılan (groq) kullanıcılarını Claude'a taşı
      if (m.provider === 'groq' && !localStorage.getItem('kocamind_claude_migrated')) {
        localStorage.setItem('kocamind_claude_migrated', '1')
        localStorage.setItem(MODEL_KEY, JSON.stringify(DEFAULT_MODEL))
        return DEFAULT_MODEL
      }
      if (m.id === 'deepseek-chat' && !localStorage.getItem('kocamind_openai_56_migrated')) {
        localStorage.setItem('kocamind_openai_56_migrated', '1')
        localStorage.setItem(MODEL_KEY, JSON.stringify(DEFAULT_MODEL))
        return DEFAULT_MODEL
      }
      if (m.provider === 'openai' && m.id !== 'gpt-5.6-luna') {
        localStorage.setItem(MODEL_KEY, JSON.stringify(DEFAULT_MODEL))
        return DEFAULT_MODEL
      }
      return m
    }
  } catch { /* yoksay */ }
  return DEFAULT_MODEL
}

export function loadFeedback() {
  try { return JSON.parse(localStorage.getItem(FEEDBACK_KEY)) || {} }
  catch { return {} }
}

export function saveFeedback(fb) {
  try { localStorage.setItem(FEEDBACK_KEY, JSON.stringify(fb)) } catch { /* kota */ }
}

export function applyRetention(chats) {
  return filterChatsByRetention(chats, loadSetting('data_retention', 'forever'))
}

export function chatsStorageKey(uid) {
  return `${STORAGE_KEY}_${uid}`
}

export function assistantsStorageKey(uid) {
  return `kocamind_assistants_${uid}`
}

export function clearLegacySharedStorage() {
  try {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem('kocamind_assistants')
  } catch { /* yoksay */ }
}

export function loadChats(uid) {
  if (!uid) return []
  try { return applyRetention(JSON.parse(localStorage.getItem(chatsStorageKey(uid))) || []) }
  catch { return [] }
}

export function saveChats(chats, uid) {
  if (!uid) return
  const key = chatsStorageKey(uid)
  const retainedChats = applyRetention(chats).map(chat => ({
    ...chat,
    messages: stripEphemeralMessages(chat.messages),
  }))
  try {
    localStorage.setItem(key, JSON.stringify(retainedChats))
  } catch {
    try {
      const slim = retainedChats.map(c => ({
        ...c,
        messages: c.messages.map(m => ({
          ...m,
          content: (m.content || '').replace(/!\[[^\]]*\]\(data:[^)]+\)/g, '_[Oluşturulan görsel]_'),
          imageUrl: undefined,
        })),
      }))
      localStorage.setItem(key, JSON.stringify(slim))
    } catch { /* tamamen dolu — sessiz geç */ }
  }
}

export function chatTitle(messages) {
  const firstAi = messages.find(m => m.role === 'ai' && !isErrorReply(m))
  if (firstAi) {
    const text = firstAi.content.replace(/[#*`>\-\n[\]!]/g, ' ').replace(/\s+/g, ' ').trim()
    return text.slice(0, 40) + (text.length > 40 ? '…' : '')
  }
  const first = messages.find(m => m.role === 'user')
  if (!first) return 'Yeni Sohbet'
  return first.content.slice(0, 35) + (first.content.length > 35 ? '…' : '')
}

export function chatFingerprint(c) {
  return JSON.stringify([c.title, c.pinned, c.archived, c.updatedAt, (c.messages || []).length, (c.messages || []).at(-1)?.content?.length])
}
