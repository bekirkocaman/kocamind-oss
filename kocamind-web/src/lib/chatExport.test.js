import { describe, expect, it } from 'vitest'
import { buildExport, exportFileName, exportMessageCount, markdownToText } from './chatExport'

const chat = {
  title: 'Tatil planı',
  messages: [
    { role: 'user', content: 'Antalya için öneri?' },
    { role: 'ai', content: '## Yerler\n\n- **Kaleiçi**\n- `Düden`' },
    { role: 'ai', content: '   ' },
  ],
}
const now = new Date('2026-10-24T09:30:00Z')

describe('buildExport', () => {
  it('Markdown: başlık, özet satırı, Sen/KocaMind etiketleri; boş mesaj yazılmaz', () => {
    const md = buildExport('markdown', [chat], now)
    expect(md.startsWith('# Tatil planı\n\n_KocaMind · ')).toBe(true)
    expect(md).toContain('2 mesaj_')
    expect(md).toContain('**Sen:** Antalya için öneri?')
    expect(md).toContain('**KocaMind:**\n\n## Yerler')
  })

  it('birden çok sohbette her sohbet kendi başlığıyla ayrılır', () => {
    const md = buildExport('markdown', [chat, { ...chat, title: 'İkinci' }], now)
    expect(md.startsWith('# 2 sohbet')).toBe(true)
    expect(md).toContain('## İkinci')
    expect(md).toContain('\n\n---\n\n')
  })

  it('düz metinde Markdown işaretleri temizlenir', () => {
    const text = buildExport('text', [chat], now)
    expect(text).toContain('KocaMind:\nYERLER\n\n• Kaleiçi\n• Düden')
    expect(text).not.toContain('**')
  })
})

describe('yardımcılar', () => {
  it('mesaj sayısı ve dosya adı', () => {
    expect(exportMessageCount([chat])).toBe(2)
    expect(exportFileName('md', 1, now)).toBe('kocamind-sohbet-2026-10-24.md')
    expect(exportFileName('txt', 3, now)).toBe('kocamind-sohbetler-2026-10-24.txt')
  })

  it('kod bloğu girintili kalır', () => {
    expect(markdownToText('```js\nconst a = 1\n```')).toBe('    const a = 1')
  })
})
