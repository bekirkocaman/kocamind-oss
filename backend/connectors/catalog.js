// Güvenilir bağlayıcı listesi. Kullanıcı serbest MCP adresi ekleyemez; yeni servis
// eklemek = buraya bir kayıt. Ayrıntı: docs/superpowers/specs/2026-10-12-mcp-connectors-design.md
//
// kind:
//   remote-mcp → uzak MCP sunucusu (tools/list, tools/call), MCP SDK ile.
//   builtin    → kendi kodumuz (ör. Google REST API), aynı arayüzle.
// auth.type:
//   static     → OAuth uç noktaları ve istemci bilgisi env'den.
//   discovery  → MCP sunucusunun OAuth metadatasından keşif + dinamik istemci kaydı (DCR).
//                authHostSuffix: keşfedilen yetkilendirme sunucusunun alan adı bununla bitmeli
//                (MCP sunucusu tokenı başka bir sunucuya yönlendiremesin).

const GOOGLE_AUTH = {
  type: 'static',
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
  clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
  clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
  // Yenileme tokenı için çevrimdışı erişim ve onay ekranı zorunlu.
  extraAuthParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
};

const CONNECTORS = [
  {
    id: 'google_calendar',
    label: 'Google Takvim',
    description: 'Etkinliklerini listeler, onayınla yeni etkinlik ekler.',
    kind: 'builtin',
    builtin: 'googleCalendar',
    auth: { ...GOOGLE_AUTH, scopes: ['https://www.googleapis.com/auth/calendar.events'] },
  },
  {
    id: 'google_drive',
    label: 'Google Drive',
    description: 'KocaMind ile açtığın veya oluşturduğun dosyaları okur, onayınla yeni dosya oluşturur.',
    kind: 'builtin',
    builtin: 'googleDrive',
    // drive.file yalnızca uygulamanın oluşturduğu/kullanıcının seçtiği dosyaları görür; ücretli denetim gerektirmez.
    auth: { ...GOOGLE_AUTH, scopes: ['https://www.googleapis.com/auth/drive.file'] },
  },
  {
    id: 'notion',
    label: 'Notion',
    description: 'Notion sayfalarında arar ve okur, onayınla sayfa oluşturur veya günceller.',
    kind: 'remote-mcp',
    url: 'https://mcp.notion.com/mcp',
    auth: { type: 'discovery', authHostSuffix: 'notion.com' },
  },
  {
    id: 'github',
    label: 'GitHub',
    description: 'Depolarını, issue ve PR\'larını okur, onayınla issue açar veya yorum yazar.',
    kind: 'remote-mcp',
    url: 'https://api.githubcopilot.com/mcp/',
    auth: {
      type: 'static',
      authorizationEndpoint: 'https://github.com/login/oauth/authorize',
      tokenEndpoint: 'https://github.com/login/oauth/access_token',
      clientIdEnv: 'GITHUB_OAUTH_CLIENT_ID',
      clientSecretEnv: 'GITHUB_OAUTH_CLIENT_SECRET',
      scopesEnv: 'GITHUB_OAUTH_SCOPES',
      scopes: ['repo', 'read:org'],
    },
  },
];

function scopesFor(connector, env) {
  const fromEnv = connector.auth.scopesEnv && env[connector.auth.scopesEnv];
  return fromEnv ? fromEnv.split(/[\s,]+/).filter(Boolean) : (connector.auth.scopes || []);
}

// Bağlayıcının bu ortamda kullanılabilir olup olmadığı ve değilse nedeni.
function availability(connector, env) {
  if (!env.CONNECTOR_TOKEN_KEY) return { available: false, reason: 'CONNECTOR_TOKEN_KEY tanımlı değil' };
  if (!env.PUBLIC_BACKEND_URL) return { available: false, reason: 'PUBLIC_BACKEND_URL tanımlı değil' };
  if (connector.auth.type === 'static') {
    if (!env[connector.auth.clientIdEnv] || !env[connector.auth.clientSecretEnv]) {
      return { available: false, reason: `${connector.auth.clientIdEnv} / ${connector.auth.clientSecretEnv} tanımlı değil` };
    }
  }
  const disabled = String(env.CONNECTORS_DISABLED || '').split(',').map(item => item.trim());
  if (disabled.includes(connector.id)) return { available: false, reason: 'CONNECTORS_DISABLED ile kapatıldı' };
  return { available: true };
}

function getConnector(id) {
  return CONNECTORS.find(connector => connector.id === id) || null;
}

module.exports = { CONNECTORS, getConnector, availability, scopesFor };
