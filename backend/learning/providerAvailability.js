const PROVIDER_DOMAINS = {
  openai: 'openai.com',
  deepseek: 'deepseek.com',
  evren: 'evren-llmapi.ssyz.org.tr',
  gemini: 'generativelanguage.googleapis.com',
  groq: 'groq.com',
  anthropic: 'anthropic.com',
  xai: 'x.ai',
};

function disabledProviders(env = process.env) {
  return new Set(String(env.DISABLED_PROVIDERS || '').split(',').map(id => id.trim().toLowerCase()).filter(Boolean));
}

// Özel URL ayarlarında sağlayıcı kimliği yerine anahtar adı ve sunucu adresi bilinir.
function isDisabledEndpoint(disabled, { url, envKey }) {
  if (!disabled.size) return false;
  let hostname;
  try { hostname = new URL(url).hostname.replace(/\.$/, ''); } catch { /* Geçersiz URL mevcut istek yolunda ele alınır. */ }
  for (const id of disabled) {
    const key = id === 'evren' ? 'EVREN_LLM_API_KEY' : `${id.toUpperCase()}_API_KEY`;
    const domain = Object.hasOwn(PROVIDER_DOMAINS, id) ? PROVIDER_DOMAINS[id] : null;
    if (envKey === key || (domain && (hostname === domain || hostname?.endsWith(`.${domain}`)))) return true;
  }
  return false;
}

module.exports = { disabledProviders, isDisabledEndpoint };
