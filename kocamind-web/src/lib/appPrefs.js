// Android'deki AppPrefs'in web karşılığı: yazı tipi stili, azaltılmış hareket, ses ve bildirim tercihleri.
// Değerler cihazda düz metin olarak durur; theme-init.js ilk karede yazı tipi ve hareket tercihini okur.
import { useSyncExternalStore } from 'react'

export const VOICE_LANGS = [
  { id: 'tr-TR', label: 'Türkçe' },
  { id: 'en-US', label: 'İngilizce' },
]

export const VOICE_RATES = [
  { id: 0.75, label: 'Yavaş' },
  { id: 0.9, label: 'Normal' },
  { id: 1.1, label: 'Hızlı' },
  { id: 1.3, label: 'Çok hızlı' },
]

const KEYS = {
  replyFont: 'kocamind_reply_font',
  reduceMotion: 'kocamind_reduce_motion',
  voiceLang: 'kocamind_voice_lang',
  voiceRate: 'kocamind_voice_rate',
  notifyReplies: 'kocamind_notify_replies',
}

function read(key) {
  try { return localStorage.getItem(key) } catch { return null }
}

function write(key, value) {
  try { localStorage.setItem(key, value) } catch { /* depolama kapalı ya da dolu */ }
}

export function parsePrefs(get = read) {
  const rate = Number(get(KEYS.voiceRate))
  const lang = get(KEYS.voiceLang)
  return {
    replyFont: get(KEYS.replyFont) === 'serif' ? 'serif' : 'sans',
    reduceMotion: get(KEYS.reduceMotion) === '1',
    voiceLang: VOICE_LANGS.some(item => item.id === lang) ? lang : 'tr-TR',
    voiceRate: VOICE_RATES.some(item => item.id === rate) ? rate : 0.9,
    notifyReplies: get(KEYS.notifyReplies) === '1',
  }
}

let current = parsePrefs()
const listeners = new Set()

function applyToDocument(prefs) {
  const root = document.documentElement
  if (prefs.replyFont === 'serif') root.setAttribute('data-reply-font', 'serif')
  else root.removeAttribute('data-reply-font')
  if (prefs.reduceMotion) root.setAttribute('data-reduce-motion', 'true')
  else root.removeAttribute('data-reduce-motion')
}

export function getPrefs() {
  return current
}

export function setPref(name, value) {
  if (!(name in KEYS)) return
  const stored = typeof value === 'boolean' ? (value ? '1' : '0') : String(value)
  write(KEYS[name], stored)
  current = { ...current, [name]: value }
  applyToDocument(current)
  for (const listener of listeners) listener()
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useAppPrefs() {
  return useSyncExternalStore(subscribe, getPrefs, getPrefs)
}

// Ayarlar > Ses: dil ve hız her okumada güncel tercihten alınır.
export function speak(text, { onEnd } = {}) {
  if (!('speechSynthesis' in window)) return false
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text.replace(/[*_#`~]/g, ''))
  utterance.lang = current.voiceLang
  utterance.rate = current.voiceRate
  if (onEnd) {
    utterance.onend = onEnd
    utterance.onerror = onEnd
  }
  window.speechSynthesis.speak(utterance)
  return true
}

export function voicePreviewText(lang) {
  return lang === 'en-US'
    ? "Hi, I'm KocaMind. This is how I'll read my replies."
    : 'Merhaba, ben KocaMind. Yanıtlarımı böyle okuyacağım.'
}

// Ayarlar > Bildirimler: sekme arka plandayken biten yanıt tarayıcı bildirimiyle haber verilir.
export function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window
}

export async function enableReplyNotifications() {
  if (!notificationsSupported()) return 'unsupported'
  const permission = Notification.permission === 'default'
    ? await Notification.requestPermission()
    : Notification.permission
  setPref('notifyReplies', permission === 'granted')
  return permission
}

export function notifyReply(text) {
  if (!current.notifyReplies || !notificationsSupported() || Notification.permission !== 'granted') return
  if (document.visibilityState === 'visible') return
  const body = text.replace(/[*_#`~>]/g, '').replace(/\s+/g, ' ').trim()
  if (!body) return
  try {
    const notification = new Notification('KocaMind yanıtladı', { body: body.length > 140 ? `${body.slice(0, 138)}…` : body, icon: '/favicon.svg', tag: 'kocamind-reply' })
    notification.onclick = () => { window.focus(); notification.close() }
  } catch { /* bazı tarayıcılar yalnız service worker bildirimi gösterir */ }
}
