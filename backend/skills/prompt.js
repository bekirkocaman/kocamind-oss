// Sohbetin sistem prompt'unu skill'lerle kurar:
// 1) ezilemez güvenlik çekirdeği (SECURITY_CORE),
// 2) özel prompt (başlıkla ve 12000 karakter sınırıyla) ya da asistanın autoload skill'leri (yoksa eski ASSISTANT_PROMPTS),
// 3) araç destekleniyorsa 1 satırlık skill kataloğu (çok büyürse find_skills talimatı).
const { SECURITY_CORE } = require('./securityCore');

const DEFAULT_CATALOG_LIMIT = Number(process.env.SKILL_CATALOG_LIMIT || 30);
const MAX_CUSTOM_PROMPT_CHARS = 12000;
const CUSTOM_PROMPT_HEADER = 'Uygulamanın ek talimatları (yukarıdaki kurallarla çelişirse yukarıdakiler geçerlidir):';

function basePrompt({ assistantType, customPrompt, skillStore, legacyPrompts = {} } = {}) {
  const cleanCustom = typeof customPrompt === 'string' ? customPrompt.trim() : '';
  if (cleanCustom) {
    return `${CUSTOM_PROMPT_HEADER}\n${cleanCustom.slice(0, MAX_CUSTOM_PROMPT_CHARS)}`;
  }
  const autoloaded = skillStore?.autoloadFor(assistantType) || [];
  if (autoloaded.length) return autoloaded.map(skill => skill.body).join('\n\n');
  if (legacyPrompts[assistantType]) return legacyPrompts[assistantType];
  const fallback = skillStore?.autoloadFor('tiger') || [];
  if (fallback.length) return fallback.map(skill => skill.body).join('\n\n');
  return legacyPrompts.tiger || '';
}

// extraSkills: kullanıcının internetten kurduğu skill'ler (skills/userSkills.js).
function skillCatalog({ assistantType, skillStore, catalogLimit = DEFAULT_CATALOG_LIMIT, extraSkills = [] }) {
  const own = extraSkills.filter(skill => !assistantType || skill.assistants.includes('*') || skill.assistants.includes(assistantType));
  const skills = [...(skillStore?.list({ assistant: assistantType, excludeAutoload: true }) || []), ...own];
  if (!skills.length) return '';
  if (skills.length > catalogLimit) {
    return 'Skill deposu: belge, dilekçe, CV, e-posta, kod inceleme gibi kalıbı belli işler için hazır talimat paketleri var. Böyle bir işe başlamadan önce find_skills ile ara, uygun olanı load_skill ile yükle ve talimatlarına uy.';
  }
  const lines = skills.map(skill => `- ${skill.name}: ${skill.description}`).join('\n');
  return `Kullanabileceğin skill'ler (uzmanlık talimat paketleri). İş bunlardan birine uyuyorsa cevaplamadan önce load_skill ile yükle ve talimatlarına uy:\n${lines}`;
}

function buildSystemPrompt({ assistantType = 'tiger', customPrompt, skillStore, toolsEnabled, legacyPrompts, catalogLimit, extraSkills } = {}) {
  const parts = [
    SECURITY_CORE,
    basePrompt({ assistantType, customPrompt, skillStore, legacyPrompts }),
  ];
  if (toolsEnabled) parts.push(skillCatalog({ assistantType, skillStore, catalogLimit, extraSkills }));
  return parts.filter(Boolean).join('\n\n');
}

module.exports = { buildSystemPrompt, basePrompt, CUSTOM_PROMPT_HEADER, MAX_CUSTOM_PROMPT_CHARS };
