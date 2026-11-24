// Kullanıcı mesajından kalıcı bilgi çıkarır, hafızaya yazar ve paketi yeniler.

const memoryStore = require('../memoryStore');
const memoryAssist = require('../memoryAssist');

function createLearner({
  firestoreDb,
  fetch,
  packStore = null,
  metrics = { track() {} },
  now = () => new Date(),
}) {
  async function learn({ uid, message, consumeQuota = null }) {
    if (
      typeof message !== 'string'
      || !memoryAssist.mightContainPersonalInfo(message)
      || !memoryAssist.isAssistAvailable()
    ) {
      return { saved: [], forgotten: [], skipped: true, usage: null };
    }

    if (typeof consumeQuota === 'function') {
      let allowed = false;
      try {
        allowed = Boolean(await consumeQuota());
      } catch {
        allowed = false;
      }
      if (!allowed) {
        return { saved: [], forgotten: [], skipped: true, usage: null };
      }
    }

    const startedAt = Date.now();
    const track = (ok, usage, via = memoryAssist.primaryAssist()) => metrics.track({
      uid,
      route: 'memory_extract',
      provider: via.provider,
      model: via.model,
      ok,
      usage,
      status: ok ? 200 : 503,
      latencyMs: Date.now() - startedAt,
    });

    try {
      const existing = await memoryStore.listMemories(firestoreDb, uid);
      const { memories, forget, usage, via } = await memoryAssist.extractMemories(fetch, { message, existing });
      track(true, usage, via);

      const forgotten = [];
      const saved = [];
      try {
        for (const key of forget) {
          await memoryStore.deleteMemory(firestoreDb, uid, key);
          forgotten.push(key);
        }
        const existingKeys = new Set(existing.map(memory => memory.key));
        let count = existing.length - forgotten.length;
        for (const memory of memories) {
          const isUpdate = existingKeys.has(memory.key);
          if (!isUpdate && count >= memoryAssist.MAX_MEMORIES_PER_USER) continue;
          const current = existing.find(item => item.key === memory.key);
          if (current && current.value === memory.value) continue;
          // isNew: istemciler yalnızca yeni kaydı "Geri al" ile silebilir; güncellemede eski değer yok olurdu.
          saved.push({ ...(await memoryStore.saveMemory(firestoreDb, uid, memory)), isNew: !isUpdate });
          if (!isUpdate) count += 1;
        }
      } finally {
        if (packStore && (saved.length > 0 || forgotten.length > 0)) {
          try {
            const nowVal = now();
            const at = (nowVal instanceof Date ? nowVal : new Date(nowVal)).toISOString();
            await packStore.rebuild(uid, {
              lastLearn: {
                at,
                saved: saved.map(({ key, isNew }) => ({ key, isNew })),
                forgotten,
              },
            });
          } catch (rebuildError) {
            console.warn('Hafıza paketi yenilenemedi:', rebuildError.message);
          }
        }
      }

      return { saved, forgotten, skipped: false, usage };
    } catch (error) {
      track(false, null);
      throw error;
    }
  }

  return { learn };
}

module.exports = { createLearner };
