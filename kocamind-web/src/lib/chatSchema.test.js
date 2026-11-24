import { describe, expect, it } from 'vitest'
import { fromCloudChat, normalizeMessages, toCloudChat, toMillis } from './chatSchema'

describe('toMillis', () => {
  it('sayı, rakam metni, ISO metni ve Timestamp kabul eder', () => {
    expect(toMillis(1700000000000)).toBe(1700000000000)
    expect(toMillis('1700000000000')).toBe(1700000000000)
    expect(toMillis('2026-01-01T00:00:00.000Z')).toBe(Date.UTC(2026, 0, 1))
    expect(toMillis({ toMillis: () => 42 })).toBe(42)
  })

  it('çözülemeyen değerde 0 döner; kısa rakamları tarih sanmaz', () => {
    expect(toMillis('abc')).toBe(0)
    expect(toMillis(undefined)).toBe(0)
    expect(toMillis(Number.NaN)).toBe(0)
    expect(toMillis('12')).toBe(12)
  })
})

describe('normalizeMessages', () => {
  it('eksik kimlik ve zamanı doldurur, rolü user/ai yapar, ek alanları korur', () => {
    const out = normalizeMessages([
      { role: 'user', content: 'selam', imageUrl: 'data:x' },
      { role: 'assistant', content: 'merhaba' },
    ], [], 1000)
    expect(out).toEqual([
      { id: '1000-0', role: 'user', content: 'selam', timestamp: 1000, imageUrl: 'data:x' },
      { id: '1000-1', role: 'ai', content: 'merhaba', timestamp: 1000 },
    ])
  })

  it('aynı mesaj tekrar kaydedilince önceki kimlik ve zamanı korur', () => {
    const first = normalizeMessages([{ role: 'user', content: 'selam' }], [], 1000)
    const again = normalizeMessages([{ role: 'user', content: 'selam' }, { role: 'ai', content: 'cevap' }], first, 5000)
    expect(again[0]).toMatchObject({ id: '1000-0', timestamp: 1000 })
    expect(again[1]).toMatchObject({ id: '5000-1', timestamp: 5000 })
  })

  it('içerik değişmişse eski kimliği almaz', () => {
    const first = normalizeMessages([{ role: 'user', content: 'eski' }], [], 1000)
    const edited = normalizeMessages([{ role: 'user', content: 'yeni' }], first, 2000)
    expect(edited[0]).toMatchObject({ id: '2000-0', timestamp: 2000 })
  })

  it('kimliği ve zamanı olan mesaja dokunmaz', () => {
    const msg = { id: '17', role: 'user', content: 'x', timestamp: 17 }
    expect(normalizeMessages([msg], [], 9999)).toEqual([msg])
  })
})

describe('toCloudChat / fromCloudChat', () => {
  it('Android ile aynı alanları yazar', () => {
    const doc = toCloudChat({ id: '1700', title: '', messages: [{ role: 'user', content: 'a' }], pinned: 1, updatedAt: 1800 })
    expect(doc).toEqual({
      title: 'Yeni sohbet',
      messages: [{ id: '1700-0', role: 'user', content: 'a', timestamp: 1700 }],
      pinned: true,
      archived: false,
      createdAt: 1700,
      updatedAt: 1800,
    })
  })

  it('Android belgesini okur; chat_ önekli kimlikten zaman çıkarır, ISO zamanları sayıya çevirir', () => {
    const chat = fromCloudChat('chat_1700', {
      title: 'Mobil',
      messages: [{ role: 'user', content: 'soru' }, { id: '5', role: 'ai', content: 'cevap', timestamp: 5 }],
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(chat.createdAt).toBe(1700)
    expect(chat.updatedAt).toBe(Date.UTC(2026, 0, 1))
    expect(chat.messages[0]).toEqual({ id: '1700-0', role: 'user', content: 'soru', timestamp: 1700 })
    expect(chat.messages[1]).toEqual({ id: '5', role: 'ai', content: 'cevap', timestamp: 5 })
  })
})
