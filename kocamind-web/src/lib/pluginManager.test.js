import { describe, expect, it } from 'vitest'
import { BUILT_IN_PLUGINS, getAvailablePluginTools, isPluginAvailable, readGmailInbox } from './pluginManager'

const plugin = id => BUILT_IN_PLUGINS.find(item => item.id === id)

describe('agent araç kullanılabilirliği', () => {
  it('sunucu durumu yüklenmeden yapılandırma isteyen araçları gizler', () => {
    expect(isPluginAvailable(plugin('gmail'), null)).toBe(false)
    expect(isPluginAvailable(plugin('calculator'), null)).toBe(true)
  })

  it('yalnızca sunucunun hazır bildirdiği araçları modele verir', () => {
    const tools = getAvailablePluginTools(plugin('gmail'), {
      send_email: false,
      read_emails: true,
    })
    expect(tools.map(tool => tool.name)).toEqual(['read_emails'])
  })

  it('katalog yalnızca sunucu agent araçlarını ve Gmail okumayı içerir', () => {
    const names = BUILT_IN_PLUGINS.flatMap(item => item.tools.map(tool => tool.name)).sort()
    expect(names).toEqual([
      'calculate', 'convert_currency', 'get_weather', 'read_emails', 'save_memory',
      'scrape_website', 'search_wikipedia', 'send_email', 'web_search',
    ])
  })

  it('açık ve ayrı Gmail izni olmadan e-posta verisini okumaz', async () => {
    await expect(readGmailInbox({ count: 5, gmailAccessToken: 'gecici-token' }))
      .resolves.toMatch(/yapay zekâ akışından ayrı/)
  })
})
