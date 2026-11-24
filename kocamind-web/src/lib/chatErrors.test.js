import { describe, expect, it } from 'vitest'
import { applyErrorReply, errorReplyText, isErrorReply } from './chatErrors'
import { chatTitle } from './chatStorage'

describe('hata yanıtı', () => {
  it('kullanıcı mesajı yerinde kalır, hata asistan yanıtı olarak eklenir', () => {
    const history = [{ role: 'user', content: 'merhaba' }]
    const result = applyErrorReply(history, history.length, new Error('Hata: Yapay zekâ servisine şu anda ulaşılamıyor.'))
    expect(result[0]).toEqual({ role: 'user', content: 'merhaba' })
    expect(result).toHaveLength(2)
    expect(result[1]).toMatchObject({ role: 'ai', error: true, content: 'Üzgünüm, bir hata oluştu: Yapay zekâ servisine şu anda ulaşılamıyor.' })
  })

  it('bu istek için açılmış yanıt satırı varsa onu değiştirir', () => {
    const messages = [{ role: 'user', content: 'a' }, { role: 'ai', content: '', agentSteps: [] }]
    const result = applyErrorReply(messages, 1, new Error('Agent başlatılamadı.'))
    expect(result).toHaveLength(2)
    expect(result[0].content).toBe('a')
    expect(result[1].content).toBe('Üzgünüm, bir hata oluştu: Agent başlatılamadı.')
  })

  it('önceki sohbetin son asistan yanıtını ezmez', () => {
    const messages = [{ role: 'user', content: 'a' }, { role: 'ai', content: 'cevap' }, { role: 'user', content: 'b' }]
    const result = applyErrorReply(messages, 3, new Error('x'))
    expect(result[1].content).toBe('cevap')
    expect(result[2].content).toBe('b')
    expect(result).toHaveLength(4)
  })

  it('çift önek tek olur', () => {
    expect(errorReplyText(new Error('Hata: Hata: boom'))).toBe('Üzgünüm, bir hata oluştu: boom')
  })

  it('sohbet başlığı hata yanıtından değil kullanıcının ilk mesajından üretilir', () => {
    const messages = [{ role: 'user', content: 'Merhaba nasılsın' }, { role: 'ai', content: 'Üzgünüm, bir hata oluştu: x', error: true }]
    expect(isErrorReply(messages[1])).toBe(true)
    expect(chatTitle(messages)).toBe('Merhaba nasılsın')
    expect(chatTitle([messages[0], { role: 'ai', content: 'Üzgünüm, bir hata oluştu: eski kayıt' }])).toBe('Merhaba nasılsın')
    expect(chatTitle([...messages, { role: 'ai', content: 'Selam!' }])).toBe('Selam')
  })
})
