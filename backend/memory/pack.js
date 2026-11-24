// Hafıza kayıtlarından önceden derlenmiş paket üretir (saf fonksiyon).

const CORE_CATEGORIES = new Set(['kisisel', 'tercih', 'saglik']);

function sortByUpdatedAtDesc(a, b) {
  return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
}

function toEntry(memory) {
  return {
    key: String(memory.key || ''),
    value: String(memory.value || ''),
  };
}

function buildPack(memories = [], { previousVersion = 0, lastLearn = null, now } = {}) {
  const list = Array.isArray(memories) ? [...memories].sort(sortByUpdatedAtDesc) : [];
  const core = [];
  const optional = [];

  for (const item of list) {
    if (CORE_CATEGORIES.has(item.category)) {
      core.push(toEntry(item));
    } else {
      optional.push(toEntry(item));
    }
  }

  return {
    version: previousVersion + 1,
    builtAt: now().toISOString(),
    core,
    optional,
    lastLearn,
  };
}

module.exports = {
  CORE_CATEGORIES,
  buildPack,
};
