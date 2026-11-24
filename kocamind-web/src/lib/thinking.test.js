import { describe, expect, it } from 'vitest'
import { reasoningChunk, thoughtForLabel } from './thinking'

describe('thoughtForLabel', () => {
  it('saniyeye yuvarlar, en az 1 saniye', () => {
    expect(thoughtForLabel(4400)).toBe('4 saniye düşündü')
    expect(thoughtForLabel(120)).toBe('1 saniye düşündü')
    expect(thoughtForLabel(undefined)).toBe('1 saniye düşündü')
  })
})

describe('reasoningChunk', () => {
  it('yalnız reasoning_content alanını okur', () => {
    expect(reasoningChunk({ choices: [{ delta: { reasoning_content: 'Önce' } }] })).toBe('Önce')
    expect(reasoningChunk({ choices: [{ delta: { content: 'Merhaba' } }] })).toBe('')
    expect(reasoningChunk(null)).toBe('')
  })
})
