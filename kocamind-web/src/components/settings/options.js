import {
  IconBilling,
  IconCapabilities,
  IconConnectorCalendar,
  IconConnectorDrive,
  IconConnectorGitHub,
  IconConnectorGmail,
  IconConnectorNotion,
  IconConnectors,
  IconCustomInstructions,
  IconDocument,
  IconHelp,
  IconMemory,
  IconNotifications,
  IconPlugins,
  IconPrivacy,
  IconProfile,
  IconSettings,
  IconSkills,
  IconVoiceSettings,
} from "../icons.jsx";

export const DOC_TEXT_EXTENSIONS = ['.txt', '.md', '.csv', '.json', '.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.c', '.cpp', '.cs', '.go', '.rs', '.rb', '.php', '.sql', '.html', '.css', '.xml', '.log']

// Ayarlar düzeni: 14 sekme, sol menüde yalnızca boşlukla ayrılan 6 grup.
// Her sekme yalnızca aynı konunun ayarlarını içerir.
export const SETTINGS_TAB_GROUPS = [
  [
    { id: 'main', label: 'Genel', icon: IconSettings, sections: ['appearance', 'language'] },
    { id: 'notifications', label: 'Bildirimler', icon: IconNotifications, sections: ['notifications'] },
    { id: 'voice', label: 'Ses', icon: IconVoiceSettings, sections: ['voice'] },
  ],
  [
    { id: 'personalization', label: 'Kişiselleştirme', icon: IconCustomInstructions, sections: ['general', 'styles'] },
    { id: 'memory', label: 'Hafıza', icon: IconMemory, sections: ['memory'] },
  ],
  [
    { id: 'capabilities', label: 'Özellikler', icon: IconCapabilities, sections: ['capabilities'] },
    { id: 'skills', label: "Skill'ler", icon: IconSkills, sections: ['skills'] },
    { id: 'plugins', label: 'Eklentiler', icon: IconPlugins, sections: ['plugins'] },
    { id: 'documents', label: 'Dokümanlar', icon: IconDocument, sections: ['documents'] },
    { id: 'connectors', label: 'Bağlantılar', icon: IconConnectors, sections: ['connectors'] },
  ],
  [
    { id: 'data_privacy', label: 'Veri ve Gizlilik', icon: IconPrivacy, sections: ['privacy', 'data'] },
  ],
  [
    { id: 'account', label: 'Hesap', icon: IconProfile, sections: ['account', 'account_danger'] },
    { id: 'billing', label: 'Plan ve kullanım', icon: IconBilling, sections: ['billing', 'usage'] },
  ],
  [
    { id: 'help', label: 'Yardım', icon: IconHelp, sections: ['about', 'bug_report'] },
  ],
]

export const SETTINGS_TABS = SETTINGS_TAB_GROUPS.flat()

// Ayarlar kimliksiz ya da bilinmeyen kimlikle açılınca gösterilen sekme.
export const DEFAULT_SETTINGS_TAB = 'main'

// Bölüm başlıkları. `null`: panelin kendi <h3> başlığı bölüm başlığı olarak kalır.
// `hidePanelTitle`: tek bölümlü sekmede panelin ilk başlığı sekme başlığını tekrar ettiği için gizlenir.
export const SETTINGS_SECTIONS = {
  appearance: { title: 'Görünüm' },
  language: { title: 'Dil' },
  notifications: { title: null },
  voice: { title: null },
  general: { title: 'Özel talimatlar' },
  styles: { title: 'Stiller' },
  memory: { title: null, hidePanelTitle: true },
  capabilities: { title: null, hidePanelTitle: true },
  skills: { title: null, hidePanelTitle: true },
  plugins: { title: null, hidePanelTitle: true },
  documents: { title: null, hidePanelTitle: true },
  connectors: { title: null, hidePanelTitle: true },
  privacy: { title: 'Gizlilik' },
  data: { title: 'Veri' },
  account: { title: null },
  account_danger: { title: 'Oturum ve hesap' },
  billing: { title: 'Plan' },
  usage: { title: 'Kullanım' },
  about: { title: 'Hakkında' },
  bug_report: { title: null },
}

