'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { createWorkspace } = require('../workspace.cjs');
const { createDefaultTools } = require('../tools/index.cjs');
const { createToolRegistry } = require('../registry.cjs');
const { createSessionLog } = require('../sessionLog.cjs');
const { createApprovalPolicy } = require('../approvals.cjs');
const { runAgentTurn } = require('../loop.cjs');

// Sahte model oluşturucu: sırayla verilen cevapları döndürür ve çağrıları kaydeder
function createFakeModel(responses) {
  let idx = 0;
  const calls = [];
  return {
    calls,
    async complete({ messages, tools, toolChoice, signal, onDelta }) {
      calls.push({
        messages: JSON.parse(JSON.stringify(messages)),
        tools,
        toolChoice,
      });
      const stepSpec = responses[idx++];
      if (!stepSpec) {
        return { content: 'Varsayılan bitti', toolCalls: [], usage: null };
      }
      if (typeof stepSpec === 'function') {
        return stepSpec({ messages, tools, toolChoice, signal, onDelta });
      }
      if (stepSpec.error) {
        throw stepSpec.error;
      }
      if (Array.isArray(stepSpec.deltas) && typeof onDelta === 'function') {
        for (const d of stepSpec.deltas) {
          onDelta(d);
        }
      }
      return {
        content: stepSpec.content ?? '',
        toolCalls: stepSpec.toolCalls ?? [],
        usage: stepSpec.usage ?? null,
      };
    },
  };
}

function makeEnv({ mode = 'ask', tools = null, sessionId = 'test_session' } = {}) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-loop-ws-'));
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-loop-log-'));
  const workspace = createWorkspace(rootDir);
  const registry = createToolRegistry(tools || createDefaultTools());
  const log = createSessionLog({ dir: sessionDir, sessionId });
  const policy = createApprovalPolicy({ mode });
  const session = { plan: [] };
  const events = [];

  return {
    rootDir,
    sessionDir,
    workspace,
    registry,
    log,
    policy,
    session,
    events,
    onEvent(ev) {
      events.push(ev);
    },
    cleanup() {
      fs.rmSync(rootDir, { recursive: true, force: true });
      fs.rmSync(sessionDir, { recursive: true, force: true });
    },
  };
}

// 1. araçsız cevap
test('loop 1: araçsız cevap tek adımda completed döner ve olayları kaydeder', async () => {
  const env = makeEnv();
  try {
    const model = createFakeModel([
      {
        content: 'Merhaba, nasıl yardımcı olabilirim?',
        toolCalls: [],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      },
    ]);

    const res = await runAgentTurn({
      model,
      registry: env.registry,
      workspace: env.workspace,
      log: env.log,
      policy: env.policy,
      session: env.session,
      systemPrompt: 'Sistem',
      userMessage: 'Selam',
      onEvent: env.onEvent,
    });

    assert.equal(res.status, 'completed');
    assert.equal(res.text, 'Merhaba, nasıl yardımcı olabilirim?');
    assert.equal(res.steps, 1);
    assert.equal(res.toolCalls, 0);
    assert.equal(res.limitReached, null);
    assert.deepEqual(res.usage, { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });

    const types = env.log.read().map((e) => e.type);
    assert.deepEqual(types, [
      'turn/start',
      'user/message',
      'step/start',
      'assistant/message',
      'turn/end',
    ]);
  } finally {
    env.cleanup();
  }
});

// 2. okuma aracı çağrısı
test('loop 2: okuma aracı çalışır ve ikinci model çağrısında tool rolüyle yer alır', async () => {
  const env = makeEnv();
  try {
    fs.writeFileSync(path.join(env.rootDir, 'a.txt'), 'icerik_a', 'utf8');
    const model = createFakeModel([
      {
        content: '',
        toolCalls: [{ id: 'c1', name: 'read_file', arguments: JSON.stringify({ path: 'a.txt' }) }],
      },
      {
        content: 'Dosyada icerik_a yazıyor.',
        toolCalls: [],
      },
    ]);

    const res = await runAgentTurn({
      model,
      registry: env.registry,
      workspace: env.workspace,
      log: env.log,
      policy: env.policy,
      session: env.session,
      systemPrompt: 'Sistem',
      userMessage: 'a.txt oku',
    });

    assert.equal(res.status, 'completed');
    assert.equal(res.steps, 2);
    assert.equal(res.toolCalls, 1);
    const secondCallMessages = model.calls[1].messages;
    const toolMsg = secondCallMessages.find((m) => m.role === 'tool');
    assert.ok(toolMsg);
    assert.equal(toolMsg.tool_call_id, 'c1');
    const parsed = JSON.parse(toolMsg.content);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.result.content, '1\ticerik_a');
  } finally {
    env.cleanup();
  }
});

// 3. iki okuma aracı paralel başlar ve sonuçlar çağrı sırasıyla kayda geçer
test('loop 3: iki okuma aracı paralel başlar ve sonuçlar çağrı sırasıyla kayda geçer', async () => {
  const trace = [];
  let startedCount = 0;
  let bothStarted = false;

  const slowReadTool = {
    name: 'slow_read',
    description: 'Test okuma aracı',
    risk: 'read',
    jsonSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, delay: { type: 'integer' } },
      required: ['id', 'delay'],
      additionalProperties: false,
    },
    validate(raw) {
      return { id: raw.id, delay: raw.delay };
    },
    async execute(args) {
      trace.push(`start:${args.id}`);
      startedCount += 1;
      if (startedCount === 2) bothStarted = true;
      await new Promise((r) => setTimeout(r, args.delay));
      trace.push(`end:${args.id}`);
      return { id: args.id };
    },
  };

  const env = makeEnv({ tools: [slowReadTool] });
  try {
    const model = createFakeModel([
      {
        content: '',
        toolCalls: [
          { id: 'call_1', name: 'slow_read', arguments: JSON.stringify({ id: 'bir', delay: 60 }) },
          { id: 'call_2', name: 'slow_read', arguments: JSON.stringify({ id: 'iki', delay: 10 }) },
        ],
      },
      { content: 'Tamam', toolCalls: [] },
    ]);

    const res = await runAgentTurn({
      model,
      registry: env.registry,
      workspace: env.workspace,
      log: env.log,
      policy: env.policy,
      session: env.session,
      systemPrompt: 'Sistem',
      userMessage: 'İkisini oku',
    });

    assert.equal(res.status, 'completed');
    assert.equal(bothStarted, true);
    // İkisi de bitmeden ikisi de başlamış olmalı
    assert.deepEqual(trace.slice(0, 2), ['start:bir', 'start:iki']);

    const resultEvents = env.log.read().filter((e) => e.type === 'tool/result');
    assert.deepEqual(
      resultEvents.map((e) => e.callId),
      ['call_1', 'call_2']
    );
  } finally {
    env.cleanup();
  }
});

