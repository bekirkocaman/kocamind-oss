import { describe, expect, it } from 'vitest'
import { HONESTY_RULE, KISILIK_KURALLARI, WEB_SEARCH_RULES } from './prompts'

describe('dürüstlük kuralı', () => {
  it('emin olmadığında söylemesini ister', () => {
    expect(HONESTY_RULE).toBe('Bilmediğin ya da emin olmadığın bir konuda bunu açıkça söyle ("Emin değilim" de), tahmini tahmin olarak belirt; kaynak, rakam, tarih veya alıntı uydurma.')
    expect(KISILIK_KURALLARI).toContain(HONESTY_RULE)
  })

  it('belirsizliği yasaklayan eski satırlar kalmadı', () => {
    expect(WEB_SEARCH_RULES).not.toContain('Direkt ve kendinden emin cevap ver')
    expect(WEB_SEARCH_RULES).not.toContain('"sanırım" gibi belirsiz ifadeler kullanma')
  })
})
