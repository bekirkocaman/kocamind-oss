// ═══ KocaMind Plugin System ═══
// Araçlar sunucudaki agent tarafından çalıştırılır; burada yalnızca ayarlarda
// gösterilen katalog ve kullanıcının kendi Gmail izniyle okunan gelen kutusu var.
import { API, authFetch } from './api'

const ENV_GATED_TOOLS = new Set(['send_email', 'read_emails'])

export function getAvailablePluginTools(plugin, availableTools) {
  return plugin.tools.filter(tool => {
    if (availableTools) return availableTools[tool.name] !== false
    return !ENV_GATED_TOOLS.has(tool.name)
  })
}

export function isPluginAvailable(plugin, availableTools) {
  return getAvailablePluginTools(plugin, availableTools).length > 0
}

export const BUILT_IN_PLUGINS = [
  {
    id: 'web_search',
    name: 'Web arama aracı (Agent)',
    description: 'Web\'de arama yap, güncel bilgileri ve haberleri getir',
    enabled: true,
    tools: [{ name: 'web_search', description: 'Web\'de arar ve kaynak linklerini getirir' }],
  },
  {
    id: 'web_scraper',
    name: 'Web gezgini',
    description: 'Herkese açık bir web sayfasını açıp içeriğini oku',
    enabled: true,
    tools: [{ name: 'scrape_website', description: 'Verilen URL\'deki sayfanın metnini getirir' }],
  },
  {
    id: 'weather',
    name: 'Hava durumu',
    description: 'Herhangi bir şehrin hava durumunu öğren',
    enabled: true,
    tools: [{ name: 'get_weather', description: 'Şehrin güncel hava durumunu getirir' }],
  },
  {
    id: 'currency',
    name: 'Döviz çevirici',
    description: 'Döviz kurlarını sorgula ve çevir',
    enabled: true,
    tools: [{ name: 'convert_currency', description: 'Bir para birimini diğerine çevirir' }],
  },
  {
    id: 'wikipedia',
    name: 'Wikipedia',
    description: 'Wikipedia\'dan bilgi ara',
    enabled: true,
    tools: [{ name: 'search_wikipedia', description: 'Wikipedia özeti ve kaynak adresini getirir' }],
  },
  {
    id: 'calculator',
    name: 'Hesap makinesi',
    description: 'Matematiksel hesaplamalar yap',
    enabled: true,
    tools: [{ name: 'calculate', description: 'Matematiksel bir ifadeyi hesaplar' }],
  },
  {
    id: 'memory',
    name: 'Hafıza kaydetme aracı (Agent)',
    description: 'Kullanıcı hakkında önemli bilgileri hatırla (giriş gerekli)',
    enabled: true,
    requiresAuth: true,
    tools: [{ name: 'save_memory', description: 'Kalıcı bir tercihi veya bilgiyi hafızaya kaydeder' }],
  },
  {
    id: 'gmail',
    name: 'E-posta (Gmail)',
    description: 'Gelen kutunu oku; e-posta gönderme yalnızca yöneticilere açık',
    enabled: true,
    tools: [
      { name: 'send_email', description: 'Onay alındıktan sonra e-posta gönderir' },
      { name: 'read_emails', description: 'Gelen kutusundaki son mailleri listeler' },
    ],
  },
]

export async function readGmailInbox({ count = 5, gmailAccessToken, allowGmailData } = {}) {
  if (allowGmailData !== true || !gmailAccessToken) {
    return 'Gmail verisi yalnızca kullanıcının açık Gmail görüntüleme isteğinde, yapay zekâ akışından ayrı olarak okunabilir.'
  }
  try {
    const res = await authFetch(API.toolEmailRead, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count, gmailAccessToken }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `Sunucu hatası (${res.status})`)
    if (!data.mails?.length) return '📧 Gelen kutusunda mail bulunamadı.'
    const list = data.mails.map((m, i) =>
      `${i + 1}. **${m.subject}**\n   👤 ${m.from} · 🕐 ${m.date ? new Date(m.date).toLocaleString('tr-TR') : 'tarih yok'}${m.snippet ? `\n   ${m.snippet}` : ''}`
    ).join('\n')
    return `📧 **Son ${data.count} mail:**\n\n${list}`
  } catch (e) {
    return `Gmail okunamadı: ${e.message}`
  }
}