// 4. okuma + yazma aynı adımdaysa sırayla çalışır
test('loop 4: okuma ve yazma aynı adımdaysa sırayla çalışır', async () => {
  const order = [];
  const readT = {
    name: 'r_tool',
    description: 'Okuma',
    risk: 'read',
    jsonSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    validate: () => ({}),
    async execute() {
      order.push('r:start');
      await new Promise((r) => setTimeout(r, 40));
      order.push('r:end');
      return { ok: 1 };
    },
  };
  const writeT = {
    name: 'w_tool',
    description: 'Yazma',
    risk: 'write',
    jsonSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    validate: () => ({}),
    async execute() {
      order.push('w:start');
      await new Promise((r) => setTimeout(r, 10));
      order.push('w:end');
      return { ok: 2 };
    },
  };

  const env = makeEnv({ mode: 'auto-edit', tools: [readT, writeT] });
  try {
    const model = createFakeModel([
      {
        content: '',
        toolCalls: [
          { id: 'c1', name: 'r_tool', arguments: '{}' },
          { id: 'c2', name: 'w_tool', arguments: '{}' },
        ],
      },
      { content: 'Bitti', toolCalls: [] },
    ]);

    await runAgentTurn({
      model,
      registry: env.registry,
      workspace: env.workspace,
      log: env.log,
      policy: env.policy,
      session: env.session,
      systemPrompt: 'S',
      userMessage: 'Çalıştır',
    });

    assert.deepEqual(order, ['r:start', 'r:end', 'w:start', 'w:end']);
  } finally {
    env.cleanup();
  }
});

// 5. yazma aracı ask modunda onay ister; onaylanınca dosya yazılır; preview before/after taşır
test('loop 5: yazma aracı ask modunda onay ister ve preview before/after taşır', async () => {
  const env = makeEnv({ mode: 'ask' });
  try {
    fs.writeFileSync(path.join(env.rootDir, 'not.txt'), 'eski', 'utf8');
    const approvals = [];

    const model = createFakeModel([
      {
        content: '',
        toolCalls: [
          {
            id: 'c1',
            name: 'write_file',
            arguments: JSON.stringify({ path: 'not.txt', content: 'yeni' }),
          },
        ],
      },
      { content: 'Yazıldı', toolCalls: [] },
    ]);

    const res = await runAgentTurn({
      model,
      registry: env.registry,
      workspace: env.workspace,
      log: env.log,
      policy: env.policy,
      session: env.session,
      systemPrompt: 'S',
      userMessage: 'Değiştir',
      async requestApproval(req) {
        approvals.push(req);
        return { approved: true };
      },
    });

    assert.equal(res.status, 'completed');
    assert.equal(approvals.length, 1);
    assert.deepEqual(approvals[0].preview, {
      path: 'not.txt',
      before: 'eski',
      after: 'yeni',
    });
    assert.equal(fs.readFileSync(path.join(env.rootDir, 'not.txt'), 'utf8'), 'yeni');
  } finally {
    env.cleanup();
  }
});

// 6. onay reddedilince dosya yazılmaz ve çıktı "Kullanıcı işlemi onaylamadı." olur
test('loop 6: onay reddedilince dosya yazılmaz ve uygun hata döner', async () => {
  const env = makeEnv({ mode: 'ask' });
  try {
    const model = createFakeModel([
      {
        content: '',
        toolCalls: [
          {
            id: 'c1',
            name: 'write_file',
            arguments: JSON.stringify({ path: 'yeni.txt', content: 'merhaba' }),
          },
        ],
      },
      { content: 'Anlaşıldı', toolCalls: [] },
    ]);

    await runAgentTurn({
      model,
      registry: env.registry,
      workspace: env.workspace,
      log: env.log,
      policy: env.policy,
      session: env.session,
      systemPrompt: 'S',
      userMessage: 'Yaz',
      async requestApproval() {
        return { approved: false };
      },
    });

    assert.equal(fs.existsSync(path.join(env.rootDir, 'yeni.txt')), false);
    const toolResult = env.log.read().find((e) => e.type === 'tool/result');
    assert.equal(toolResult.ok, false);
    assert.deepEqual(JSON.parse(toolResult.content), {
      ok: false,
      error: 'Kullanıcı işlemi onaylamadı.',
    });
  } finally {
    env.cleanup();
  }
});

// 7. geçersiz parametrede onay istenmez ve araç çalışmaz
test('loop 7: geçersiz parametrede onay istenmez ve araç çalışmaz', async () => {
  const env = makeEnv({ mode: 'ask' });
  try {
    let approvalAsked = false;
    const model = createFakeModel([
      {
        content: '',
        toolCalls: [
          {
            id: 'c1',
            name: 'write_file',
            arguments: JSON.stringify({ path: 'a.txt' }), // content eksik
          },
        ],
      },
      { content: 'Hata alındı', toolCalls: [] },
    ]);

    await runAgentTurn({
      model,
      registry: env.registry,
      workspace: env.workspace,
      log: env.log,
      policy: env.policy,
      session: env.session,
      systemPrompt: 'S',
      userMessage: 'Yaz',
      async requestApproval() {
        approvalAsked = true;
        return { approved: true };
      },
    });

    assert.equal(approvalAsked, false);
    const toolResult = env.log.read().find((e) => e.type === 'tool/result');
    const parsed = JSON.parse(toolResult.content);
    assert.equal(parsed.ok, false);
    assert.ok(parsed.error.startsWith('Geçersiz parametre: '));
  } finally {
    env.cleanup();
  }
});

