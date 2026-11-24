import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTrace } from './trace.ts';

test('1. bos olay dizisi bos tur listesi doner', () => {
  assert.deepStrictEqual(buildTrace([]), []);
});

test('2. tamamlanmis tek tur: adimlar, araclar, onaylar, sureler ve kullanim', () => {
  const events = [
    { seq: 1, at: '2026-03-01T00:00:00.000Z', type: 'turn/start' },
    { seq: 2, at: '2026-03-01T00:00:00.100Z', type: 'user/message', content: 'Merhaba, dosyayi oku' },
    { seq: 3, at: '2026-03-01T00:00:01.000Z', type: 'step/start', step: 1 },
    {
      seq: 4,
      at: '2026-03-01T00:00:01.500Z',
      type: 'assistant/message',
      content: 'Dosyayi okuyorum.',
      tool_calls: [{ id: 'c1' }],
    },
    {
      seq: 5,
      at: '2026-03-01T00:00:02.000Z',
      type: 'tool/start',
      callId: 'c1',
      name: 'read_file',
      args: { path: 'src/app.ts' },
    },
    {
      seq: 6,
      at: '2026-03-01T00:00:02.250Z',
      type: 'tool/result',
      callId: 'c1',
      name: 'read_file',
      ok: true,
      content: 'ok',
    },
    { seq: 7, at: '2026-03-01T00:00:03.000Z', type: 'step/start', step: 2 },
    {
      seq: 8,
      at: '2026-03-01T00:00:03.200Z',
      type: 'tool/start',
      callId: 'c2',
      name: 'write_file',
      args: { path: 'src/out.ts' },
    },
    { seq: 9, at: '2026-03-01T00:00:03.300Z', type: 'approval/request', callId: 'c2', name: 'write_file' },
    { seq: 10, at: '2026-03-01T00:00:04.000Z', type: 'approval/result', callId: 'c2', approved: true },
    {
      seq: 11,
      at: '2026-03-01T00:00:04.100Z',
      type: 'tool/result',
      callId: 'c2',
      name: 'write_file',
      ok: true,
      content: 'written',
    },
    { seq: 12, at: '2026-03-01T00:00:05.000Z', type: 'assistant/message', content: 'Tamamlandi.' },
    {
      seq: 13,
      at: '2026-03-01T00:00:06.000Z',
      type: 'turn/end',
      status: 'completed',
      steps: 2,
      toolCalls: 2,
      limitReached: null,
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    },
  ];

  const turns = buildTrace(events);
  assert.equal(turns.length, 1);
  const t = turns[0];
  assert.equal(t.index, 1);
  assert.equal(t.userText, 'Merhaba, dosyayi oku');
  assert.equal(t.startedAt, '2026-03-01T00:00:00.000Z');
  assert.equal(t.durationMs, 6000);
  assert.equal(t.status, 'completed');
  assert.equal(t.limitReached, null);
  assert.equal(t.compacted, false);
  assert.deepStrictEqual(t.usage, { total_tokens: 150 });

  assert.equal(t.steps.length, 2);
  assert.equal(t.steps[0].step, 1);
  assert.equal(t.steps[0].durationMs, 2000);
  assert.equal(t.steps[0].text, 'Dosyayi okuyorum.');
  assert.deepStrictEqual(t.steps[0].tools, [
    {
      callId: 'c1',
      name: 'read_file',
      summary: 'src/app.ts',
      ok: true,
      durationMs: 250,
      approval: null,
    },
  ]);

  assert.equal(t.steps[1].step, 2);
  assert.equal(t.steps[1].durationMs, 3000);
  assert.equal(t.steps[1].text, 'Tamamlandi.');
  assert.deepStrictEqual(t.steps[1].tools, [
    {
      callId: 'c2',
      name: 'write_file',
      summary: 'src/out.ts',
      ok: true,
      durationMs: 900,
      approval: 'approved',
    },
  ]);
});

test('3. turn/end olmayan acik tur, reddedilen onay ve context/compact', () => {
  const events = [
    { seq: 1, at: '2026-03-01T00:00:00.000Z', type: 'turn/start' },
    { seq: 2, at: '2026-03-01T00:00:01.000Z', type: 'user/message', content: 'Komut calistir' },
    { seq: 3, at: '2026-03-01T00:00:01.500Z', type: 'context/compact', summary: 'ozet', uptoSeq: 1 },
    { seq: 4, at: '2026-03-01T00:00:02.000Z', type: 'step/start', step: 1 },
    {
      seq: 5,
      at: '2026-03-01T00:00:03.000Z',
      type: 'tool/start',
      callId: 'c1',
      name: 'run_command',
      args: { command: 'rm -rf /' },
    },
    { seq: 6, at: '2026-03-01T00:00:03.100Z', type: 'approval/result', callId: 'c1', approved: false },
  ];

  const turns = buildTrace(events);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].status, null);
  assert.equal(turns[0].durationMs, null);
  assert.equal(turns[0].compacted, true);
  assert.equal(turns[0].steps[0].durationMs, null);
  assert.deepStrictEqual(turns[0].steps[0].tools[0], {
    callId: 'c1',
    name: 'run_command',
    summary: 'rm -rf /',
    ok: null,
    durationMs: null,
    approval: 'rejected',
  });
});

test('4. metin ve ozet kisaltmalari, bozuk tarihlerde null sure', () => {
  const longUser = 'u'.repeat(250);
  const longAsst = 'a'.repeat(350);
  const longDesc = 'd'.repeat(100);
  const events = [
    { seq: 1, at: 'gecersiz-tarih', type: 'turn/start' },
    { seq: 2, at: 'gecersiz-tarih', type: 'user/message', content: longUser },
    { seq: 3, at: 'gecersiz-tarih', type: 'step/start', step: 1 },
    { seq: 4, at: 'gecersiz-tarih', type: 'assistant/message', content: longAsst },
    {
      seq: 5,
      at: 'gecersiz-tarih',
      type: 'tool/start',
      callId: 'c1',
      name: 'task',
      args: { description: longDesc },
    },
    {
      seq: 6,
      at: 'gecersiz-tarih',
      type: 'tool/result',
      callId: 'c1',
      name: 'task',
      ok: false,
      content: 'hata',
    },
    { seq: 7, at: 'gecersiz-tarih', type: 'turn/end', status: 'failed' },
  ];

  const turns = buildTrace(events);
  assert.equal(turns[0].userText.length, 201);
  assert.ok(turns[0].userText.endsWith('…'));
  assert.equal(turns[0].steps[0].text.length, 301);
  assert.ok(turns[0].steps[0].text.endsWith('…'));
  assert.equal(turns[0].steps[0].tools[0].summary.length, 81);
  assert.ok(turns[0].steps[0].tools[0].summary.endsWith('…'));
  assert.equal(turns[0].durationMs, null);
  assert.equal(turns[0].steps[0].durationMs, null);
  assert.equal(turns[0].steps[0].tools[0].durationMs, null);
  assert.equal(turns[0].steps[0].tools[0].ok, false);
});
