// Derlenmiş hafıza paketinden sistem istemi (prompt) metni seçer ve biçimlendirir.

const MEMORY_PROMPT_HEADER =
  'Kullanıcı hakkında hafızandaki bilgiler (yalnızca konuyla ilgiliyse doğal biçimde kullan, her cevapta tekrar etme):';

function terms(text) {
  return String(text || '')
    .toLocaleLowerCase('tr')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(word => word.length >= 3)
    .map(word => word.slice(0, 5));
}

function singleLine(text) {
  return String(text || '').replace(/[\r\n\u2028\u2029]+/g, ' ').trim();
}

function selectFromPack(pack, message = '', maxItems = 20) {
  const core = Array.isArray(pack?.core) ? pack.core : [];
  const optional = Array.isArray(pack?.optional) ? pack.optional : [];
  const all = [
    ...core.map(entry => ({ entry, core: 1 })),
    ...optional.map(entry => ({ entry, core: 0 })),
  ];

  if (all.length <= maxItems) {
    return all.map(item => item.entry);
  }

  const queryTerms = new Set(terms(message));
  const scored = all.map((item, index) => {
    const memoryTerms = terms(`${item.entry.key} ${item.entry.value}`);
    const overlap = memoryTerms.filter(term => queryTerms.has(term)).length;
    return { entry: item.entry, index, score: overlap * 3 + item.core };
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, maxItems).map(item => item.entry);
}

function formatEntries(entries, maxChars = 3000) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { text: '', keys: [] };
  }

  const prefix = `\n\n${MEMORY_PROMPT_HEADER}`;
  if (prefix.length > maxChars) {
    return { text: '', keys: [] };
  }

  let text = prefix;
  const keys = [];

  for (const item of entries) {
    const rawKey = String(item?.key || '');
    const key = singleLine(rawKey);
    const value = singleLine(item?.value);
    if (!key && !value) continue;
    const line = `\n- ${key}: ${value}`;
    if (text.length + line.length > maxChars) {
      break;
    }
    text += line;
    keys.push(rawKey);
  }

  if (keys.length === 0) {
    return { text: '', keys: [] };
  }

  return { text, keys };
}

function renderMemoryPrompt(pack, message = '', { maxChars = 3000, maxItems = 20 } = {}) {
  if (!pack || typeof pack !== 'object') {
    return { text: '', keys: [] };
  }
  const selected = selectFromPack(pack, message, maxItems);
  return formatEntries(selected, maxChars);
}

function renderCorePrompt(pack, { maxChars = 3000 } = {}) {
  if (!pack || typeof pack !== 'object') {
    return '';
  }
  const core = Array.isArray(pack.core) ? pack.core : [];
  return formatEntries(core, maxChars).text;
}

module.exports = {
  MEMORY_PROMPT_HEADER,
  terms,
  renderMemoryPrompt,
  renderCorePrompt,
};
