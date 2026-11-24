const STATE_RE = /^[A-Za-z0-9_-]{32,200}$/
const PORT_RE = /^[0-9]+$/

function isValidPort(port) {
  return Number.isInteger(port) && port >= 1024 && port <= 65535
}

export function parseIdeLoginParams(search) {
  if (typeof search !== 'string' || !search) return null
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`)
  const state = params.get('ide_giris')
  const portRaw = params.get('port')
  if (!state || !portRaw) return null
  if (!STATE_RE.test(state)) return null
  if (!PORT_RE.test(portRaw)) return null
  const port = Number(portRaw)
  if (!isValidPort(port) || String(port) !== portRaw) return null
  return { state, port }
}

export function buildCallbackUrl({ port, code, state }) {
  const numPort = typeof port === 'number' ? port : Number(port)
  if (!isValidPort(numPort)) {
    throw new Error('Geçersiz geri dönüş portu.')
  }
  if (typeof code !== 'string' || !code || typeof state !== 'string' || !STATE_RE.test(state)) {
    throw new Error('Geçersiz geri dönüş parametreleri.')
  }
  const query = new URLSearchParams({ code, state })
  return `http://127.0.0.1:${numPort}/callback?${query.toString()}`
}

export async function requestIdeCode({ state, authFetch, apiBase }) {
  if (typeof state !== 'string' || !STATE_RE.test(state)) {
    throw new Error('Geçersiz istek.')
  }
  const base = String(apiBase || '').replace(/\/+$/, '')
  const res = await authFetch(`${base}/ide/auth/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || typeof data?.code !== 'string' || !data.code) {
    throw new Error(data?.error?.message || data?.error || 'Bağlanamadı, tekrar dene.')
  }
  return { code: data.code }
}

const IDE_LOGIN_STORAGE_KEY = 'kocamind_ide_login'
const IDE_LOGIN_TTL_MS = 10 * 60 * 1000

function getDefaultStorage() {
  return typeof sessionStorage !== 'undefined' ? sessionStorage : null
}

function validateParams(params) {
  if (!params || typeof params !== 'object') return null
  if (typeof params.state !== 'string') return null
  const portStr =
    typeof params.port === 'number' || typeof params.port === 'string'
      ? String(params.port)
      : ''
  return parseIdeLoginParams(
    `?ide_giris=${encodeURIComponent(params.state)}&port=${encodeURIComponent(portStr)}`
  )
}

export function saveIdeLoginParams(params, storage = getDefaultStorage(), now = Date.now) {
  try {
    if (!storage) return
    const valid = validateParams(params)
    if (!valid) return
    storage.setItem(
      IDE_LOGIN_STORAGE_KEY,
      JSON.stringify({ state: valid.state, port: valid.port, savedAt: now() })
    )
  } catch {
    // Oturum depolamasına yazılamasa da giriş akışını kesme.
  }
}

export function loadIdeLoginParams(storage = getDefaultStorage(), now = Date.now) {
  try {
    if (!storage) return null
    const raw = storage.getItem(IDE_LOGIN_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.savedAt !== 'number' ||
      !Number.isFinite(parsed.savedAt) ||
      now() - parsed.savedAt > IDE_LOGIN_TTL_MS
    ) {
      storage.removeItem(IDE_LOGIN_STORAGE_KEY)
      return null
    }
    const valid = validateParams(parsed)
    if (!valid) {
      storage.removeItem(IDE_LOGIN_STORAGE_KEY)
      return null
    }
    return valid
  } catch {
    try {
      storage?.removeItem(IDE_LOGIN_STORAGE_KEY)
    } catch {
      // Kayıt silinemese de geçersiz kaydı kullanmadan null dön.
    }
    return null
  }
}

export function clearIdeLoginParams(storage = getDefaultStorage()) {
  try {
    storage?.removeItem(IDE_LOGIN_STORAGE_KEY)
  } catch {
    // Oturum kaydı silinemese de çağıranın akışını kesme.
  }
}