// 8. read-only modda yazma "Bu modda bu işlem kapalı." döner
test('loop 8: read-only modda yazma işlemi reddedilir', async () => {
  const env = makeEnv({ mode: 'read-only' });
  try {
    const model = createFakeModel([
      {
        content: '',
        toolCalls: [
          {
            id: 'c1',
            name: 'write_file',
            arguments: JSON.stringify({ path: 'a.txt', content: 'x' }),
          },
        ],
      },
      { content: 'Salt okuma', toolCalls: [] },
    ]);

    await runAgentTurn({
      model,
      registry: env.registry,
      workspace: env.workspace,
      log: env.log,
      policy: env.policy,
      session: env.session,
      systemPrompt: 'S',
      userMessage: 'Yaz',
    });

    const toolResult = env.log.read().find((e) => e.type === 'tool/result');
    assert.deepEqual(JSON.parse(toolResult.content), {
      ok: false,
      error: 'Bu modda bu işlem kapalı.',
    });
  } finally {
    env.cleanup();
  }
});

// 9. auto-edit modda yazma onaysız çalışır, run_command onay ister
test('loop 9: auto-edit modda yazma onaysız çalışır, run_command onay ister', async () => {
  const env = makeEnv({ mode: 'auto-edit' });
  try {
    const approvalCalls = [];
    const model = createFakeModel([
      {
        content: '',
        toolCalls: [
          {
            id: 'c1',
            name: 'write_file',
            arguments: JSON.stringify({ path: 'oto.txt', content: 'tamam' }),
          },
          {
            id: 'c2',
            name: 'run_command',
            arguments: JSON.stringify({ command: 'node -e "process.exit(0)"' }),
          },
        ],
      },
      { content: 'Bitti', toolCalls: [] },
    ]);

    await runAgentTurn({
      model,
      registry: env.registry,
      workspace: env.workspace,
      log: env.log,
      policy: env.policy,
      session: env.session,
      systemPrompt: 'S',
      userMessage: 'Yaz ve çalıştır',
      async requestApproval(req) {
        approvalCalls.push(req);
        return { approved: true };
      },
    });

    assert.equal(fs.readFileSync(path.join(env.rootDir, 'oto.txt'), 'utf8'), 'tamam');
    assert.equal(approvalCalls.length, 1);
    assert.equal(approvalCalls[0].callId, 'c2');
  } finally {
    env.cleanup();
  }
});

// 10. tehlikeli komut auto-edit modda da onay ister
test('loop 10: tehlikeli komut auto-edit modda da onay ister', async () => {
  const env = makeEnv({ mode: 'auto-edit' });
  try {
    const approvalCalls = [];
    const model = createFakeModel([
      {
        content: '',
        toolCalls: [
          {
            id: 'c1',
            name: 'run_command',
            arguments: JSON.stringify({ command: 'git push origin main' }),
          },
        ],
      },
      { content: 'İptal edildi', toolCalls: [] },
    ]);

    await runAgentTurn({
      model,
      registry: env.registry,
      workspace: env.workspace,
      log: env.log,
      policy: env.policy,
      session: env.session,
      systemPrompt: 'S',
      userMessage: 'Pushla',
      async requestApproval(req) {
        approvalCalls.push(req);
        return { approved: false };
      },
    });

    assert.equal(approvalCalls.length, 1);
  } finally {
    env.cleanup();
  }
});

// 11. maxSteps dolunca son adım toolChoice: 'none' ile gider ve limitReached: 'steps'
test('loop 11: maxSteps dolunca son adım toolChoice none ile gider ve limitReached steps olur', async () => {
  const env = makeEnv();
  try {
    fs.writeFileSync(path.join(env.rootDir, 'a.txt'), 'merhaba', 'utf8');
    const model = createFakeModel([
      {
        content: '',
        toolCalls: [{ id: 'c1', name: 'read_file', arguments: JSON.stringify({ path: 'a.txt' }) }],
      },
      {
        content: '', // Boş bırakılırsa varsayılan sınır mesajı dönmeli
        toolCalls: [{ id: 'c2', name: 'read_file', arguments: JSON.stringify({ path: 'a.txt' }) }],
      },
    ]);

    const res = await runAgentTurn({
      model,
      registry: env.registry,
      workspace: env.workspace,
      log: env.log,
      policy: env.policy,
      session: env.session,
      systemPrompt: 'S',
      userMessage: 'Oku',
      limits: { maxSteps: 2 },
    });

    assert.equal(model.calls[0].toolChoice, 'auto');
    assert.equal(model.calls[1].toolChoice, 'none');
    assert.equal(res.status, 'completed');
    assert.equal(res.limitReached, 'steps');
    assert.equal(
      res.text,
      'Sınıra ulaştım ve net bir cevap çıkaramadım. Kaldığım yerden devam etmemi ister misin?'
    );
  } finally {
    env.cleanup();
  }
});

// 12. maxToolCalls aşılınca fazla çağrı çalıştırılmaz ve sonraki adım toolChoice: 'none'
test('loop 12: maxToolCalls aşılınca fazla çağrı çalıştırılmaz ve sonraki adım toolChoice none olur', async () => {
  const env = makeEnv();
  try {
    fs.writeFileSync(path.join(env.rootDir, '1.txt'), 'bir', 'utf8');
    fs.writeFileSync(path.join(env.rootDir, '2.txt'), 'iki', 'utf8');

    const model = createFakeModel([
      {
        content: '',
        toolCalls: [
          { id: 'c1', name: 'read_file', arguments: JSON.stringify({ path: '1.txt' }) },
          { id: 'c2', name: 'read_file', arguments: JSON.stringify({ path: '2.txt' }) },
        ],
      },
      { content: 'Sınırdayım', toolCalls: [] },
    ]);

    const res = await runAgentTurn({
      model,
      registry: env.registry,
      workspace: env.workspace,
      log: env.log,
      policy: env.policy,
      session: env.session,
      systemPrompt: 'S',
      userMessage: 'İkisini oku',
      limits: { maxToolCalls: 1 },
    });

    assert.equal(res.toolCalls, 1);
    assert.equal(res.limitReached, 'tool_calls');
    assert.equal(model.calls[1].toolChoice, 'none');

    const results = env.log.read().filter((e) => e.type === 'tool/result');
    assert.equal(results.length, 2);
    assert.equal(results[0].ok, true);
    assert.deepEqual(JSON.parse(results[1].content), {
      ok: false,
      error: 'Araç çağrısı sınırına ulaşıldı.',
    });
  } finally {
    env.cleanup();
  }
});

