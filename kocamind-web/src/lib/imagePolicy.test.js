import { describe, expect, it } from 'vitest'
import { isAllowedImageSrc, blockedImageHref } from './imagePolicy'

describe('yanıttaki resim izin listesi', () => {
  it('kendi depolama alanındaki ve satır içi raster resimlere izin verir', () => {
    expect(isAllowedImageSrc('https://firebasestorage.googleapis.com/v0/b/kocamind.firebasestorage.app/o/generated-images%2Fa.png?alt=media&token=t')).toBe(true)
    expect(isAllowedImageSrc('data:image/png;base64,iVBORw0KGgo=')).toBe(true)
    expect(isAllowedImageSrc('/favicon.svg')).toBe(true)
  })

  it('dış adresleri engeller, protokolsüz ve ters eğik çizgili biçimler dahil', () => {
    expect(isAllowedImageSrc('https://example.com/logo.png?veri=X')).toBe(false)
    expect(isAllowedImageSrc('http://example.com/logo.png')).toBe(false)
    expect(isAllowedImageSrc('//example.com/logo.png?veri=X')).toBe(false)
    expect(isAllowedImageSrc('/\\example.com/logo.png')).toBe(false)
    expect(isAllowedImageSrc('\\\\example.com/logo.png')).toBe(false)
    expect(isAllowedImageSrc('https://firebasestorage.googleapis.com/v0/b/saldirgan-kova/o/x?alt=media')).toBe(false)
    expect(isAllowedImageSrc('https://firebasestorage.googleapis.com.example.com/v0/b/kocamind.firebasestorage.app/o/x')).toBe(false)
    expect(isAllowedImageSrc('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false)
    expect(isAllowedImageSrc('javascript:alert(1)')).toBe(false)
    expect(isAllowedImageSrc('')).toBe(false)
  })

  it('engellenen resim için yalnızca http(s) bağlantı üretir', () => {
    expect(blockedImageHref('//example.com/a.png?x=1')).toBe('https://example.com/a.png?x=1')
    expect(blockedImageHref('https://example.com/a.png')).toBe('https://example.com/a.png')
    expect(blockedImageHref('javascript:alert(1)')).toBe(null)
    expect(blockedImageHref('')).toBe(null)
  })
})
