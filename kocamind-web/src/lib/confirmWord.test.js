import { describe, expect, it } from 'vitest'
import { confirmWordMatches } from './confirmWord'

describe('confirmWordMatches', () => {
  it('Türkçe büyük harfe çevirip karşılaştırır', () => {
    expect(confirmWordMatches(' sil ', 'SİL')).toBe(true)
    expect(confirmWordMatches('SIL', 'SİL')).toBe(false)
    expect(confirmWordMatches('hesabımı sil', 'HESABIMI SİL')).toBe(true)
  })
})
