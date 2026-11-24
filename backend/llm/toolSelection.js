// Sohbette modele verilecek araçları seçer. Araç sayısı az ise hepsi verilir.
// Çok araç varsa (ör. birkaç bağlı hesap) ortak araçlar + `find_tools` verilir;
// model ihtiyaç duyduğu aracı arar, bulunan araçlar sonraki turlarda etkinleşir.
const { z } = require('../agent/toolRegistry');
const { normalizeText } = require('../skills/skillStore');

const DEFAULT_MAX_TOOLS = Number(process.env.MAX_CHAT_TOOLS || 24);
const FIND_LIMIT = 5;

const GROQ_INTENTS = {
  get_weather: /\b(?:hava(?:nin)? (?:durumu\w*|tahmini\w*|nasil|sicakligi\w*|kac derece)|yagmur (?:yag\w*|var)|weather|forecast|get_weather)\b/,
  convert_currency: /\b(?:doviz\w*|(?:kur|kuru|kurlar) (?:ne|kac|nedir|bugun)|para birimi (?:donus\w*|cevir\w*)|dolar(?:in|a|i|lar)?|avro\w*|euro(?:nun|ya|yu)?|sterlin\w*|usd|eur|gbp|jpy|rub|chf|\d+\s*(?:tl|try|yen|yuan)|convert_currency)\b/,
  search_wikipedia: /\b(?:vikipedi\w*|wikipedia\w*|search_wikipedia)\b/,
  scrape_website: /\b(?:sayfa\w*|link\w*|baglanti\w*|url)\b.{0,80}\b(?:oku\w*|ozetle\w*|incele\w*|ac|read|summari[sz]e)\b|\b(?:read|summari[sz]e) (?:this |the )?(?:page|link|https?:)|\bscrape_website\b/,
  save_memory: /\b(?:hafiza(?:na|ya|ma)|bellege|aklinda)\b.{0,80}\b(?:kaydet|ekle|tut|yaz)\b|\b(?:bunu (?:hatirla|unutma)|remember (?:this|that)|save_memory)\b/,
};

const SKILL_INTENT = /\b(?:skill(?:s|i|ler\w*)?|find_skills|load_skill|dilekce\w*|ozgecmis\w*|cv|on yazi|linkedin profil\w*|fatura\w*|turk hukuku|hukuki|kira (?:sozlesme\w*|artis\w*)|isten cikar\w*|tuketici hak\w*|miras\w*|bosanma\w*|belirti\w*|hastalik\w*|ilac\w*|agr(?:im|iyor)|kod\w*\b.{0,60}\bincele\w*|code review|(?:resmi|profesyonel) (?:e-posta|eposta|email)|(?:hocama|kuruma|sirkete) (?:e-posta|eposta|mail)|yks|kpss|lgs|sinav sorusu|soru\w* coz\w*)\b/;
const CONNECTOR_REQUEST = /\b(?:bagli (?:hesap\w*|servis\w*)|hesabim\w*|takvimim\w*|repom\w*|dosyalarim\w*|gelen kutum\w*|(?:my|connected) (?:account|calendar|repos?|files|inbox)|find_tools)\b/;
const CONNECTOR_ACTION = /\b(?:listele\w*|goster\w*|getir\w*|oku\w*|bul|ara|ozetle\w*|kontrol et|ac|list|show|read|find|search|summari[sz]e)\b/;
const words = value => normalizeText(value).replace(/[^a-z0-9]+/g, ' ').trim();

