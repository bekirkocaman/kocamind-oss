// Sunucu tarafı bağlantılar (Google Takvim, Drive, Notion, GitHub).
// Tokenlar hiçbir zaman tarayıcıya gelmez; burada yalnızca durum ve OAuth yönlendirmesi var.
import { API, authFetch } from './api'

const LABELS = {
  google_calendar: 'Google Takvim',
  google_drive: 'Google Drive',
  notion: 'Notion',
  github: 'GitHub',
}

const ERROR_MESSAGES = {
  denied: 'Bağlantı izni verilmedi.',
  invalid_state: 'Bağlantı isteğinin süresi doldu, tekrar dene.',
  unavailable: 'Bu bağlantı şu anda kullanılamıyor.',
}

async function readJson(response) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error || `Sunucu hatası (${response.status})`)
    error.code = data.code
    throw error
  }
  return data
}

export async function listConnectors() {
  return readJson(await authFetch(API.connectors))
}

// Tarayıcıyı servisin izin ekranına götürür.
export async function startConnector(id) {
  const { authUrl } = await readJson(await authFetch(API.connectorConnect(id), { method: 'POST' }))
  if (!authUrl || !/^https:\/\//.test(authUrl)) throw new Error('Bağlantı adresi alınamadı.')
  window.location.assign(authUrl)
}

export async function disconnectConnector(id) {
  return readJson(await authFetch(API.connector(id), { method: 'DELETE' }))
}

// OAuth dönüşündeki ?baglanti=...&durum=... parametrelerini kullanıcı mesajına çevirir.
export function connectorReturnMessage(params) {
  const status = params.get('durum')
  if (status !== 'ok' && status !== 'hata') return null
  if (status === 'ok') {
    const label = LABELS[params.get('baglanti')] || 'Hesap'
    return { type: 'success', text: `${label} bağlandı.` }
  }
  return { type: 'error', text: ERROR_MESSAGES[params.get('neden')] || 'Bağlantı kurulamadı, biraz sonra tekrar dene.' }
}

// Bir bağlantı satırında hangi düğmenin görüneceği.
export function connectorButtonState(serverEntry, catalog) {
  if (!serverEntry) return { kind: 'loading' }
  if (serverEntry.connected) return { kind: serverEntry.status === 'reauth' ? 'reauth' : 'connected' }
  if (!catalog?.enabled || !serverEntry.available) return { kind: 'soon' }
  if (!catalog.allowed) return { kind: 'plus' }
  return { kind: 'connect' }
}
