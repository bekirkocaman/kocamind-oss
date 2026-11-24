import { describe, it, expect } from 'vitest'
import { buildFeedbackPayload, REASONS, validateBugText } from './feedbackPayload'

describe('REASONS', () => {
  it('7 beklenen sebebi doğru id ve etiketlerle içerir', () => {
    expect(REASONS.map(r => r.id)).toEqual([
      'wrong',
      'incomplete',
      'cut_off',
      'language',
      'unsafe',
      'slow',
      'other',
    ])
  })
})

describe('buildFeedbackPayload', () => {
  const baseInput = {
    chatId: 'chat-123',
    msgIdx: 3,
    answer: {
      role: 'ai',
      content: 'Cevap metni',
      answeredBy: { provider: 'anthropic', model: 'claude-sonnet' },
    },
    question: { role: 'user', content: 'Soru metni' },
    selectedModel: { provider: 'openai', id: 'gpt-4o' },
    assistantType: 'tiger',
  }

  it('up oyunda reason ve note eklemez', () => {
    const payload = buildFeedbackPayload({
      ...baseInput,
      type: 'up',
      reason: 'wrong',
      note: 'Hatalı bilgi',
    })

    expect(payload).toEqual({
      type: 'up',
      chatId: 'chat-123',
      messageId: '3',
      provider: 'anthropic',
      model: 'claude-sonnet',
      assistantType: 'tiger',
      question: 'Soru metni',
      answer: 'Cevap metni',
      context: { platform: 'web' },
    })
    expect('reason' in payload).toBe(false)
    expect('note' in payload).toBe(false)
  })

  it('geri almada (type: null) reason ve note eklemez', () => {
    const payload = buildFeedbackPayload({
      ...baseInput,
      type: null,
      reason: 'slow',
      note: 'Çok yavaştı',
    })

    expect(payload.type).toBeNull()
    expect('reason' in payload).toBe(false)
    expect('note' in payload).toBe(false)
  })

  it('down oyunda geçerli reason ve kırpılmış note ekler', () => {
    const longNote = 'a'.repeat(600)
    const payload = buildFeedbackPayload({
      ...baseInput,
      type: 'down',
      reason: 'incomplete',
      note: `  ${longNote}  `,
    })

    expect(payload.type).toBe('down')
    expect(payload.reason).toBe('incomplete')
    expect(payload.note).toBe('a'.repeat(500))
  })

  it('down oyunda geçersiz reason ve boş note alanlarını eklemez', () => {
    const payload = buildFeedbackPayload({
      ...baseInput,
      type: 'down',
      reason: 'uydurma',
      note: '   ',
    })

    expect('reason' in payload).toBe(false)
    expect('note' in payload).toBe(false)
  })

  it('olmayan context alanlarını eklemez', () => {
    const payload = buildFeedbackPayload({
      ...baseInput,
      type: 'down',
      answer: { role: 'ai', content: 'Sadece metin', agentSteps: [] },
    })

    expect(payload.context).toEqual({ platform: 'web' })
    expect(Object.keys(payload.context)).toEqual(['platform'])
  })

  it('mesajda gerçekten bulunan context alanlarını ve appVersion değerini ekler', () => {
    const payload = buildFeedbackPayload({
      ...baseInput,
      type: 'down',
      appVersion: '1.2.3',
      answer: {
        role: 'ai',
        content: 'Araçlı ve düşünceli yanıt',
        thinking: 'Önce analiz ettim...',
        thinkingMs: 1200,
        latencyMs: 2450,
        finishReason: 'stop',
        agentSteps: [
          { name: 'web_search', status: 'done' },
          { name: 'web_search', status: 'done' },
          { name: 'save_memory', status: 'done' },
        ],
      },
    })

    expect(payload.context).toEqual({
      platform: 'web',
      appVersion: '1.2.3',
      finishReason: 'stop',
      latencyMs: 2450,
      deepThink: true,
      tools: ['web_search', 'save_memory'],
    })
  })

  it('answeredBy yoksa selectedModel ve temp chatId değerine düşer', () => {
    const payload = buildFeedbackPayload({
      type: 'down',
      chatId: null,
      msgIdx: 1,
      answer: { role: 'ai', content: 'Merhaba' },
      question: null,
      selectedModel: { provider: 'openai', id: 'gpt-4o' },
      assistantType: 'tiger',
    })

    expect(payload.chatId).toBe('temp')
    expect(payload.provider).toBe('openai')
    expect(payload.model).toBe('gpt-4o')
    expect(payload.question).toBe('')
  })
})

describe('validateBugText', () => {
  it('boş veya 10 karakterden kısa metni reddeder', () => {
    expect(validateBugText('').ok).toBe(false)
    expect(validateBugText('   ').ok).toBe(false)
    expect(validateBugText(null).ok).toBe(false)
    expect(validateBugText('123456789').ok).toBe(false)
    expect(validateBugText('   123456789   ').ok).toBe(false)
  })

  it('10 ve 4000 sınırlarında geçerli döner', () => {
    expect(validateBugText('1234567890')).toEqual({ ok: true, error: null })
    expect(validateBugText(`  ${'a'.repeat(10)}  `)).toEqual({ ok: true, error: null })
    expect(validateBugText('a'.repeat(4000))).toEqual({ ok: true, error: null })
    expect(validateBugText(`  ${'a'.repeat(4000)}  `)).toEqual({ ok: true, error: null })
  })

  it('4000 karakterden uzun metni reddeder', () => {
    const res = validateBugText('a'.repeat(4001))
    expect(res.ok).toBe(false)
    expect(typeof res.error).toBe('string')
  })
})
