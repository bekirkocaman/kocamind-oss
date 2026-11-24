'use strict';

// Bağlam sıkıştırma: token tahmini, eski araç çıktılarını kırpma, modelle özetleme.

const TRUNCATE_OVER_CHARS = 300;
const SUMMARY_TOOL_OUTPUT_CHARS = 2000;

const TRUNCATED_TOOL_OUTPUT = JSON.stringify({
  ok: true,
  truncated: true,
  note: 'Eski araç çıktısı bağlamdan çıkarıldı; gerekirse aracı tekrar çağır.',
});

const SUMMARY_SYSTEM_PROMPT = [
  'Sen bir konuşma özetleyicisisin. Aşağıdaki kod asistanı oturumunu, asistanın işe kaldığı yerden devam edebileceği şekilde özetle.',
  'Şunları mutlaka koru: kullanıcının istekleri ve kararları, okunan ve değiştirilen dosyaların yolları, yapılan değişikliklerin özü, çalıştırılan komutlar ve sonuçları, açık kalan işler ve hatalar.',
  'Kod parçalarını yalnızca devam etmek için gerçekten gerekiyorsa ve kısa ise aynen yaz. Uydurma bilgi ekleme. En fazla 1500 kelime yaz.',
].join('\n');

function contentText(content) {
  if (typeof content === 'string') return content;
  if (content === undefined || content === null) return '';
  return JSON.stringify(content);
}

function estimateTokens(messages) {
  if (!Array.isArray(messages)) return 0;
  let total = 0;
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    let len = contentText(m.content).length;
    if (m.tool_calls !== undefined && m.tool_calls !== null) {
      len += JSON.stringify(m.tool_calls).length;
    }
    total += Math.ceil(len / 4) + 4;
  }
  return total;
}

function trimOldToolOutputs(messages, { keepRecent = 6 } = {}) {
  if (!Array.isArray(messages)) return [];
  const keep = Math.max(0, Number.isFinite(keepRecent) ? Math.floor(keepRecent) : 6);
  const toolIdx = [];
  messages.forEach((m, i) => {
    if (m && m.role === 'tool') toolIdx.push(i);
  });
  const protectedIdx = new Set(keep > 0 ? toolIdx.slice(-keep) : []);
  return messages.map((m, i) => {
    if (!m || m.role !== 'tool' || protectedIdx.has(i)) return m;
    if (contentText(m.content).length <= TRUNCATE_OVER_CHARS) return m;
    return { ...m, content: TRUNCATED_TOOL_OUTPUT };
  });
}

function describeToolCall(tc) {
  const fn = tc && tc.function ? tc.function : tc || {};
  const name = fn.name ?? '';
  const args =
    typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {});
  return `[araç: ${name} ${args}]`;
}

function formatTranscript(messages) {
  const lines = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m || typeof m !== 'object' || m.role === 'system') continue;
    if (m.role === 'tool') {
      lines.push(`tool: ${contentText(m.content).slice(0, SUMMARY_TOOL_OUTPUT_CHARS)}`);
      continue;
    }
    const parts = [];
    const text = contentText(m.content);
    if (text) parts.push(text);
    if (Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) parts.push(describeToolCall(tc));
    }
    lines.push(`${m.role}: ${parts.join(' ')}`);
  }
  return lines.join('\n');
}

async function summarizeHistory({ model, messages, signal = null }) {
  const res = await model.complete({
    messages: [
      { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
      { role: 'user', content: formatTranscript(messages) },
    ],
    tools: [],
    toolChoice: 'none',
    signal,
    onDelta: () => {},
  });
  const summary = res && typeof res.content === 'string' ? res.content.trim() : '';
  if (!summary) {
    throw new Error('Özet çıkarılamadı.');
  }
  return { summary, usage: res && res.usage ? res.usage : null };
}

module.exports = {
  estimateTokens,
  trimOldToolOutputs,
  summarizeHistory,
  SUMMARY_SYSTEM_PROMPT,
  TRUNCATED_TOOL_OUTPUT,
};
