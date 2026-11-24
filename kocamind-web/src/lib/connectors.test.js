import { describe, expect, it } from 'vitest'
import { connectorReturnMessage, connectorButtonState } from './connectors'

describe('connectorReturnMessage', () => {
  it('başarılı dönüşte servis adıyla mesaj verir', () => {
    expect(connectorReturnMessage(new URLSearchParams('baglanti=google_calendar&durum=ok'))).toEqual({
      type: 'success',
      text: 'Google Takvim bağlandı.',
    })
  })

  it('hata nedenlerini anlaşılır mesaja çevirir', () => {
    expect(connectorReturnMessage(new URLSearchParams('durum=hata&neden=denied')).text).toMatch(/izni verilmedi/)
    expect(connectorReturnMessage(new URLSearchParams('durum=hata&neden=invalid_state')).text).toMatch(/süresi doldu/)
    expect(connectorReturnMessage(new URLSearchParams('durum=hata&neden=bilinmeyen')).type).toBe('error')
  })

  it('bağlantı dönüşü değilse null döner', () => {
    expect(connectorReturnMessage(new URLSearchParams('billing=success'))).toBeNull()
  })
})

describe('connectorButtonState', () => {
  const base = { enabled: true, allowed: true }
  it('duruma göre doğru düğmeyi seçer', () => {
    expect(connectorButtonState(null, base).kind).toBe('loading')
    expect(connectorButtonState({ available: false }, base).kind).toBe('soon')
    expect(connectorButtonState({ available: true, connected: false }, { ...base, allowed: false }).kind).toBe('plus')
    expect(connectorButtonState({ available: true, connected: false }, base).kind).toBe('connect')
    expect(connectorButtonState({ available: true, connected: true, status: 'active' }, base).kind).toBe('connected')
    expect(connectorButtonState({ available: true, connected: true, status: 'reauth' }, base).kind).toBe('reauth')
  })

  it('bağlıyken Plus bitse de bağlantıyı kesmeye izin verir', () => {
    expect(connectorButtonState({ available: true, connected: true, status: 'active' }, { ...base, allowed: false }).kind).toBe('connected')
  })
})
