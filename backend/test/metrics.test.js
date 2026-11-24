const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createMetrics, estimateCostUsd, normalizeUsage, parsePricing } = require('../metrics');
const { pipeResponsesAsChatCompletions } = require('../openaiResponses');
const { watchChatCompletionUsage } = require('../routes/chat');

// FieldValue.increment ve merge'lü set davranışını bellekte taklit eder.
function fakeStore() {
  const docs = new Map();
  const INC = Symbol('inc');
  const FieldValue = { increment: n => ({ [INC]: n }), serverTimestamp: () => 'ts' };
  const apply = (target, data) => {
    for (const [key, value] of Object.entries(data)) {
      const path = key.split('.');
      let node = target;
      for (const part of path.slice(0, -1)) node = node[part] ??= {};
      const last = path.at(-1);
      node[last] = value && typeof value === 'object' && INC in value ? (Number(node[last]) || 0) + value[INC] : value;
    }
  };
  const firestoreDb = {
    collection: name => ({
      doc: id => ({ set: async data => { const k = `${name}/${id}`; const cur = docs.get(k) || {}; apply(cur, data); docs.set(k, cur); } }),
      where: (field, op, value) => ({
        get: async () => ({
          docs: [...docs.entries()]
            .filter(([k, d]) => k.startsWith(`${name}/`) && d[field] >= value)
            .map(([k, d]) => ({ id: k.split('/')[1], data: () => d })),
        }),
      }),
    }),
  };
  return { docs, firestoreDb, FieldValue };
}

test('token kullanımı Responses ve Chat Completions biçimlerinden okunur', () => {
  assert.deepEqual(normalizeUsage({ input_tokens: 10, output_tokens: 5 }), { inputTokens: 10, outputTokens: 5 });
  assert.deepEqual(normalizeUsage({ prompt_tokens: 7, completion_tokens: 3 }), { inputTokens: 7, outputTokens: 3 });
  assert.deepEqual(normalizeUsage(null), { inputTokens: 0, outputTokens: 0 });
});

test('fiyat tanımsızsa maliyet uydurulmaz', () => {
  assert.deepEqual(parsePricing('bozuk json'), {});
  assert.equal(estimateCostUsd({}, 'x', 1000, 1000), null);
  assert.equal(estimateCostUsd({ x: { inputPerMTok: 1, outputPerMTok: 2 } }, 'x', 1_000_000, 500_000), 2);
});

test('model çağrıları günlük toplamlara ve kullanıcı kullanımına yazılır', async () => {
  const { docs, firestoreDb, FieldValue } = fakeStore();
  const metrics = createMetrics({
    firestoreDb, FieldValue,
    env: { MODEL_PRICING_JSON: JSON.stringify({ 'gpt-5.6-luna': { inputPerMTok: 1, outputPerMTok: 4 } }) },
    now: () => new Date('2026-09-24T10:00:00Z'),
  });
  await metrics.recordModelCall({ uid: 'u1', route: 'chat', provider: 'openai', model: 'gpt-5.6-luna', ok: true, latencyMs: 400, usage: { input_tokens: 1000, output_tokens: 500 } });
  await metrics.recordModelCall({ uid: 'u1', route: 'agent', provider: 'openai', model: 'gpt-5.6-luna', ok: false, latencyMs: 200, status: 429 });

  const [row] = await metrics.listDailyMetrics(7);
  assert.equal(row.calls, 2);
  assert.equal(row.errors, 1);
  assert.equal(row.errorRate, 0.5);
  assert.equal(row.avgLatencyMs, 300);
  assert.equal(row.inputTokens, 1000);
  assert.deepEqual(row.routes, { chat: 1, agent: 1 });
  assert.deepEqual(row.statusCodes, { s429: 1 });
  assert.ok(Math.abs(row.estimatedCostUsd - 0.003) < 1e-12);

  const usage = docs.get('usage_daily/u1_2026-09-24');
  assert.equal(usage.outputTokens, 500);
  assert.ok(Math.abs(usage.estimatedCostUsd - 0.003) < 1e-12);
});

test('ölçüm yazılamazsa istek akışı bozulmaz', async () => {
  const metrics = createMetrics({
    firestoreDb: { collection: () => ({ doc: () => ({ set: async () => { throw new Error('firestore kapalı'); } }) }) },
    FieldValue: { increment: n => n, serverTimestamp: () => 'ts' },
    env: {},
  });
  await assert.doesNotReject(() => metrics.recordModelCall({ provider: 'openai', model: 'm', ok: true, latencyMs: 1 }));
});

test('OpenAI Responses akışı kullanıcıya iletilirken token kullanımı döndürülür', async () => {
  const events = [
    { type: 'response.output_text.delta', delta: 'Merhaba' },
    { type: 'response.completed', response: { usage: { input_tokens: 12, output_tokens: 3 }, output: [] } },
  ].map(e => `data: ${JSON.stringify(e)}\n\n`);
  const written = [];
  const res = { write: chunk => written.push(chunk), end: () => {} };
  const result = await pipeResponsesAsChatCompletions(Readable.from(events.map(e => Buffer.from(e))), res);
  assert.deepEqual(result, { usage: { input_tokens: 12, output_tokens: 3 }, ok: true });
  assert.ok(written.join('').includes('Merhaba'));
});

test('OpenAI uyumlu akıştaki son usage parçası yakalanır', async () => {
  const stream = Readable.from([
    Buffer.from('data: {"choices":[{"delta":{"content":"a"}}]}\n\n'),
    Buffer.from('data: {"choices":[],"usage":{"prompt_tokens":9,"completion_tokens":2}}\n\ndata: [DONE]\n\n'),
  ]);
  const watcher = watchChatCompletionUsage(stream);
  await new Promise(resolve => stream.on('end', resolve).resume());
  assert.deepEqual(watcher.usage(), { prompt_tokens: 9, completion_tokens: 2 });
});
