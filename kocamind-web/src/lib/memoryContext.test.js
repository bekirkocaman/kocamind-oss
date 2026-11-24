import { describe, expect, it } from 'vitest'
import { contextBudgetChars, formatMemoriesForPrompt, planConversationContext, selectRelevantMemories, toSummaryMessages } from './memoryContext'

const msg = (role, size, extra = {}) => ({ role, content: 'x'.repeat(size), ...extra })

describe('selectRelevantMemories', () => {
  it('az sayıda hafızanın hepsini döndürür', () => {
    const memories = [{ key: 'isim', value: 'Bekir' }]
    expect(selectRelevantMemories(memories, 'selam')).toEqual(memories)
  })

  it('çok hafıza varsa konuyla ilgili ve çekirdek olanları seçer', () => {
    const memories = [
      ...Array.from({ length: 30 }, (_, i) => ({ key: `not ${i}`, value: `rastgele ${i}`, category: 'genel' })),
      { key: 'alerji', value: 'Fıstık alerjisi var', category: 'saglik' },
      { key: 'araba', value: 'Kırmızı bir Toyota kullanıyor', category: 'genel' },
    ]
    const selected = selectRelevantMemories(memories, 'Toyota arabam için bakım önerisi', 5)
    expect(selected).toHaveLength(5)
    expect(selected[0].key).toBe('araba')
    expect(selected.map(m => m.key)).toContain('alerji')
  })

  it('hafıza yoksa istem metni boş kalır', () => {
    expect(formatMemoriesForPrompt([])).toBe('')
    expect(formatMemoriesForPrompt([{ key: 'isim', value: 'Bekir' }])).toContain('- isim: Bekir')
  })
})

describe('planConversationContext', () => {
  it('kısa sohbette özet istemez ve tüm geçmişi gönderir', () => {
    const history = [msg('user', 100), msg('ai', 100)]
    const plan = planConversationContext(history)
    expect(plan.needsSummary).toBe(false)
    expect(plan.recent).toEqual(history)
    expect(plan.summary).toBe('')
  })

  it('uzun sohbette eski kısmı özetlenecek olarak ayırır', () => {
    const history = Array.from({ length: 20 }, (_, i) => msg(i % 2 ? 'ai' : 'user', 2000))
    const plan = planConversationContext(history, contextBudgetChars('groq'))
    expect(plan.needsSummary).toBe(true)
    expect(plan.recent).toHaveLength(6)
    expect(plan.toSummarize).toHaveLength(14)
    expect(plan.newSummaryIndex).toBe(13)
  })

  it('geniş bağlamlı modelde son 120 bin karakteri aynen tutar', () => {
    const history = Array.from({ length: 80 }, (_, i) => msg(i % 2 ? 'ai' : 'user', 2000))
    const plan = planConversationContext(history, contextBudgetChars('deepseek'))
    expect(plan.needsSummary).toBe(true)
    expect(plan.recent).toHaveLength(60)
    expect(plan.toSummarize).toHaveLength(20)
    expect(contextBudgetChars('local')).toBe(12000)
    expect(contextBudgetChars(undefined)).toBe(120000)
  })

  it('mevcut özetten sonrasını kullanır', () => {
    const history = [
      msg('user', 3000), msg('ai', 3000, { contextSummary: '- önceki özet' }),
      msg('user', 100), msg('ai', 100),
    ]
    const plan = planConversationContext(history)
    expect(plan.summary).toBe('- önceki özet')
    expect(plan.needsSummary).toBe(false)
    expect(plan.recent).toEqual(history.slice(2))
  })

  it('özet mesajları rolü normalleştirir ve kırpar', () => {
    const [first] = toSummaryMessages([{ role: 'assistant', content: 'y'.repeat(9000) }])
    expect(first.role).toBe('ai')
    expect(first.content).toHaveLength(6000)
  })
})
