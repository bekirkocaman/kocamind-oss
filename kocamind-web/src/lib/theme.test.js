import { describe, expect, it } from 'vitest'
import { resolveTheme, themeLabel } from './theme'

describe('resolveTheme', () => {
  it('açık ve koyu olduğu gibi kalır', () => {
    expect(resolveTheme('light', false)).toBe('light')
    expect(resolveTheme('dark', true)).toBe('dark')
  })

  it('sistem modu işletim sistemi tercihini izler', () => {
    expect(resolveTheme('system', true)).toBe('light')
    expect(resolveTheme('system', false)).toBe('dark')
  })

  it('bilinmeyen kayıt koyu temaya düşer', () => {
    expect(resolveTheme('mor', true)).toBe('dark')
    expect(themeLabel('system')).toBe('Sistem')
  })
})
