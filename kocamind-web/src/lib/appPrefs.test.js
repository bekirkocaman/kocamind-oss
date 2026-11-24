import { describe, expect, it } from 'vitest'
import { parsePrefs, voicePreviewText } from './appPrefs'

const from = values => key => values[key] ?? null

describe('parsePrefs', () => {
  it('kayıt yoksa Android ile aynı varsayılanlar', () => {
    expect(parsePrefs(from({}))).toEqual({
      replyFont: 'sans',
      reduceMotion: false,
      voiceLang: 'tr-TR',
      voiceRate: 0.9,
      notifyReplies: false,
    })
  })

  it('kayıtlı tercihleri okur', () => {
    expect(parsePrefs(from({
      kocamind_reply_font: 'serif',
      kocamind_reduce_motion: '1',
      kocamind_voice_lang: 'en-US',
      kocamind_voice_rate: '1.3',
      kocamind_notify_replies: '1',
    }))).toEqual({
      replyFont: 'serif',
      reduceMotion: true,
      voiceLang: 'en-US',
      voiceRate: 1.3,
      notifyReplies: true,
    })
  })

  it('bilinmeyen değerler varsayılana düşer', () => {
    const prefs = parsePrefs(from({ kocamind_voice_lang: 'de-DE', kocamind_voice_rate: '7', kocamind_reply_font: 'mono' }))
    expect(prefs.voiceLang).toBe('tr-TR')
    expect(prefs.voiceRate).toBe(0.9)
    expect(prefs.replyFont).toBe('sans')
  })
})

describe('voicePreviewText', () => {
  it('dile göre örnek cümle', () => {
    expect(voicePreviewText('tr-TR')).toMatch(/^Merhaba/)
    expect(voicePreviewText('en-US')).toMatch(/^Hi/)
  })
})
