import { describe, expect, it } from 'vitest'
import { stripEphemeralMessages } from './messagePrivacy'

describe('stripEphemeralMessages', () => {
  it('Gmail gibi geçici sonuçları model ve kayıt geçmişinden çıkarır', () => {
    const messages = [
      { role: 'user', content: 'Maillerime bak' },
      { role: 'ai', content: 'Gizli Gmail sonucu', ephemeral: true },
      { role: 'user', content: 'Şimdi başka bir soru' },
    ]

    expect(stripEphemeralMessages(messages)).toEqual([
      { role: 'user', content: 'Maillerime bak' },
      { role: 'user', content: 'Şimdi başka bir soru' },
    ])
  })

  it('geçersiz girişte boş liste döndürür', () => {
    expect(stripEphemeralMessages(null)).toEqual([])
  })

  it('eski sürümden kalan Gmail sonuçlarını da temizler', () => {
    expect(stripEphemeralMessages([
      { role: 'ai', content: '📧 **Son 5 mail:**\n\n1. **Özel konu**' },
      { role: 'ai', content: 'Normal cevap' },
    ])).toEqual([{ role: 'ai', content: 'Normal cevap' }])
  })
})