// 13. süre dolunca (sahte now) limitReached: 'time'
test('loop 13: süre dolunca limitReached time döner', async () => {
  const env = makeEnv();
  try {
    fs.writeFileSync(path.join(env.rootDir, 'a.txt'), 'x', 'utf8');
    let currentNow = 1000;

    const model = createFakeModel([
      () => {
        currentNow += 5000;
        return {
          content: '',
          toolCalls: [{ id: 'c1', name: 'read_file', arguments: JSON.stringify({ path: 'a.txt' }) }],
        };
      },
      { content: 'Süre bitti cevabı', toolCalls: [] },
    ]);

    const res = await runAgentTurn({
      model,
      registry: env.registry,
      workspace: env.workspace,
      log: env.log,
      policy: env.policy,
      session: env.session,
      systemPrompt: 'S',
      userMessage: 'Başla',
      limits: { maxWallTimeMs: 3000 },
      now: () => currentNow,
    });

    assert.equal(res.status, 'completed');
    assert.equal(res.limitReached, 'time');
    assert.equal(model.calls[1].toolChoice, 'none');
    assert.equal(res.text, 'Süre bitti cevabı');
  } finally {
    env.cleanup();
  }
});

// 14. okuma aracı bir kez fırlatıp ikincide başarırsa sonuç başarılı; yazma aracı fırlatırsa yeniden denenmez
test('loop 14: okuma aracı hata verirse 1 kez yeniden denenir, yazma aracı yeniden denenmez', async () => {
  let readAttempts = 0;
  let writeAttempts = 0;

  const flakyRead = {
    name: 'flaky_read',
    description: 'İlkinde hata veren okuma',
    risk: 'read',
    jsonSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    validate: () => ({}),
    async execute() {
      readAttempts += 1;
      if (readAttempts === 1) throw new Error('Geçici okuma hatası');
      return { veri: 'okundu' };
    },
  };

  const failingWrite = {
    name: 'fail_write',
    description: 'Hata veren yazma',
    risk: 'write',
    jsonSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    validate: () => ({}),
    async execute() {
      writeAttempts += 1;
      throw new Error('Yazma hatası');
    },
  };

  const env = makeEnv({ mode: 'auto-edit', tools: [flakyRead, failingWrite] });
  try {
    const model = createFakeModel([
      {
        content: '',
        toolCalls: [
          { id: 'c1', name: 'flaky_read', arguments: '{}' },
          { id: 'c2', name: 'fail_write', arguments: '{}' },
        ],
      },
      { content: 'Tamam', toolCalls: [] },
    ]);

    await runAgentTurn({
      model,
      registry: env.registry,
      workspace: env.workspace,
      log: env.log,
      policy: env.policy,
      session: env.session,
      systemPrompt: 'S',
      userMessage: 'Dene',
    });

    assert.equal(readAttempts, 2);
    assert.equal(writeAttempts, 1);

    const results = env.log.read().filter((e) => e.type === 'tool/result');
    assert.equal(results[0].ok, true);
    assert.equal(results[1].ok, false);
  } finally {
    env.cleanup();
  }
});

// 15. aynı okuma çağrısı ikinci kez çalıştırılmaz
test('loop 15: aynı tur içinde aynı okuma çağrısı ikinci kez çalıştırılmaz, önceki çıktı verilir', async () => {
  let execCount = 0;
  const countedRead = {
    name: 'counted_read',
    description: 'Sayılan okuma',
    risk: 'read',
    jsonSchema: {
      type: 'object',
      properties: { key: { type: 'string' } },
      required: ['key'],
      additionalProperties: false,
    },
    validate: (raw) => ({ key: raw.key }),
    async execute(args) {
      execCount += 1;
      return { key: args.key, count: execCount };
    },
  };

  const env = makeEnv({ tools: [countedRead] });
  try {
    const model = createFakeModel([
      {
        content: '',
        toolCalls: [{ id: 'c1', name: 'counted_read', arguments: JSON.stringify({ key: 'k1' }) }],
      },
      {
        content: '',
        toolCalls: [{ id: 'c2', name: 'counted_read', arguments: JSON.stringify({ key: 'k1' }) }],
      },
      { content: 'Bitti', toolCalls: [] },
    ]);

    await runAgentTurn({
      model,
      registry: env.registry,
      workspace: env.workspace,
      log: env.log,
      policy: env.policy,
      session: env.session,
      systemPrompt: 'S',
      userMessage: 'İki kez oku',
    });

    assert.equal(execCount, 1);
    const results = env.log.read().filter((e) => e.type === 'tool/result');
    assert.equal(results.length, 2);
    assert.deepEqual(JSON.parse(results[0].content), JSON.parse(results[1].content));
  } finally {
    env.cleanup();
  }
});

// 16. uzun araç çıktısı geçerli JSON olarak kısaltılır (JSON.parse başarılı, truncated: true)
test('loop 16: 12000 karakteri aşan araç çıktısı geçerli JSON olarak kısaltılır', async () => {
  const hugeTool = {
    name: 'huge_read',
    description: 'Büyük çıktı döner',
    risk: 'read',
    jsonSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    validate: () => ({}),
    async execute() {
      return { text: 'X'.repeat(15000) };
    },
  };

  const env = makeEnv({ tools: [hugeTool] });
  try {
    const model = createFakeModel([
      {
        content: '',
        toolCalls: [{ id: 'c1', name: 'huge_read', arguments: '{}' }],
      },
      { content: 'Kısaltılmış alındı', toolCalls: [] },
    ]);

    await runAgentTurn({
      model,
      registry: env.registry,
      workspace: env.workspace,
      log: env.log,
      policy: env.policy,
      session: env.session,
      systemPrompt: 'S',
      userMessage: 'Büyük oku',
    });

    const resEv = env.log.read().find((e) => e.type === 'tool/result');
    assert.ok(resEv.content.length <= 12000);
    const parsed = JSON.parse(resEv.content);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.truncated, true);
    assert.equal(parsed.result.length, 11000);
  } finally {
    env.cleanup();
  }
});

// 17. iptal: sinyal tur ortasında iptal edilince aborted döner ve turn/end yazılır
test('loop 17: sinyal iptal edilince aborted döner ve turn/end kayda yazılır', async () => {
  const env = makeEnv();
  try {
    const ac = new AbortController();
    const model = createFakeModel([
      () => {
        ac.abort();
        throw new Error('AbortError');
      },
    ]);

    const res = await runAgentTurn({
      model,
      registry: env.registry,
      workspace: env.workspace,
      log: env.log,
      policy: env.policy,
      session: env.session,
      systemPrompt: 'S',
      userMessage: 'Başla',
      signal: ac.signal,
    });

    assert.equal(res.status, 'aborted');
    const endEv = env.log.read().find((e) => e.type === 'turn/end');
    assert.ok(endEv);
    assert.equal(endEv.status, 'aborted');
  } finally {
    env.cleanup();
  }
});

