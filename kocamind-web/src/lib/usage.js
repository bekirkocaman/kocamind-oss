// Ayarlar > Kullanım (Android DailyUsage / UsageLogic): günlük sohbet limiti, yüzde ve yenilenme.

// `{usage:{chat}, limits:{chat}}`; limit yoksa null döner, sayı uydurulmaz.
export function parseDailyUsage(body) {
  const limit = Number(body?.limits?.chat)
  if (!Number.isFinite(limit) || limit <= 0) return null
  const used = Number(body?.usage?.chat) || 0
  return { used, limit }
}

// Kullanım varsa en az %1 gösterilir; "%0 kullanıldı" yanıltıcı olur.
export function usagePercent({ used, limit }) {
  const pct = Math.round(used * 100 / limit)
  return Math.min(100, Math.max(used > 0 ? 1 : 0, pct))
}

export function usageLevel(percent) {
  if (percent >= 90) return 'bad'
  if (percent >= 70) return 'warn'
  return 'ok'
}

// Sohbet yanıtındaki kota başlıkları (backend quota.js); limit yoksa (sınırsız tür) null.
export function parseQuotaHeaders(headers) {
  const rawRemaining = headers?.get?.('X-Daily-Remaining')
  const limit = Number(headers?.get?.('X-Daily-Limit'))
  const remaining = Number(rawRemaining)
  if (rawRemaining == null || !Number.isFinite(limit) || limit <= 0 || !Number.isFinite(remaining)) return null
  return { remaining, limit }
}

// Mesaj kutusunun üstündeki satır: yalnızca kalan hak limitin %20'sine inince; hak bittiyse ayrı durum.
export function quotaNotice(quota) {
  if (!quota || quota.remaining <= 0 || quota.remaining > Math.floor(quota.limit * 0.2)) return null
  return `Bugün ${quota.remaining} mesaj hakkın kaldı · 03:00'te yenilenir`
}

// Kota UTC gece yarısı yenilenir; bitmiş kota bu ana kadar geçerli.
export function nextQuotaReset(now = new Date()) {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
}

// Hak bitti mi; gece yarısı geçtiyse (resetAt) yenilenmiş sayılır.
export function isQuotaExhausted(quota, now = new Date()) {
  if (quota?.remaining !== 0) return false
  return quota.resetAt == null || now.getTime() < quota.resetAt
}

export function quotaExhaustedText(now = new Date()) {
  return `Bugünkü mesaj hakkın bitti. ${resetCountdown(now)} sonra yenilenir.`
}

// Kota UTC gece yarısı yenilenir (Türkiye saatiyle 03:00); kalan süre SS:DD:ss.
export function resetCountdown(now = new Date()) {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  const s = Math.max(0, Math.floor((next - now.getTime()) / 1000))
  const pad = n => String(n).padStart(2, '0')
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`
}