function groqToolNames({ message, customPrompt, previousAssistantMessage, skills = [] }, searchable) {
  const query = normalizeText(message);
  const phrase = ` ${words(query)} `;
  const mentions = value => {
    const name = words(value);
    return name && phrase.includes(` ${name} `);
  };
  const names = new Set(['web_search', 'calculate']);
  for (const [name, intent] of Object.entries(GROQ_INTENTS)) {
    if (intent.test(query)) names.add(name);
  }
  if (/^\s*https?:\/\/\S+\s*$/.test(query)) names.add('scrape_website');
  if (SKILL_INTENT.test(query) || /\b(?:load_skill|find_skills)\b/.test(customPrompt || '')
      || skills.some(skill => mentions(skill.name) || mentions(skill.title))) {
    names.add('load_skill');
    names.add('find_skills');
  }
  const install = /\b(?:skills?|skill\.md|install_skill)\b/.test(query) && /\b(?:kur|kurulum\w*|yukle|install|install_skill)\b/.test(query);
  const confirmsInstall = /^(?:evet(?:[, ]+(?:kur|yukle|onayliyorum))?|kur|yukle|onayliyorum|yes(?:,? install it)?)[.!]?$/i.test(query.trim())
    && /\b(?:skills?|skill\.md)\b.{0,120}\b(?:onay\w*|kur\w*|install\w*)\b/i.test(normalizeText(previousAssistantMessage));
  if (install || confirmsInstall) names.add('install_skill');

  const connected = searchable.length > 0 && (CONNECTOR_REQUEST.test(query) || searchable.some(({ function: tool }) =>
    mentions(tool.name) || (CONNECTOR_ACTION.test(query) && (mentions(tool.name.split('__')[0]) || mentions(tool.description?.match(/^\[([^\]]+)\]/)?.[1])))
  ));
  return { names, connected };
}

function createToolSelection({ registry, context, maxTools = DEFAULT_MAX_TOOLS, groq }) {
  const all = registry.toChatCompletionsTools(context);
  const isExtra = tool => context.extraTools?.has?.(tool.function.name);
  const core = all.filter(tool => !isExtra(tool));
  const searchable = all.filter(isExtra);
  const lean = groq ? groqToolNames(groq, searchable) : null;
  const overLimit = all.length > maxTools;
  const activated = new Set();
  const activeTools = () => searchable.filter(tool => activated.has(tool.function.name));
  const leanCore = lean ? core.filter(tool => lean.names.has(tool.function.name)) : [];
  const selection = {
    tools: () => overLimit ? [...core, ...activeTools(), findTool] : all,
    groqTools: () => lean?.connected ? [...leanCore, ...activeTools(), findTool] : leanCore,
  };
  if (!overLimit && !lean?.connected) return selection;

  if (!(context.extraTools instanceof Map)) context.extraTools = new Map();
  context.extraTools.set('find_tools', {
    name: 'find_tools',
    description: 'Kullanıcının bağlı hesaplarındaki (Notion, GitHub, Google Takvim, Drive...) araçları arar ve kullanıma açar. Bu servislerle ilgili bir iş istenirse önce bununla ara.',
    riskLevel: 'low',
    requiresConfirmation: false,
    timeoutMs: 5000,
    enabled: () => true,
    inputSchema: z.object({ query: z.string().min(1).max(200) }).strict(),
    jsonSchema: { type: 'object', properties: { query: { type: 'string', description: 'Ne yapılmak isteniyor, ör. "takvime etkinlik ekle"' } }, required: ['query'], additionalProperties: false },
    execute: async ({ query }) => {
      const words = normalizeText(query).split(/[^a-z0-9]+/).filter(word => word.length >= 3);
      const matches = searchable
        .map(tool => {
          const haystack = normalizeText(`${tool.function.name.replace(/_/g, ' ')} ${tool.function.description}`);
          const score = words.reduce((sum, word) => sum + (haystack.includes(word) ? 2 : (word.length >= 5 && haystack.includes(word.slice(0, -2)) ? 1 : 0)), 0);
          return { tool, score };
        })
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, FIND_LIMIT)
        .map(item => item.tool);
      for (const tool of matches) activated.add(tool.function.name);
      return { tools: matches.map(tool => ({ name: tool.function.name, description: tool.function.description })) };
    },
  });
  const findTool = registry.toChatCompletionsTools(context).find(tool => tool.function.name === 'find_tools');

  return selection;
}

module.exports = { createToolSelection };