// 18. model fırlatınca failed döner, döngü fırlatmaz
test('loop 18: model hata fırlatınca döngü fırlatmaz ve failed döner', async () => {
  const env = makeEnv();
  try {
    const model = createFakeModel([{ error: new Error('Sunucu bağlantı hatası') }]);

    const res = await runAgentTurn({
      model,
      registry: env.registry,
      workspace: env.workspace,
      log: env.log,
      policy: env.policy,
      session: env.session,
      systemPrompt: 'S',
      userMessage: 'Merhaba',
    });

    assert.equal(res.status, 'failed');
    assert.equal(res.error, 'Sunucu bağlantı hatası');
    const endEv = env.log.read().find((e) => e.type === 'turn/end');
    assert.ok(endEv);
    assert.equal(endEv.status, 'failed');
  } finally {
    env.cleanup();
  }
});

// 19. mesajlar kayıttan kurulur: aynı kayıtla ikinci bir tur çalıştırılınca model ilk turun mesajlarını da görür
test('loop 19: aynı kayıtla ikinci tur çalıştırılınca model ilk turun mesajlarını da görür', async () => {
  const env = makeEnv();
  try {
    const model1 = createFakeModel([{ content: 'Birinci cevap', toolCalls: [] }]);
    await runAgentTurn({
      model: model1,
      registry: env.registry,
      workspace: env.workspace,
      log: env.log,
      policy: env.policy,
      session: env.session,
      systemPrompt: 'Sistem',
      userMessage: 'Birinci soru',
    });

    const model2 = createFakeModel([{ content: 'İkinci cevap', toolCalls: [] }]);
    await runAgentTurn({
      model: model2,
      registry: env.registry,
      workspace: env.workspace,
      log: env.log,
      policy: env.policy,
      session: env.session,
      systemPrompt: 'Sistem',
      userMessage: 'İkinci soru',
    });

    assert.deepEqual(model2.calls[0].messages, [
      { role: 'system', content: 'Sistem' },
      { role: 'user', content: 'Birinci soru' },
      { role: 'assistant', content: 'Birinci cevap' },
      { role: 'user', content: 'İkinci soru' },
    ]);
  } finally {
    env.cleanup();
  }
});

// 20. assistant/delta onEvent'e gider ama kayda yazılmaz
test('loop 20: assistant/delta onEvent dinleyicisine gider ama kayda yazılmaz', async () => {
  const env = makeEnv();
  try {
    const model = createFakeModel([
      {
        deltas: ['Mer', 'haba'],
        content: 'Merhaba',
        toolCalls: [],
      },
    ]);

    await runAgentTurn({
      model,
      registry: env.registry,
      workspace: env.workspace,
      log: env.log,
      policy: env.policy,
      session: env.session,
      systemPrompt: 'Sistem',
      userMessage: 'Selam',
      onEvent: env.onEvent,
    });

    const deltaEvents = env.events.filter((e) => e.type === 'assistant/delta');
    assert.deepEqual(
      deltaEvents.map((e) => e.delta),
      ['Mer', 'haba']
    );

    const loggedDeltas = env.log.read().filter((e) => e.type === 'assistant/delta');
    assert.equal(loggedDeltas.length, 0);
  } finally {
    env.cleanup();
  }
});

// 21. tekrarlanan okuma çağrısı bütçeden düşmez
test('loop 21: model aynı read_file çağrısını iki ayrı adımda ister; tur sonucunda toolCalls 1dir ve araç bir kez çalışmıştır', async () => {
  const env = makeEnv();
  try {
    const file = path.join(env.rootDir, 'deneme.txt');
    fs.writeFileSync(file, 'içerik');

    let readCount = 0;
    const realReadFile = env.registry.get('read_file');
    const countedReadFile = {
      ...realReadFile,
      async execute(args, ctx) {
        readCount += 1;
        return realReadFile.execute(args, ctx);
      },
    };
    const registry = createToolRegistry([countedReadFile]);

    const model = createFakeModel([
      {
        content: '',
        toolCalls: [{ id: 'c1', name: 'read_file', arguments: JSON.stringify({ path: 'deneme.txt' }) }],
      },
      {
        content: '',
        toolCalls: [{ id: 'c2', name: 'read_file', arguments: JSON.stringify({ path: 'deneme.txt' }) }],
      },
      { content: 'Bitti', toolCalls: [] },
    ]);

    const res = await runAgentTurn({
      model,
      registry,
      workspace: env.workspace,
      log: env.log,
      policy: env.policy,
      session: env.session,
      systemPrompt: 'S',
      userMessage: 'İki kez oku',
    });

    assert.equal(res.status, 'completed');
    assert.equal(readCount, 1);
    assert.equal(res.toolCalls, 1);
  } finally {
    env.cleanup();
  }
});

// 22. requestApproval fırlatınca onaylanmadı sayılır ve tur completed biter
test('loop 22: requestApproval fırlatınca dosya yazılmaz, çıktı Kullanıcı işlemi onaylamadı. olur ve tur completed biter', async () => {
  const env = makeEnv({ mode: 'ask' });
  try {
    const targetFile = path.join(env.rootDir, 'yaz.txt');

    const model = createFakeModel([
      {
        content: '',
        toolCalls: [
          {
            id: 'c1',
            name: 'write_file',
            arguments: JSON.stringify({ path: 'yaz.txt', content: 'yeni içerik' }),
          },
        ],
      },
      { content: 'Anlaşıldı, işlem onaylanmadı.', toolCalls: [] },
    ]);

    const res = await runAgentTurn({
      model,
      registry: env.registry,
      workspace: env.workspace,
      log: env.log,
      policy: env.policy,
      session: env.session,
      systemPrompt: 'S',
      userMessage: 'Dosyayı yaz',
      requestApproval: async () => {
        throw new Error('Onay penceresi kapandı');
      },
    });

    assert.equal(res.status, 'completed');
    assert.equal(fs.existsSync(targetFile), false);

    const toolResults = env.log.read().filter((e) => e.type === 'tool/result');
    assert.equal(toolResults.length, 1);
    assert.equal(toolResults[0].ok, false);
    const parsed = JSON.parse(toolResults[0].content);
    assert.equal(parsed.error, 'Kullanıcı işlemi onaylamadı.');

    const approvalResults = env.log.read().filter((e) => e.type === 'approval/result');
    assert.equal(approvalResults.length, 1);
    assert.equal(approvalResults[0].approved, false);
  } finally {
    env.cleanup();
  }
});