// Eski 18 sekme kimliği ve f15e497'deki 8 sekme kimliği -> yeni sekme ve kaydırılacak bölüm.
// Uygulamada ayarları kimlikle açan her çağrı (App.jsx, Sidebar.jsx, lib/chatSubmission.js) bu tek tablo üzerinden çözülür.
export const LEGACY_TAB_MAP = {
  account: { tab: 'account', section: 'account' },
  billing: { tab: 'billing', section: 'billing' },
  usage: { tab: 'billing', section: 'usage' },
  capabilities: { tab: 'capabilities', section: 'capabilities' },
  connectors: { tab: 'connectors', section: 'connectors' },
  plugins: { tab: 'plugins', section: 'plugins' },
  general: { tab: 'personalization', section: 'general' },
  styles: { tab: 'personalization', section: 'styles' },
  memory: { tab: 'memory', section: 'memory' },
  skills: { tab: 'skills', section: 'skills' },
  documents: { tab: 'documents', section: 'documents' },
  appearance: { tab: 'main', section: 'appearance' },
  voice: { tab: 'voice', section: 'voice' },
  notifications: { tab: 'notifications', section: 'notifications' },
  privacy: { tab: 'data_privacy', section: 'privacy' },
  data: { tab: 'data_privacy', section: 'data' },
  about: { tab: 'help', section: 'about' },
  bug_report: { tab: 'help', section: 'bug_report' },
}

// Kimliği { tab, section } olarak çözer; üst seviye sekme kimlikleri de kabul edilir (section: null).
// Bilinmeyen kimlik (ör. App'in ilk değeri 'assistants', null) için null döner.
export function resolveSettingsTab(id) {
  if (typeof id !== 'string') return null
  if (Object.prototype.hasOwnProperty.call(LEGACY_TAB_MAP, id)) return { ...LEGACY_TAB_MAP[id] }
  if (SETTINGS_TABS.some(tab => tab.id === id)) return { tab: id, section: null }
  return null
}

export const OCCUPATIONS = [
  'Geliştirici', 'Öğrenci', 'Pazarlama', 'Tasarımcı',
  'Yönetici', 'Sağlık', 'Hukuk', 'Finans', 'Eğitimci', 'Diğer',
]

// Sunucu kataloğu yüklenemezse gösterilecek adlar; asıl liste /connectors yanıtından gelir.
export const CONNECTOR_ICONS = {
  google_calendar: IconConnectorCalendar,
  google_drive: IconConnectorDrive,
  notion: IconConnectorNotion,
  github: IconConnectorGitHub,
}

export const GMAIL_CONNECTOR = { id: 'gmail', name: 'Gmail', icon: IconConnectorGmail, desc: 'Son iletilerinin başlıklarını salt okunur görüntüle' }

export const TONE_PRESETS = [
  { id: 'normal', name: 'Normal', desc: 'Dengeli ve doğal konuşma tarzı', prompt: 'Doğal ve dengeli bir dille konuş.' },
  { id: 'concise', name: 'Kısa ve öz', desc: 'Gereksiz detaylara girmeden, net cevaplar', prompt: 'Olabildiğince kısa ve öz cevaplar ver. Sadece en önemli bilgiyi ilet.' },
  { id: 'explanatory', name: 'Açıklayıcı', desc: 'Adım adım, örneklerle detaylı anlatım', prompt: 'Her şeyi adım adım, örneklerle ve detaylı açıkla. Bir öğretmen gibi sabırlı ol.' },
  { id: 'formal', name: 'Resmi', desc: 'Profesyonel ve kurumsal dil', prompt: 'Profesyonel ve resmi bir dille konuş. Saygılı ve kurumsal ol.' },
]

export const LANGUAGES = [
  { id: 'tr', label: 'Türkçe' },
  { id: 'en', label: 'English' },
]

export const REPLY_FONTS = [
  { id: 'sans', label: 'Sade' },
  { id: 'serif', label: 'Klasik' },
]

export const FONTS = [
  { id: 'default', label: 'Varsayılan', family: 'var(--font-ui)' },
  { id: 'system', label: 'Sisteme uyumlu', family: 'system-ui, -apple-system, sans-serif' },
  { id: 'dyslexia', label: 'Disleksi dostu', family: '"OpenDyslexic", "Comic Sans MS", cursive, sans-serif' },
]

export const RETENTION_OPTIONS = [
  { id: '1month', label: '1 ay' },
  { id: '3months', label: '3 ay' },
  { id: '6months', label: '6 ay' },
  { id: '1year', label: '1 yıl' },
  { id: 'forever', label: 'Sınırsız' },
]
