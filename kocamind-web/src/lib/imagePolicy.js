const STORAGE_BUCKET = import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'kocamind.firebasestorage.app'
const BASE_ORIGIN = 'https://app.invalid'

export const ALLOWED_IMAGE_SOURCES = [
  { host: 'firebasestorage.googleapis.com', pathPrefix: `/v0/b/${STORAGE_BUCKET}/o/` },
]

const RASTER_DATA_URL = /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i

export function isAllowedImageSrc(src, sources = ALLOWED_IMAGE_SOURCES) {
  const value = String(src || '').trim()
  if (!value) return false
  if (RASTER_DATA_URL.test(value)) return true
  let url
  try { url = new URL(value, BASE_ORIGIN) } catch { return false }
  if (url.origin === BASE_ORIGIN) return !/^(?:\/|\\){2}/.test(value)
  if (url.protocol !== 'https:') return false
  return sources.some(source => url.hostname === source.host && url.pathname.startsWith(source.pathPrefix))
}

// Engellenen resim için tıklanabilir bağlantı adresi; http(s) değilse null.
export function blockedImageHref(src) {
  const value = String(src || '').trim()
  if (!value) return null
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}