// 23. requestApproval fırlatırken sinyal iptal edilmişse tur aborted biter
test('loop 23: requestApproval fırlatırken sinyal iptal edilmişse tur aborted biter', async () => {
  const env = makeEnv({ mode: 'ask' });
  try {
    const abortController = new AbortController();

    const model = createFakeModel([
      {
        content: '',
        toolCalls: [
          {
            id: 'c1',
            name: 'write_file',
            arguments: JSON.stringify({ path: 'yaz.txt', content: 'yeni içerik' }),
          },
        ],
      },
    ]);

    const res = await runAgentTurn({
      model,
      registry: env.registry,
      workspace: env.workspace,
      log: env.log,
      policy: env.policy,
      session: env.session,
      systemPrompt: 'S',
      userMessage: 'Dosyayı yaz',
      signal: abortController.signal,
      requestApproval: async () => {
        abortController.abort();
        throw new Error('Kullanıcı iptal etti');
      },
    });

    assert.equal(res.status, 'aborted');
  } finally {
    env.cleanup();
  }
});

// 24. append'i her çağrıda fırlatan sahte log ile runAgentTurn fırlatmaz, failed ve logError: true döner
test('loop 24: appendi her çağrıda fırlatan sahte bir log ile runAgentTurn fırlatmaz, status failed ve logError true döner', async () => {
  const env = makeEnv();
  try {
    const fakeLog = {
      append() {
        throw new Error('disk dolu');
      },
      read() {
        return [];
      },
    };

    const model = createFakeModel([
      {
        content: 'Merhaba',
        toolCalls: [],
      },
    ]);

    const res = await runAgentTurn({
      model,
      registry: env.registry,
      workspace: env.workspace,
      log: fakeLog,
      policy: env.policy,
      session: env.session,
      systemPrompt: 'S',
      userMessage: 'Selam',
    });

    assert.equal(res.status, 'failed');
    assert.equal(res.logError, true);
  } finally {
    env.cleanup();
  }
});


// ---- Aşama 4a: bağlam sıkıştırma ----
const { estimateTokens: estimateTokensForTest } = require('../compact.cjs');

const TRUNC_NOTE_JSON =
  '{"ok":true,"truncated":true,"note":"Eski araç çıktısı bağlamdan çıkarıldı; gerekirse aracı tekrar çağır."}';

function isSummaryCall(c) {
  return c.toolChoice === 'none' && Array.isArray(c.tools) && c.tools.length === 0;
}

function runTurnWith(env, model, userMessage, context) {
  return runAgentTurn({
    model,
    registry: env.registry,
    workspace: env.workspace,
    log: env.log,
    policy: env.policy,
    session: env.session,
    systemPrompt: 'Sistem',
    userMessage,
    onEvent: env.onEvent,
    context,
  });
}

// Geçmişe büyük, tamamlanmış turlar ekler (varsayılan bağlamla, sıkıştırmasız)
async function seedTurns(env, count, size = 2000) {
  for (let i = 0; i < count; i++) {
    const m = createFakeModel([{ content: 'cevap ' + i + ' ' + 'c'.repeat(size) }]);
    const r = await runTurnWith(env, m, 'istek ' + i + ' ' + 'u'.repeat(size));
    assert.equal(r.status, 'completed');
    assert.equal(m.calls.length, 1);
  }
}

test('loop ctx 1: küçük maxTokens ile önce eski araç çıktıları kırpılır, kayıt değişmez', async () => {
  const env = makeEnv();
  try {
    const bigText = 'B'.repeat(4000);
    fs.writeFileSync(path.join(env.rootDir, 'f0.txt'), bigText, 'utf8');
    for (let i = 1; i <= 6; i++) {
      fs.writeFileSync(path.join(env.rootDir, `f${i}.txt`), 'kisa' + i, 'utf8');
    }
    const toolCalls = [];
    for (let i = 0; i <= 6; i++) {
      toolCalls.push({ id: 'r' + i, name: 'read_file', arguments: JSON.stringify({ path: `f${i}.txt` }) });
    }
    const model = createFakeModel([{ content: '', toolCalls }, { content: 'Tamam.' }]);

    const res = await runTurnWith(env, model, 'dosyaları oku', { maxTokens: 800 });
    assert.equal(res.status, 'completed');
    assert.equal(model.calls.length, 2);
    assert.ok(!model.calls.some(isSummaryCall));

    const second = model.calls[1].messages;
    const r0 = second.find((m) => m.role === 'tool' && m.tool_call_id === 'r0');
    assert.equal(r0.content, TRUNC_NOTE_JSON);
    const r6 = second.find((m) => m.role === 'tool' && m.tool_call_id === 'r6');
    assert.match(r6.content, /kisa6/);
    assert.ok(estimateTokensForTest(second) <= 800);

    // Kayıt değişmedi: tam çıktı duruyor, özet olayı yok
    const logged = env.log.read();
    const r0Log = logged.find((e) => e.type === 'tool/result' && e.callId === 'r0');
    assert.ok(r0Log.content.includes(bigText));
    assert.ok(!logged.some((e) => e.type === 'context/compact'));
    assert.ok(!env.events.some((e) => e.type === 'context/compact_failed'));
  } finally {
    env.cleanup();
  }
});

