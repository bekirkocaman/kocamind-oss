const { safeError } = require('../agent/security');

function clampInt(raw, fallback, min, max) {
  const value = Number(raw);
  if (raw === undefined || raw === null || String(raw).trim() === '' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function resolveLoopLimits(env = process.env) {
  return {
    maxToolCalls: clampInt(env?.CHAT_MAX_TOOL_CALLS, 12, 1, 50),
    maxWallTimeMs: clampInt(env?.CHAT_MAX_WALL_MS, 100000, 10000, 800000),
  };
}

function createLoopBudget({ maxToolCalls = 12, maxWallTimeMs = 100000, signal = null, now = () => Date.now() } = {}) {
  const startedAt = now();
  let usedToolCalls = 0;

  return {
    signal: signal || null,
    aborted() {
      return Boolean(signal?.aborted);
    },
    takeToolCalls(count) {
      const requested = Math.max(0, Number(count) || 0);
      const remaining = Math.max(0, maxToolCalls - usedToolCalls);
      const allowed = Math.min(requested, remaining);
      usedToolCalls += allowed;
      return allowed;
    },
    shouldFinish() {
      return usedToolCalls >= maxToolCalls || (now() - startedAt) >= maxWallTimeMs;
    },
    stats() {
      const elapsedMs = Math.max(0, now() - startedAt);
      let limitReached = null;
      if (usedToolCalls >= maxToolCalls) limitReached = 'tool_calls';
      else if (elapsedMs >= maxWallTimeMs) limitReached = 'time';
      return {
        toolCalls: usedToolCalls,
        elapsedMs,
        limitReached,
      };
    },
  };
}

async function runToolRound({ calls = [], executeTool, budget = createLoopBudget(), onStart, onDone }) {
  const allowed = budget.takeToolCalls(calls.length);
  return Promise.all(calls.map(async (call, index) => {
    if (index >= allowed) {
      const skippedOutput = { ok: false, error: 'Araç çağrısı sınırına ulaşıldı.' };
      onDone?.(call, index, skippedOutput, 0);
      return skippedOutput;
    }
    onStart?.(call, index);
    const startedAt = Date.now();
    const output = await Promise.resolve()
      .then(() => executeTool(call.name, call.arguments))
      .catch(error => safeError(error));
    const durationMs = Date.now() - startedAt;
    onDone?.(call, index, output, durationMs);
    return output;
  }));
}

module.exports = { createLoopBudget, resolveLoopLimits, runToolRound };
