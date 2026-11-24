import { describe, expect, it } from 'vitest'
import { isQuotaExhausted, nextQuotaReset, parseDailyUsage, parseQuotaHeaders, quotaExhaustedText, quotaNotice, resetCountdown, usageLevel, usagePercent } from './usage'

describe('günlük kullanım', () => {
  it('limit yoksa sayı uydurulmaz', () => {
    expect(parseDailyUsage({ usage: { chat: 3 }, limits: {} })).toBeNull()
    expect(parseDailyUsage({ usage: {}, limits: { chat: 50 } })).toEqual({ used: 0, limit: 50 })
  })

  it('kullanım varsa en az %1, en çok %100', () => {
    expect(usagePercent({ used: 1, limit: 1000 })).toBe(1)
    expect(usagePercent({ used: 0, limit: 10 })).toBe(0)
    expect(usagePercent({ used: 70, limit: 50 })).toBe(100)
  })

  it('renk eşikleri Android ile aynı', () => {
    expect(usageLevel(69)).toBe('ok')
    expect(usageLevel(70)).toBe('warn')
    expect(usageLevel(90)).toBe('bad')
  })

  it('UTC gece yarısına kalan süre', () => {
    expect(resetCountdown(new Date('2026-10-24T21:00:00Z'))).toBe('03:00:00')
    expect(resetCountdown(new Date('2026-10-24T23:59:59Z'))).toBe('00:00:01')
  })
})

describe('sohbet içi sayaç', () => {
  it('kota başlıklarını okur, yoksa null döner', () => {
    expect(parseQuotaHeaders(new Headers({ 'X-Daily-Limit': '50', 'X-Daily-Remaining': '8' }))).toEqual({ remaining: 8, limit: 50 })
    expect(parseQuotaHeaders(new Headers())).toBeNull()
    expect(parseQuotaHeaders(undefined)).toBeNull()
  })

  it('kalan hak limitin %20sine inince uyarır', () => {
    expect(quotaNotice({ remaining: 10, limit: 50 })).toBe("Bugün 10 mesaj hakkın kaldı · 03:00'te yenilenir")
    expect(quotaNotice({ remaining: 11, limit: 50 })).toBeNull()
    expect(quotaNotice({ remaining: 0, limit: 50 })).toBeNull()
    expect(quotaNotice(null)).toBeNull()
  })

  it('hak bitince yenilenmeye kalan süreyi söyler', () => {
    expect(quotaExhaustedText(new Date('2026-11-03T23:00:00Z'))).toBe('Bugünkü mesaj hakkın bitti. 01:00:00 sonra yenilenir.')
  })
})

describe('kota yenilenmesi', () => {
  it('bitmiş kota bir sonraki UTC gece yarısına kadar geçerli, sonra uyarı kaybolur', () => {
    const now = new Date('2026-11-03T23:00:00Z')
    expect(nextQuotaReset(now)).toBe(Date.UTC(2026, 10, 4))
    const quota = { remaining: 0, limit: 50, resetAt: Date.UTC(2026, 10, 4) }
    expect(isQuotaExhausted(quota, now)).toBe(true)
    expect(isQuotaExhausted(quota, new Date('2026-11-04T00:00:01Z'))).toBe(false)
    expect(isQuotaExhausted({ remaining: 3, limit: 50 }, now)).toBe(false)
    expect(isQuotaExhausted(null, now)).toBe(false)
  })
})