test('loop ctx 2: kırpma yetmezse özet yazılır, sonraki çağrı özetle başlar, usage eklenir, turda en fazla bir özet', async () => {
  const env = makeEnv();
  try {
    await seedTurns(env, 2);
    const before = env.log.read();
    const secondTurnStart = before.filter((e) => e.type === 'turn/start')[1];
    const expectedUpto = before[before.indexOf(secondTurnStart) - 1].seq;
    fs.writeFileSync(path.join(env.rootDir, 'a.txt'), 'icerik', 'utf8');

    const model = createFakeModel([
      { content: 'ÖZET METNİ', usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } },
      {
        content: '',
        toolCalls: [{ id: 'x1', name: 'read_file', arguments: JSON.stringify({ path: 'a.txt' }) }],
        usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
      },
      { content: 'Bitti.', usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } },
    ]);
    const res = await runTurnWith(env, model, 'üçüncü istek', { maxTokens: 50 });

    assert.equal(res.status, 'completed');
    assert.equal(res.text, 'Bitti.');
    assert.equal(res.toolCalls, 1); // özet araç bütçesinden düşmez
    assert.deepEqual(res.usage, { prompt_tokens: 115, completion_tokens: 23, total_tokens: 138 });

    assert.equal(model.calls.length, 3);
    assert.ok(isSummaryCall(model.calls[0]));
    assert.equal(model.calls.filter(isSummaryCall).length, 1);
    const sumUser = model.calls[0].messages[1].content;
    assert.ok(sumUser.includes('istek 0'));
    assert.ok(sumUser.includes('cevap 0'));
    assert.ok(!sumUser.includes('istek 1'));

    for (const call of [model.calls[1], model.calls[2]]) {
      const msgs = call.messages;
      assert.equal(msgs[0].role, 'system');
      assert.equal(msgs[1].content, '[Önceki konuşmanın özeti]\nÖZET METNİ');
      assert.deepEqual(msgs[2], { role: 'assistant', content: 'Anladım, özetten devam ediyorum.' });
      assert.ok(msgs[3].content.startsWith('istek 1 '));
      assert.ok(!msgs.some((m) => typeof m.content === 'string' && m.content.startsWith('istek 0')));
    }

    const logged = env.log.read();
    const compacts = logged.filter((e) => e.type === 'context/compact');
    assert.equal(compacts.length, 1);
    assert.equal(compacts[0].summary, 'ÖZET METNİ');
    assert.equal(compacts[0].uptoSeq, expectedUpto);
    // Eski kayıt yeniden yazılmadı
    assert.deepEqual(logged.slice(0, before.length), before);
    assert.ok(env.events.some((e) => e.type === 'context/compact' && e.uptoSeq === expectedUpto));
  } finally {
    env.cleanup();
  }
});

test('loop ctx 3: yeterli tur yoksa özetleme yapılmaz', async () => {
  const env = makeEnv();
  try {
    await seedTurns(env, 1);
    const model = createFakeModel([{ content: 'Cevap.' }]);
    const res = await runTurnWith(env, model, 'ikinci istek', { maxTokens: 50 });
    assert.equal(res.status, 'completed');
    assert.equal(res.text, 'Cevap.');
    assert.equal(model.calls.length, 1);
    assert.ok(!isSummaryCall(model.calls[0]));
    assert.ok(!env.log.read().some((e) => e.type === 'context/compact'));
    assert.ok(!env.events.some((e) => e.type === 'context/compact_failed'));
  } finally {
    env.cleanup();
  }
});

test('loop ctx 4: özetleme hatası turu durdurmaz, context/compact_failed gelir ve kayda yazılmaz', async () => {
  const env = makeEnv();
  try {
    await seedTurns(env, 2);
    fs.writeFileSync(path.join(env.rootDir, 'a.txt'), 'icerik', 'utf8');
    const model = createFakeModel([
      { error: new Error('özet servisi düştü') },
      {
        content: '',
        toolCalls: [{ id: 'x1', name: 'read_file', arguments: JSON.stringify({ path: 'a.txt' }) }],
      },
      { content: 'Yine de bitti.' },
    ]);
    const res = await runTurnWith(env, model, 'üçüncü istek', { maxTokens: 50 });
    assert.equal(res.status, 'completed');
    assert.equal(res.text, 'Yine de bitti.');
    assert.equal(model.calls.length, 3);
    assert.equal(model.calls.filter(isSummaryCall).length, 1); // tekrar denenmez

    const failed = env.events.filter((e) => e.type === 'context/compact_failed');
    assert.equal(failed.length, 1);
    assert.equal(failed[0].error, 'özet servisi düştü');
    const logged = env.log.read();
    assert.ok(!logged.some((e) => e.type === 'context/compact' || e.type === 'context/compact_failed'));
    // Özet yokken model tam geçmişi görür
    assert.ok(model.calls[1].messages[1].content.startsWith('istek 0 '));
  } finally {
    env.cleanup();
  }
});

test('loop ctx 5: iptal sinyali varsa özetleme yapılmaz; bağlam sınırı aşılmazsa hiçbir şey değişmez', async () => {
  const env = makeEnv();
  try {
    await seedTurns(env, 2);
    const controller = new AbortController();
    const model = createFakeModel([
      () => {
        controller.abort();
        return { content: '', toolCalls: [{ id: 'z', name: 'read_file', arguments: '{"path":"yok.txt"}' }] };
      },
    ]);
    // Normal bağlamda (varsayılan 60000) özet yok
    const res = await runAgentTurn({
      model,
      registry: env.registry,
      workspace: env.workspace,
      log: env.log,
      policy: env.policy,
      session: env.session,
      systemPrompt: 'Sistem',
      userMessage: 'kısa',
      signal: controller.signal,
    });
    assert.equal(res.status, 'aborted');
    assert.equal(model.calls.length, 1);
    assert.ok(!isSummaryCall(model.calls[0]));

    // Önceden iptal edilmiş sinyal ve küçük bağlam: özet çağrısı yapılmaz
    const aborted = new AbortController();
    aborted.abort();
    const model2 = createFakeModel([{ content: 'ÖZET' }]);
    const res2 = await runAgentTurn({
      model: model2,
      registry: env.registry,
      workspace: env.workspace,
      log: env.log,
      policy: env.policy,
      session: env.session,
      systemPrompt: 'Sistem',
      userMessage: 'iptal',
      signal: aborted.signal,
      context: { maxTokens: 10 },
    });
    assert.equal(res2.status, 'aborted');
    assert.equal(model2.calls.length, 0);
    assert.ok(!env.log.read().some((e) => e.type === 'context/compact'));
  } finally {
    env.cleanup();
  }
});

test('loop ctx 6: önceki özet yeni özetin girdisine taşınır', async () => {
  const env = makeEnv();
  try {
    await seedTurns(env, 2);
    const m1 = createFakeModel([{ content: 'BİRİNCİ ÖZET' }, { content: 'c3' }]);
    await runTurnWith(env, m1, 'istek 2', { maxTokens: 50 });
    assert.equal(m1.calls.filter(isSummaryCall).length, 1);

    const m2 = createFakeModel([{ content: 'İKİNCİ ÖZET' }, { content: 'c4' }]);
    await runTurnWith(env, m2, 'istek 3', { maxTokens: 50 });
    assert.ok(isSummaryCall(m2.calls[0]));
    const sumUser = m2.calls[0].messages[1].content;
    assert.ok(sumUser.includes('BİRİNCİ ÖZET'));
    assert.ok(sumUser.includes('istek 1'));
    assert.ok(!sumUser.includes('istek 0'));
    assert.equal(m2.calls[1].messages[1].content, '[Önceki konuşmanın özeti]\nİKİNCİ ÖZET');
    assert.ok(m2.calls[1].messages[3].content.startsWith('istek 2'));
  } finally {
    env.cleanup();
  }
});

