'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createSessionLog, deriveMessages } = require('../sessionLog.cjs');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'km-session-test-'));
}

test('sessionLog: geçersiz oturum kimliğini reddeder', () => {
  const dir = makeTempDir();
  try {
    for (const badId of ['', 'a/b', 'a..b', 'boşluk var', 'oturum.1']) {
      assert.throws(
        () => createSessionLog({ dir, sessionId: badId }),
        { message: 'Geçersiz oturum kimliği.' }
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sessionLog: seq artar, yeniden açılınca devam eder, dosya yalnızca büyür, bozuk satır atlanır', () => {
  const dir = makeTempDir();
  try {
    let t = 1000;
    const log1 = createSessionLog({
      dir: path.join(dir, 'alt-klasor'),
      sessionId: 'oturum_01-A',
      now: () => new Date(t++ * 1000),
    });

    log1.append({ type: 'turn/start' });
    log1.append({ type: 'user/message', content: 'Merhaba' });
    const sizeAfterTwo = fs.statSync(log1.path).size;
    assert.ok(sizeAfterTwo > 0);

    // Araya bozuk JSON satırı ekle
    fs.appendFileSync(log1.path, '{bozuk_satir\n', 'utf8');

    // Yeniden aç ve devam et
    const log2 = createSessionLog({
      dir: path.join(dir, 'alt-klasor'),
      sessionId: 'oturum_01-A',
      now: () => new Date(t++ * 1000),
    });

    log2.append({ type: 'assistant/message', content: 'Selam!' });
    const sizeAfterThree = fs.statSync(log2.path).size;
    assert.ok(sizeAfterThree > sizeAfterTwo);

    const events = log2.read();
    assert.equal(events.length, 3);
    assert.deepEqual(
      events.map((e) => [e.seq, e.type]),
      [
        [1, 'turn/start'],
        [2, 'user/message'],
        [3, 'assistant/message'],
      ]
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('deriveMessages: olayları dönüştürür, diğerlerini atlar, yarım kalan araç çağrısını tamamlar', () => {
  const events = [
    { seq: 1, type: 'turn/start' },
    { seq: 2, type: 'user/message', content: 'Dosyayı oku' },
    { seq: 3, type: 'step/start', step: 1 },
    {
      seq: 4,
      type: 'assistant/message',
      content: 'Okuyorum',
      tool_calls: [
        { id: 'c1', name: 'read_file', arguments: '{"path":"a.txt"}' },
        { id: 'c2', type: 'function', function: { name: 'read_file', arguments: '{"path":"b.txt"}' } },
      ],
    },
    { seq: 5, type: 'tool/start', callId: 'c1', name: 'read_file', args: { path: 'a.txt' } },
    { seq: 6, type: 'tool/result', callId: 'c1', name: 'read_file', ok: true, content: '{"ok":true,"result":"icerik"}' },
    // c2 için sonuç yok, tur yarıda kaldı
  ];

  const messages = deriveMessages(events);
  assert.deepEqual(messages, [
    { role: 'user', content: 'Dosyayı oku' },
    {
      role: 'assistant',
      content: 'Okuyorum',
      tool_calls: [
        { id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } },
        { id: 'c2', type: 'function', function: { name: 'read_file', arguments: '{"path":"b.txt"}' } },
      ],
    },
    { role: 'tool', tool_call_id: 'c1', content: '{"ok":true,"result":"icerik"}' },
    {
      role: 'tool',
      tool_call_id: 'c2',
      content: '{"ok":false,"error":"Araç sonucu yok (tur yarıda kaldı)."}',
    },
  ]);
});


// ---- Aşama 4a: bağlam sıkıştırma, oturum listesi, plan geri yükleme ----
const sessionLogModule = require('../sessionLog.cjs');

test('deriveMessages: context/compact sonrası özetle başlar, eski olayları atlar', () => {
  const events = [
    { seq: 1, type: 'turn/start' },
    { seq: 2, type: 'user/message', content: 'eski istek' },
    { seq: 3, type: 'assistant/message', content: 'eski cevap' },
    { seq: 4, type: 'turn/end', status: 'completed' },
    { seq: 5, type: 'turn/start' },
    { seq: 6, type: 'user/message', content: 'yeni istek' },
    { seq: 7, type: 'context/compact', summary: 'ilk özet', uptoSeq: 2 },
    { seq: 8, type: 'context/compact', summary: 'Kullanıcı eski bir şey istedi.', uptoSeq: 4 },
    { seq: 9, type: 'assistant/message', content: 'yeni cevap' },
  ];
  assert.deepEqual(deriveMessages(events), [
    { role: 'user', content: '[Önceki konuşmanın özeti]\nKullanıcı eski bir şey istedi.' },
    { role: 'assistant', content: 'Anladım, özetten devam ediyorum.' },
    { role: 'user', content: 'yeni istek' },
    { role: 'assistant', content: 'yeni cevap' },
  ]);
});

test('deriveMessages: sınırdan sonra sahibi olmayan tool mesajı atılır', () => {
  const events = [
    { seq: 1, type: 'turn/start' },
    { seq: 2, type: 'user/message', content: 'oku' },
    {
      seq: 3,
      type: 'assistant/message',
      content: '',
      tool_calls: [{ id: 'eski', name: 'read_file', arguments: '{}' }],
    },
    { seq: 4, type: 'tool/result', callId: 'eski', ok: true, content: '{"ok":true}' },
    { seq: 5, type: 'turn/start' },
    { seq: 6, type: 'user/message', content: 'devam' },
    {
      seq: 7,
      type: 'assistant/message',
      content: '',
      tool_calls: [{ id: 'yeni', name: 'read_file', arguments: '{}' }],
    },
    { seq: 8, type: 'tool/result', callId: 'yeni', ok: true, content: '{"ok":true,"y":1}' },
    { seq: 9, type: 'context/compact', summary: 'ÖZET', uptoSeq: 3 },
  ];
  const msgs = deriveMessages(events);
  assert.deepEqual(msgs.map((m) => m.role), ['user', 'assistant', 'user', 'assistant', 'tool']);
  assert.equal(msgs[0].content, '[Önceki konuşmanın özeti]\nÖZET');
  assert.equal(msgs[4].tool_call_id, 'yeni');
  assert.ok(!msgs.some((m) => m.tool_call_id === 'eski'));
});

function writeSession(dir, id, events) {
  fs.writeFileSync(
    path.join(dir, id + '.jsonl'),
    events.map((e) => JSON.stringify(e)).join('\n') + '\n',
    'utf8'
  );
}

test('listSessions: sıralama, başlık, tur sayısı, bozuk dosya, klasör yok', () => {
  const { listSessions } = sessionLogModule;
  const dir = makeTempDir();
  try {
    assert.deepEqual(listSessions(path.join(dir, 'yok')), []);

    writeSession(dir, 'eski', [
      { seq: 1, type: 'turn/start', at: '2026-01-01T10:00:00.000Z' },
      { seq: 2, type: 'user/message', content: '  Birinci\n  satır\tve ikinci   ', at: '2026-01-01T10:00:01.000Z' },
      { seq: 3, type: 'turn/end', at: '2026-01-01T10:00:05.000Z' },
    ]);
    writeSession(dir, 'yeni', [
      { seq: 1, type: 'turn/start', at: '2026-02-01T10:00:00.000Z' },
      { seq: 2, type: 'user/message', content: 'a'.repeat(80), at: '2026-02-01T10:00:01.000Z' },
      { seq: 3, type: 'turn/end', at: '2026-02-01T10:00:02.000Z' },
      { seq: 4, type: 'turn/start', at: '2026-02-01T11:00:00.000Z' },
      { seq: 5, type: 'user/message', content: 'ikinci mesaj', at: '2026-02-01T11:00:01.000Z' },
    ]);
    writeSession(dir, 'adsiz', [{ seq: 1, type: 'turn/start', at: '2026-01-15T00:00:00.000Z' }]);
    // Bozuk satır içeren ama okunabilir dosya
    fs.writeFileSync(
      path.join(dir, 'yarim.jsonl'),
      '{bozuk\n' + JSON.stringify({ seq: 1, type: 'user/message', content: 'yarım', at: '2025-12-01T00:00:00.000Z' }) + '\n',
      'utf8'
    );
    // Tamamen bozuk dosya ve okunamayan "dosya" (klasör)
    fs.writeFileSync(path.join(dir, 'cop.jsonl'), 'bozuk\n{{{\n', 'utf8');
    fs.mkdirSync(path.join(dir, 'klasor.jsonl'));
    fs.writeFileSync(path.join(dir, 'notlar.txt'), 'alakasız', 'utf8');

    const list = listSessions(dir);
    assert.deepEqual(list.map((s) => s.sessionId), ['yeni', 'adsiz', 'eski', 'yarim']);
    assert.deepEqual(list[0], {
      sessionId: 'yeni',
      title: 'a'.repeat(60),
      updatedAt: '2026-02-01T11:00:01.000Z',
      turns: 2,
    });
    assert.deepEqual(list[1], {
      sessionId: 'adsiz',
      title: 'Adsız oturum',
      updatedAt: '2026-01-15T00:00:00.000Z',
      turns: 1,
    });
    assert.equal(list[2].title, 'Birinci satır ve ikinci');
    assert.equal(list[2].turns, 1);
    assert.equal(list[2].updatedAt, '2026-01-01T10:00:05.000Z');
    assert.equal(list[3].title, 'yarım');
    assert.equal(list[3].turns, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('listSessions: en fazla 100 oturum döner', () => {
  const { listSessions } = sessionLogModule;
  const dir = makeTempDir();
  try {
    for (let i = 0; i < 105; i++) {
      const at = new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString();
      writeSession(dir, 'o' + i, [{ seq: 1, type: 'turn/start', at }]);
    }
    const list = listSessions(dir);
    assert.equal(list.length, 100);
    assert.equal(list[0].sessionId, 'o104');
    assert.equal(list[99].sessionId, 'o5');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('restorePlan: son başarılı update_plan sonucunu döndürür', () => {
  const { restorePlan } = sessionLogModule;
  const ok1 = JSON.stringify({ ok: true, result: { items: [{ content: 'A', status: 'pending' }] } });
  const ok2 = JSON.stringify({ ok: true, result: { items: [{ content: 'B', status: 'completed' }] } });
  const fail = JSON.stringify({ ok: false, error: 'Geçersiz alan: items' });
  assert.deepEqual(restorePlan([]), []);
  assert.deepEqual(restorePlan(undefined), []);
  assert.deepEqual(
    restorePlan([
      { seq: 1, type: 'tool/result', name: 'update_plan', ok: true, content: ok1 },
      { seq: 2, type: 'tool/result', name: 'update_plan', ok: true, content: ok2 },
      { seq: 3, type: 'tool/result', name: 'update_plan', ok: false, content: fail },
      { seq: 4, type: 'tool/result', name: 'read_file', ok: true, content: ok1 },
    ]),
    [{ content: 'B', status: 'completed' }]
  );
  // Son başarılı sonucun items'ı geçersizse boş dizi
  const bad = JSON.stringify({ ok: true, truncated: true, result: '{"ok":true,"result":{"items":[' });
  assert.deepEqual(
    restorePlan([
      { seq: 1, type: 'tool/result', name: 'update_plan', ok: true, content: ok1 },
      { seq: 2, type: 'tool/result', name: 'update_plan', ok: true, content: bad },
    ]),
    []
  );
  assert.deepEqual(
    restorePlan([{ seq: 1, type: 'tool/result', name: 'update_plan', ok: true, content: '{bozuk' }]),
    []
  );
});

// ---- Aşama 5a: bellek içi kayıt ----
const { createMemoryLog } = require('../sessionLog.cjs');

test('sessionLog: createMemoryLog seq artırır, at ekler, type zorunlu, diske yazmaz', () => {
  const dir = makeTempDir();
  try {
    const before = fs.readdirSync(dir);
    const log = createMemoryLog();
    assert.equal(log.path, null);
    assert.deepEqual(log.read(), []);
    const a = log.append({ type: 'turn/start' });
    const b = log.append({ type: 'user/message', content: 'selam' });
    assert.equal(a.seq, 1);
    assert.equal(b.seq, 2);
    assert.equal(typeof a.at, 'string');
    assert.ok(!Number.isNaN(Date.parse(a.at)));
    assert.throws(() => log.append({}), { message: 'Olay türü (type) zorunludur.' });
    assert.throws(() => log.append(null), { message: 'Olay türü (type) zorunludur.' });
    const events = log.read();
    assert.equal(events.length, 2);
    assert.equal(events[1].content, 'selam');
    // read kopya döner; dışarıdan değiştirmek kaydı bozmaz
    events.push({ type: 'x' });
    assert.equal(log.read().length, 2);
    assert.deepEqual(fs.readdirSync(dir), before);
    // İki kayıt birbirinden bağımsız
    assert.equal(createMemoryLog().append({ type: 't' }).seq, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('deriveMessages: extra_content li assistant/message olayi geri yuklenince alan korunur, olmayanda eklenmez', () => {
  const events = [
    { seq: 1, type: 'turn/start' },
    { seq: 2, type: 'user/message', content: 'Dosyayı oku' },
    {
      seq: 3,
      type: 'assistant/message',
      content: '',
      tool_calls: [
        {
          id: 'c1',
          name: 'read_file',
          arguments: '{"path":"a.txt"}',
          extra_content: { google: { thought_signature: 'sig_flat' } },
        },
        {
          id: 'c2',
          type: 'function',
          function: { name: 'read_file', arguments: '{"path":"b.txt"}' },
          extra_content: { google: { thought_signature: 'sig_fn' } },
        },
        {
          id: 'c3',
          type: 'function',
          function: { name: 'read_file', arguments: '{"path":"c.txt"}' },
        },
      ],
    },
    { seq: 4, type: 'tool/result', callId: 'c1', ok: true, content: '{"ok":true}' },
    { seq: 5, type: 'tool/result', callId: 'c2', ok: true, content: '{"ok":true}' },
    { seq: 6, type: 'tool/result', callId: 'c3', ok: true, content: '{"ok":true}' },
  ];

  const messages = deriveMessages(events);
  const assistantMsg = messages.find((m) => m.role === 'assistant');
  assert.ok(assistantMsg);
  assert.deepEqual(assistantMsg.tool_calls, [
    {
      id: 'c1',
      type: 'function',
      function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
      extra_content: { google: { thought_signature: 'sig_flat' } },
    },
    {
      id: 'c2',
      type: 'function',
      function: { name: 'read_file', arguments: '{"path":"b.txt"}' },
      extra_content: { google: { thought_signature: 'sig_fn' } },
    },
    {
      id: 'c3',
      type: 'function',
      function: { name: 'read_file', arguments: '{"path":"c.txt"}' },
    },
  ]);
  assert.equal('extra_content' in assistantMsg.tool_calls[2], false);
});
