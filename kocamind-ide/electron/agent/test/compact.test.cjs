'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  estimateTokens,
  trimOldToolOutputs,
  summarizeHistory,
  SUMMARY_SYSTEM_PROMPT,
  TRUNCATED_TOOL_OUTPUT,
} = require('../compact.cjs');

const EXPECTED_SYSTEM = [
  'Sen bir konuşma özetleyicisisin. Aşağıdaki kod asistanı oturumunu, asistanın işe kaldığı yerden devam edebileceği şekilde özetle.',
  'Şunları mutlaka koru: kullanıcının istekleri ve kararları, okunan ve değiştirilen dosyaların yolları, yapılan değişikliklerin özü, çalıştırılan komutlar ve sonuçları, açık kalan işler ve hatalar.',
  'Kod parçalarını yalnızca devam etmek için gerçekten gerekiyorsa ve kısa ise aynen yaz. Uydurma bilgi ekleme. En fazla 1500 kelime yaz.',
].join('\n');

const TRUNC =
  '{"ok":true,"truncated":true,"note":"Eski araç çıktısı bağlamdan çıkarıldı; gerekirse aracı tekrar çağır."}';

test('compact: estimateTokens içerik ve tool_calls uzunluğunu sayar', () => {
  assert.equal(estimateTokens([]), 0);
  assert.equal(estimateTokens([{ role: 'user', content: '' }]), 4);
  assert.equal(estimateTokens([{ role: 'user', content: 'abcd' }]), 5);
  assert.equal(estimateTokens([{ role: 'user', content: 'abcde' }]), 6); // ceil(5/4)=2
  const calls = [{ id: 'c1', type: 'function', function: { name: 'x', arguments: '{}' } }];
  const withCalls = { role: 'assistant', content: 'ab', tool_calls: calls };
  const expected = Math.ceil((2 + JSON.stringify(calls).length) / 4) + 4;
  assert.equal(estimateTokens([withCalls]), expected);
  assert.equal(
    estimateTokens([{ role: 'user', content: 'abcd' }, withCalls]),
    5 + expected
  );
  // Büyük içerik büyük tahmin üretir
  assert.ok(estimateTokens([{ role: 'user', content: 'x'.repeat(4000) }]) >= 1000);
});

test('compact: trimOldToolOutputs son N araç çıktısını korur, girdiyi değiştirmez', () => {
  const big = 'y'.repeat(301);
  const small = 'k'.repeat(300);
  const input = [
    { role: 'system', content: 'S' },
    { role: 'user', content: big },
    { role: 'assistant', content: '', tool_calls: [{ id: 'a' }] },
    { role: 'tool', tool_call_id: 'a', content: big },
    { role: 'tool', tool_call_id: 'b', content: small },
    { role: 'tool', tool_call_id: 'c', content: big },
    { role: 'assistant', content: big },
    { role: 'tool', tool_call_id: 'd', content: big },
    { role: 'tool', tool_call_id: 'e', content: big },
  ];
  const snapshot = JSON.parse(JSON.stringify(input));
  const out = trimOldToolOutputs(input, { keepRecent: 2 });

  assert.notEqual(out, input);
  assert.deepEqual(input, snapshot);
  assert.equal(out.length, input.length);
  assert.deepEqual(out.map((m) => m.role), input.map((m) => m.role));
  assert.equal(out[1].content, big); // user aynen
  assert.equal(out[3].content, TRUNC);
  assert.equal(out[3].tool_call_id, 'a');
  assert.equal(out[4].content, small); // 300 karakter: kısaltılmaz
  assert.equal(out[5].content, TRUNC);
  assert.equal(out[6].content, big); // assistant aynen
  assert.equal(out[7].content, big); // son 2 tool korunur
  assert.equal(out[8].content, big);
  assert.equal(TRUNCATED_TOOL_OUTPUT, TRUNC);

  // Varsayılan keepRecent = 6
  const many = [];
  for (let i = 0; i < 8; i++) many.push({ role: 'tool', tool_call_id: 'c' + i, content: big });
  const out2 = trimOldToolOutputs(many);
  assert.deepEqual(
    out2.map((m) => m.content === TRUNC),
    [true, true, false, false, false, false, false, false]
  );
});

test('compact: summarizeHistory doğru sistem metniyle toolChoice none çağırır', async () => {
  const calls = [];
  const model = {
    async complete(req) {
      calls.push(req);
      return { content: '  Özet metni  ', toolCalls: [], usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } };
    },
  };
  const longOut = 'z'.repeat(2500);
  const signal = new AbortController().signal;
  const res = await summarizeHistory({
    model,
    signal,
    messages: [
      { role: 'user', content: 'a.txt oku' },
      {
        role: 'assistant',
        content: 'Okuyorum',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } }],
      },
      { role: 'tool', tool_call_id: 'c1', content: longOut },
      { role: 'assistant', content: 'Bitti' },
    ],
  });

  assert.equal(res.summary, 'Özet metni');
  assert.deepEqual(res.usage, { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 });
  assert.equal(calls.length, 1);
  const req = calls[0];
  assert.equal(req.toolChoice, 'none');
  assert.deepEqual(req.tools, []);
  assert.equal(req.signal, signal);
  assert.equal(typeof req.onDelta, 'function');
  assert.equal(req.messages.length, 2);
  assert.deepEqual(req.messages[0], { role: 'system', content: EXPECTED_SYSTEM });
  assert.equal(SUMMARY_SYSTEM_PROMPT, EXPECTED_SYSTEM);
  assert.equal(req.messages[1].role, 'user');
  const u = req.messages[1].content;
  assert.match(u, /^user: a\.txt oku$/m);
  assert.ok(u.includes('assistant: Okuyorum [araç: read_file {"path":"a.txt"}]'));
  assert.ok(u.includes('tool: ' + 'z'.repeat(2000)));
  assert.ok(!u.includes('z'.repeat(2001)));
  assert.match(u, /^assistant: Bitti$/m);
});

test('compact: summarizeHistory boş cevapta fırlatır', async () => {
  for (const content of ['', '   ', null, undefined]) {
    const model = { async complete() { return { content, toolCalls: [] }; } };
    await assert.rejects(
      summarizeHistory({ model, messages: [{ role: 'user', content: 'x' }] }),
      { message: 'Özet çıkarılamadı.' }
    );
  }
});