test('loop: onay bekliyorken dosya degistirilirse arac "Dosya onaydan sonra değişti…" hatasi dondurur ve dosya ezilmez; yazmadan once checkpoints.record cagrilir', async () => {
  const env = makeEnv({ mode: 'ask' });
  const crypto = require('node:crypto');
  try {
    const targetPath = path.join(env.rootDir, 'onay_test.txt');
    fs.writeFileSync(targetPath, 'orijinal', 'utf8');

    // Okuma kaydını oturuma hazırla
    const hash = crypto.createHash('sha256').update('orijinal', 'utf8').digest('hex');
    env.session.readFiles = new Map([['onay_test.txt', hash]]);

    const recorded = [];
    const fakeCheckpoints = {
      beganTurnId: null,
      begin(turnId) {
        this.beganTurnId = turnId;
      },
      record(absPath, relPath) {
        recorded.push({ absPath, relPath });
        return true;
      },
    };

    const model = createFakeModel([
      {
        content: '',
        toolCalls: [
          {
            id: 'c1',
            name: 'write_file',
            arguments: JSON.stringify({ path: 'onay_test.txt', content: 'agent_yazisi' }),
          },
        ],
      },
      { content: 'Hata sonrası cevap', toolCalls: [] },
    ]);

    const res = await runAgentTurn({
      model,
      registry: env.registry,
      workspace: env.workspace,
      log: env.log,
      policy: env.policy,
      session: env.session,
      checkpoints: fakeCheckpoints,
      systemPrompt: 'S',
      userMessage: 'Yaz',
      async requestApproval(_req) {
        // Kullanıcı onay aşamasındayken dosya dışarıdan değiştirilir
        fs.writeFileSync(targetPath, 'disaridan_degisti', 'utf8');
        return { approved: true };
      },
    });

    assert.equal(res.status, 'completed');
    // Dosya ezilmemiş olmalı (dışarıdan yazılan içerik korunur)
    assert.equal(fs.readFileSync(targetPath, 'utf8'), 'disaridan_degisti');

    // checkpoints.begin ve checkpoints.record çağrılmış olmalı
    assert.ok(fakeCheckpoints.beganTurnId && fakeCheckpoints.beganTurnId.startsWith('turn-'));
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].relPath, 'onay_test.txt');

    // Araç sonucu hata taşımalı
    const toolResults = env.log.read().filter((e) => e.type === 'tool/result');
    assert.equal(toolResults.length, 1);
    assert.equal(toolResults[0].ok, false);
    const parsed = JSON.parse(toolResults[0].content);
    assert.ok(parsed.error.includes('Dosya onaydan sonra değişti; değişiklik uygulanmadı. Tekrar okuyup yeniden dene.'));
  } finally {
    env.cleanup();
  }
});

test('loop 26: auto-edit modunda okunmamış dosyaya write_file başarısız olunca checkpoint kaydedilmez', async () => {
  const env = makeEnv();
  const autoEditPolicy = createApprovalPolicy({ mode: 'auto-edit' });
  try {
    const targetPath = path.join(env.rootDir, 'okunmamis.txt');
    fs.writeFileSync(targetPath, 'orijinal', 'utf8');

    const recorded = [];
    const fakeCheckpoints = {
      begin(_turnId) {},
      record(absPath, relPath) {
        recorded.push({ absPath, relPath });
        return true;
      },
    };

    const model = createFakeModel([
      {
        content: '',
        toolCalls: [
          {
            id: 'call_w1',
            name: 'write_file',
            arguments: JSON.stringify({ path: 'okunmamis.txt', content: 'yeni' }),
          },
        ],
      },
      {
        content: 'Bitti.',
        toolCalls: [],
      },
    ]);

    const res = await runAgentTurn({
      model,
      registry: env.registry,
      workspace: env.workspace,
      log: env.log,
      policy: autoEditPolicy,
      session: { plan: [], readFiles: new Map() },
      checkpoints: fakeCheckpoints,
      systemPrompt: 'S',
      userMessage: 'Yaz',
    });

    assert.equal(res.status, 'completed');
    // Doğrulama başarısız olduğu için checkpoint kaydedilmemeli
    assert.equal(recorded.length, 0);
  } finally {
    env.cleanup();
  }
});

test('loop 27: model extra_content li tool call dondurunce sonraki istekte assistant mesajinda alan korunur', async () => {
  const env = makeEnv();
  try {
    fs.writeFileSync(path.join(env.rootDir, 'a.txt'), 'icerik_a', 'utf8');
    fs.writeFileSync(path.join(env.rootDir, 'b.txt'), 'icerik_b', 'utf8');
    const model = createFakeModel([
      {
        content: '',
        toolCalls: [
          {
            id: 'c1',
            name: 'read_file',
            arguments: JSON.stringify({ path: 'a.txt' }),
            extra_content: { google: { thought_signature: 'sig_123' } },
          },
          {
            id: 'c2',
            name: 'read_file',
            arguments: JSON.stringify({ path: 'b.txt' }),
          },
        ],
      },
      {
        content: 'Tamamlandı.',
        toolCalls: [],
      },
    ]);

    const res = await runAgentTurn({
      model,
      registry: env.registry,
      workspace: env.workspace,
      log: env.log,
      policy: env.policy,
      session: env.session,
      systemPrompt: 'Sistem',
      userMessage: 'Dosyaları oku',
    });

    assert.equal(res.status, 'completed');
    assert.equal(model.calls.length, 2);
    const assistantMsg = model.calls[1].messages.find((m) => m.role === 'assistant');
    assert.ok(assistantMsg);
    assert.deepEqual(assistantMsg.tool_calls, [
      {
        id: 'c1',
        type: 'function',
        function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
        extra_content: { google: { thought_signature: 'sig_123' } },
      },
      {
        id: 'c2',
        type: 'function',
        function: { name: 'read_file', arguments: '{"path":"b.txt"}' },
      },
    ]);
    assert.equal('extra_content' in assistantMsg.tool_calls[1], false);
  } finally {
    env.cleanup();
  }
});
