import { describe, expect, it } from 'vitest'
import { SUGGESTIONS } from './suggestions'

describe('boş ekran önerileri', () => {
  it('dört Türkiye işi sırayla, fotoğraf isteyenler işaretli', () => {
    expect(SUGGESTIONS.map(s => s.id)).toEqual(['dilekce', 'resmi-eposta', 'fatura', 'soru'])
    expect(SUGGESTIONS.filter(s => s.needsImage).map(s => s.id)).toEqual(['fatura', 'soru'])
    expect(SUGGESTIONS[0]).toEqual({ id: 'dilekce', label: 'Dilekçe yaz', prompt: 'Bir dilekçe yazmama yardım et. Konu: ', needsImage: false })
  })
})
