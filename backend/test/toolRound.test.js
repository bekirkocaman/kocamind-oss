const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoopBudget, resolveLoopLimits, runToolRound } = require('../llm/toolRound');

test('bütçe hakkı düşer, biter ve stats().limitReached tool_calls olur', () => {
  let clock = 1000;
  const budget = createLoopBudget({ maxToolCalls: 3, maxWallTimeMs: 10000, now: () => clock });
  assert.equal(budget.shouldFinish(), false);
  assert.equal(budget.takeToolCalls(2), 2);
  assert.equal(budget.shouldFinish(), false);
  assert.deepEqual(budget.stats(), { toolCalls: 2, elapsedMs: 0, limitReached: null });

  clock = 1250;
  assert.equal(budget.takeToolCalls(5), 1);
  assert.equal(budget.takeToolCalls(1), 0);
  assert.equal(budget.shouldFinish(), true);
  assert.deepEqual(budget.stats(), { toolCalls: 3, elapsedMs: 250, limitReached: 'tool_calls' });
});

test('shouldFinish süre dolunca true olur ve stats().limitReached time döner', () => {
  let clock = 5000;
  const controller = new AbortController();
  const budget = createLoopBudget({ maxToolCalls: 5, maxWallTimeMs: 1000, signal: controller.signal, now: () => clock });
  assert.equal(budget.signal, controller.signal);
  assert.equal(budget.aborted(), false);
  assert.equal(budget.shouldFinish(), false);

  clock = 6000;
  assert.equal(budget.shouldFinish(), true);
  assert.deepEqual(budget.stats(), { toolCalls: 0, elapsedMs: 1000, limitReached: 'time' });

  controller.abort();
  assert.equal(budget.aborted(), true);
});

test('resolveLoopLimits varsayılan, geçersiz ve sınır dışı değerleri doğru çözer', () => {
  assert.deepEqual(resolveLoopLimits({}), { maxToolCalls: 12, maxWallTimeMs: 100000 });
  assert.deepEqual(resolveLoopLimits({ CHAT_MAX_TOOL_CALLS: 'abc', CHAT_MAX_WALL_MS: '' }), { maxToolCalls: 12, maxWallTimeMs: 100000 });
  assert.deepEqual(resolveLoopLimits({ CHAT_MAX_TOOL_CALLS: '0', CHAT_MAX_WALL_MS: '500' }), { maxToolCalls: 1, maxWallTimeMs: 10000 });
  assert.deepEqual(resolveLoopLimits({ CHAT_MAX_TOOL_CALLS: '999', CHAT_MAX_WALL_MS: '9999999' }), { maxToolCalls: 50, maxWallTimeMs: 800000 });
  assert.deepEqual(resolveLoopLimits({ CHAT_MAX_TOOL_CALLS: '8', CHAT_MAX_WALL_MS: '45000' }), { maxToolCalls: 8, maxWallTimeMs: 45000 });
});

test('runToolRound sırayı korur, hakkı aşanları çalıştırmaz, fırlatan aracı ok: false yapar ve paralel başlar', async () => {
  const budget = createLoopBudget({ maxToolCalls: 3 });
  const active = new Set();
  let maxConcurrent = 0;
  const started = [];
  const done = [];

  const calls = [
    { name: 'slow_first', arguments: '{"v":1}' },
    { name: 'fast_second', arguments: '{"v":2}' },
    { name: 'throwing_third', arguments: '{"v":3}' },
    { name: 'over_limit_fourth', arguments: '{"v":4}' },
  ];

  const outputs = await runToolRound({
    calls,
    budget,
    onStart: (call, index) => started.push([call.name, index]),
    onDone: (call, index, output, durationMs) => done.push({ name: call.name, index, ok: output.ok, durationMs }),
    executeTool: async (name, rawArgs) => {
      active.add(name);
      maxConcurrent = Math.max(maxConcurrent, active.size);
      try {
        if (name === 'slow_first') {
          await new Promise(resolve => setTimeout(resolve, 30));
          return { ok: true, result: { v: JSON.parse(rawArgs).v } };
        }
        if (name === 'fast_second') {
          await new Promise(resolve => setTimeout(resolve, 5));
          return { ok: true, result: { v: JSON.parse(rawArgs).v } };
        }
        throw new Error('patladı token=secret123');
      } finally {
        active.delete(name);
      }
    },
  });

  assert.ok(maxConcurrent >= 2, 'araçlar paralel başlamalı');
  assert.equal(outputs.length, 4);
  assert.deepEqual(outputs[0], { ok: true, result: { v: 1 } });
  assert.deepEqual(outputs[1], { ok: true, result: { v: 2 } });
  assert.equal(outputs[2].ok, false);
  assert.match(outputs[2].error, /token=\[REDACTED\]/);
  assert.deepEqual(outputs[3], { ok: false, error: 'Araç çağrısı sınırına ulaşıldı.' });
  assert.deepEqual(started, [['slow_first', 0], ['fast_second', 1], ['throwing_third', 2]]);
  const skippedDone = done.find(item => item.name === 'over_limit_fourth');
  assert.deepEqual(skippedDone, { name: 'over_limit_fourth', index: 3, ok: false, durationMs: 0 });
});
