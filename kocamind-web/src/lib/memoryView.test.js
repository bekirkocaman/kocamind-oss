import { describe, expect, it } from 'vitest'
import { groupMemories, importSummary, insightBasis, MEMORY_IMPORT_PROMPT, undoableMemoryKeys } from './memoryView'

describe('groupMemories', () => {
  it('Android ile aynı sırada gruplar; bilinmeyen kategori Diğer olur', () => {
    const groups = groupMemories([
      { key: 'proje', value: 'KocaMind', category: 'proje' },
      { key: 'ad', value: 'Bekir', category: 'kisisel' },
      { key: 'x', value: 'y', category: 'uydurma' },
      { key: 'z', value: 'w' },
    ])
    expect(groups.map(g => g.label)).toEqual(['Kişisel', 'Projeler', 'Diğer'])
    expect(groups[2].items).toHaveLength(2)
  })
})

describe('importSummary', () => {
  it('kaynak, sayı ve sınır notu', () => {
    expect(importSummary({ saved: 3, skippedForLimit: 0, from: 'ChatGPT' })).toBe("ChatGPT'den 3 bilgi hafızana eklendi.")
    expect(importSummary({ saved: 0, skippedForLimit: 2 })).toBe('Yeni bir bilgi bulunamadı. 2 bilgi 100 kayıt sınırı nedeniyle eklenmedi.')
  })
})

describe('insightBasis', () => {
  it('sohbet ve bilgi sayısı', () => {
    expect(insightBasis(12, 4)).toBe('12 sohbete ve 4 bilgiye dayanır · başka uygulamalardan taşınanlar dahil değil')
    expect(insightBasis(0, 0)).toBe('Sohbetlerine dayanır · başka uygulamalardan taşınanlar dahil değil')
  })

  it('istem Android ile aynı sonla biter', () => {
    expect(MEMORY_IMPORT_PROMPT.trim().endsWith('Bu, yanıtındaki en son metin olmalıdır.')).toBe(true)
  })
})

describe('hafıza geri alma', () => {
  it('yalnızca yeni eklenen kayıtlar geri alınabilir', () => {
    expect(undoableMemoryKeys([{ key: 'isim', isNew: true }, { key: 'şehir', isNew: false }])).toEqual(['isim'])
    expect(undoableMemoryKeys([{ key: 'şehir', isNew: false }])).toEqual([])
    expect(undoableMemoryKeys(undefined)).toEqual([])
  })
})
