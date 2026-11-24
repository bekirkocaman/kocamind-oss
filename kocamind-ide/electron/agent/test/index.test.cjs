'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createAgentRuntime, DEFAULT_SYSTEM_PROMPT } = require('../index.cjs');

test('index: uçtan uca bir turda read_file + edit_file onay ile çalışır, dosya değişir ve oturum kaydı oluşur', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-rt-ws-'));
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-rt-session-'));

  try {
    const targetFile = path.join(rootDir, 'selam.js');
    fs.writeFileSync(targetFile, 'const mesaj = "eski";\n', 'utf8');

    const modelCalls = [];
    const stepResponses = [
      {
        content: '',
        toolCalls: [
          {
            id: 'call_read_1',
            name: 'read_file',
            arguments: JSON.stringify({ path: 'selam.js' }),
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      },
      {
        content: '',
        toolCalls: [
          {
            id: 'call_edit_1',
            name: 'edit_file',
            arguments: JSON.stringify({
              path: 'selam.js',
              old_string: '"eski"',
              new_string: '"yeni"',
            }),
          },
        ],
        usage: { prompt_tokens: 30, completion_tokens: 15, total_tokens: 45 },
      },
      {
        content: 'selam.js içindeki mesaj "yeni" olarak güncellendi.',
        toolCalls: [],
        usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 },
      },
    ];

    let stepIdx = 0;
    const fakeModel = {
      async complete(req) {
        modelCalls.push(req);
        return stepResponses[stepIdx++];
      },
    };

    const approvalRequests = [];
    const collectedEvents = [];

    const runtime = createAgentRuntime({
      rootDir,
      sessionDir,
      sessionId: 'uctan_uca_01',
      model: fakeModel,
      mode: 'ask',
      async requestApproval(req) {
        approvalRequests.push(req);
        return { approved: true };
      },
      onEvent(ev) {
        collectedEvents.push(ev);
      },
    });

    const result = await runtime.runTurn('selam.js dosyasındaki mesajı yeni yap');

    assert.equal(result.status, 'completed');
    assert.equal(result.steps, 3);
    assert.equal(result.toolCalls, 2);
    assert.equal(result.text, 'selam.js içindeki mesaj "yeni" olarak güncellendi.');
    assert.deepEqual(result.usage, {
      prompt_tokens: 90,
      completion_tokens: 35,
      total_tokens: 125,
    });

    // Varsayılan sistem istemi kullanılmış olmalı
    assert.equal(modelCalls[0].messages[0].role, 'system');
    assert.equal(modelCalls[0].messages[0].content, DEFAULT_SYSTEM_PROMPT);

    // Onay yalnızca edit_file için istenmiş olmalı
    assert.equal(approvalRequests.length, 1);
    assert.equal(approvalRequests[0].callId, 'call_edit_1');
    assert.deepEqual(approvalRequests[0].preview, {
      path: 'selam.js',
      before: 'const mesaj = "eski";\n',
      after: 'const mesaj = "yeni";\n',
    });

    // Dosya güncellenmiş olmalı
    assert.equal(fs.readFileSync(targetFile, 'utf8'), 'const mesaj = "yeni";\n');

    // Oturum dosyası oluşmuş ve olayları içeriyor olmalı
    assert.equal(fs.existsSync(runtime.log.path), true);
    const loggedEvents = runtime.log.read();
    assert.ok(loggedEvents.length > 0);
    assert.equal(loggedEvents[0].type, 'turn/start');
    assert.equal(loggedEvents[loggedEvents.length - 1].type, 'turn/end');
    assert.equal(loggedEvents[loggedEvents.length - 1].status, 'completed');
    assert.ok(collectedEvents.length >= loggedEvents.length);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});


// ---- Aşama 4a: oturum sürdürme ----
const { createSessionLog: createLogForIndexTest } = require('../sessionLog.cjs');

test('index: var olan oturumla kurulan runtime planı geri yükler, context seçeneğini geçirir', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-rt-ws-'));
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-rt-session-'));
  try {
    const prev = createLogForIndexTest({ dir: sessionDir, sessionId: 'surdur_01' });
    prev.append({ type: 'turn/start' });
    prev.append({ type: 'user/message', content: 'plan yap' });
    prev.append({
      type: 'tool/result',
      callId: 'p1',
      name: 'update_plan',
      ok: true,
      content: JSON.stringify({
        ok: true,
        result: { items: [{ content: 'Dosyayı oku', status: 'completed' }, { content: 'Düzelt', status: 'in_progress' }] },
      }),
    });
    prev.append({ type: 'turn/end', status: 'completed' });

    const fresh = createAgentRuntime({
      rootDir,
      sessionDir,
      sessionId: 'yepyeni_01',
      model: { async complete() { return { content: 'x', toolCalls: [] }; } },
    });
    assert.deepEqual(fresh.session.plan, []);

    const modelCalls = [];
    const runtime = createAgentRuntime({
      rootDir,
      sessionDir,
      sessionId: 'surdur_01',
      context: { maxTokens: 5, keepRecentTurns: 1 },
      model: {
        async complete(req) {
          modelCalls.push(req);
          if (req.toolChoice === 'none' && req.tools.length === 0) {
            return { content: 'ÖZET', toolCalls: [] };
          }
          return { content: 'Devam ediyorum.', toolCalls: [] };
        },
      },
    });
    assert.deepEqual(runtime.session.plan, [
      { content: 'Dosyayı oku', status: 'completed' },
      { content: 'Düzelt', status: 'in_progress' },
    ]);

    const res = await runtime.runTurn('devam et');
    assert.equal(res.status, 'completed');
    // context seçeneği döngüye geçti: küçük maxTokens ile özetleme yapıldı
    assert.ok(runtime.log.read().some((e) => e.type === 'context/compact' && e.summary === 'ÖZET'));
    assert.equal(modelCalls.length, 2);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});



// ---- Aşama 5a: proje talimatları, alt agent'lar, skill'ler ----
const { SUBAGENT_SYSTEM_PROMPT: SUB_PROMPT_FOR_INDEX } = require('../tools/task.cjs');

function makeDirs5a() {
  return {
    rootDir: fs.mkdtempSync(path.join(os.tmpdir(), 'km-rt5-ws-')),
    sessionDir: fs.mkdtempSync(path.join(os.tmpdir(), 'km-rt5-session-')),
  };
}

test('index: kayıtta task ve load_skill var; varsayılan istem task satırını içerir', () => {
  const { rootDir, sessionDir } = makeDirs5a();
  try {
    const runtime = createAgentRuntime({
      rootDir,
      sessionDir,
      sessionId: 'kayit_5a',
      model: { async complete() { return { content: 'x', toolCalls: [] }; } },
    });
    const names = runtime.registry.list().map((t) => t.name);
    assert.ok(names.includes('task'));
    assert.ok(names.includes('load_skill'));
    assert.ok(names.includes('write_file'));
    assert.equal(runtime.registry.get('task').risk, 'read');
    assert.ok(
      DEFAULT_SYSTEM_PROMPT.includes(
        'Birbirinden bağımsız okuma ve araştırma işlerini task aracıyla alt asistanlara paralel olarak verebilirsin.'
      )
    );
    assert.ok(
      DEFAULT_SYSTEM_PROMPT.endsWith(
        '\nGüncel bilgi gerekiyorsa (kütüphane sürümü, API değişikliği, hata mesajı) web_search ve web_fetch ile doğrula; kaynak adreslerini cevabında belirt.'
      )
    );
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('index: proje talimatı ve skill kataloğu sistem mesajında; KOCAMIND.md değişince sonraki tur yeni metni görür', async () => {
  const { rootDir, sessionDir } = makeDirs5a();
  try {
    fs.writeFileSync(path.join(rootDir, 'KOCAMIND.md'), 'Her zaman sekme kullan.', 'utf8');
    const skillDir = path.join(rootDir, '.kocamind', 'skills', 'test-yaz');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: test-yaz\ndescription: Önce test yazdırır\n---\nGövde',
      'utf8'
    );

    const systems = [];
    const runtime = createAgentRuntime({
      rootDir,
      sessionDir,
      sessionId: 'talimat_5a',
      model: {
        async complete(req) {
          systems.push(req.messages[0].content);
          return { content: 'tamam', toolCalls: [] };
        },
      },
    });

    await runtime.runTurn('ilk');
    assert.ok(systems[0].startsWith(DEFAULT_SYSTEM_PROMPT + '\n\n'));
    assert.ok(systems[0].includes('Proje talimatları (KOCAMIND.md).'));
    assert.ok(systems[0].includes('Her zaman sekme kullan.'));
    assert.ok(systems[0].includes("Proje skill'leri."));
    assert.ok(systems[0].includes('- test-yaz: Önce test yazdırır'));
    assert.ok(systems[0].indexOf('Proje talimatları') < systems[0].indexOf("Proje skill'leri"));

    fs.writeFileSync(path.join(rootDir, 'KOCAMIND.md'), 'Boşluk kullan.', 'utf8');
    await runtime.runTurn('ikinci');
    assert.ok(systems[1].includes('Boşluk kullan.'));
    assert.ok(!systems[1].includes('Her zaman sekme kullan.'));
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('index: aynı adımda iki task paralel çalışır, sonuçlar sırayla döner', async () => {
  const { rootDir, sessionDir } = makeDirs5a();
  try {
    let active = 0;
    let maxActive = 0;
    const mainCalls = [];
    let mainStep = 0;
    const model = {
      async complete(req) {
        if (req.messages[0].content === SUB_PROMPT_FOR_INDEX) {
          active += 1;
          maxActive = Math.max(maxActive, active);
          const prompt = req.messages[1].content;
          // İlk iş daha geç biter; sonuçlar yine istek sırasıyla dönmeli
          await new Promise((r) => setTimeout(r, prompt === 'birinci iş' ? 60 : 10));
          active -= 1;
          return { content: `özet: ${prompt}`, toolCalls: [] };
        }
        mainCalls.push(req);
        mainStep += 1;
        if (mainStep === 1) {
          return {
            content: '',
            toolCalls: [
              { id: 't1', name: 'task', arguments: { description: 'bir', prompt: 'birinci iş' } },
              { id: 't2', name: 'task', arguments: { description: 'iki', prompt: 'ikinci iş' } },
            ],
          };
        }
        return { content: 'bitti', toolCalls: [] };
      },
    };

    const runtime = createAgentRuntime({ rootDir, sessionDir, sessionId: 'paralel_5a', model });
    const res = await runtime.runTurn('iki işi yap');
    assert.equal(res.status, 'completed');
    assert.equal(res.text, 'bitti');
    assert.equal(maxActive, 2);

    const toolMsgs = mainCalls[1].messages.filter((m) => m.role === 'tool');
    assert.equal(toolMsgs.length, 2);
    assert.equal(toolMsgs[0].tool_call_id, 't1');
    assert.equal(toolMsgs[1].tool_call_id, 't2');
    assert.equal(JSON.parse(toolMsgs[0].content).result.summary, 'özet: birinci iş');
    assert.equal(JSON.parse(toolMsgs[1].content).result.summary, 'özet: ikinci iş');

    // Alt agent olayları ana oturum kaydına yazılmaz
    const logged = runtime.log.read();
    assert.equal(logged.filter((e) => e.type === 'user/message').length, 1);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('index: uctan uca model dosyayi okur, duzenler (onayli), tur biter; revertLastTurn() dosyayi eski haline getirir', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-rt-ws-'));
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-rt-session-'));

  try {
    const targetFile = path.join(rootDir, 'kod.js');
    fs.writeFileSync(targetFile, 'const deger = 100;\n', 'utf8');

    const stepResponses = [
      {
        content: '',
        toolCalls: [
          {
            id: 'c_read',
            name: 'read_file',
            arguments: JSON.stringify({ path: 'kod.js' }),
          },
        ],
      },
      {
        content: '',
        toolCalls: [
          {
            id: 'c_edit',
            name: 'edit_file',
            arguments: JSON.stringify({
              path: 'kod.js',
              old_string: '100',
              new_string: '200',
            }),
          },
        ],
      },
      {
        content: 'kod.js güncellendi',
        toolCalls: [],
      },
    ];

    let stepIdx = 0;
    const fakeModel = {
      async complete() {
        return stepResponses[stepIdx++];
      },
    };

    const runtime = createAgentRuntime({
      rootDir,
      sessionDir,
      sessionId: 'revert_test_session',
      model: fakeModel,
      mode: 'ask',
      async requestApproval() {
        return { approved: true };
      },
    });

    const turnRes = await runtime.runTurn('kod.js içindeki değeri 200 yap');
    assert.equal(turnRes.status, 'completed');
    assert.equal(fs.readFileSync(targetFile, 'utf8'), 'const deger = 200;\n');

    // revertLastTurn() çağrılınca dosya eski haline döner
    const rev = runtime.revertLastTurn();
    assert.equal(rev.restored.length, 1);
    assert.equal(rev.restored[0], 'kod.js');
    assert.equal(fs.readFileSync(targetFile, 'utf8'), 'const deger = 100;\n');
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('index: revertLastTurn() sonrasi session.readFiles yeni ozetle guncellenir ve sonraki turda edit_file calisir', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-rt-ws2-'));
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-rt-session2-'));

  try {
    const targetFile = path.join(rootDir, 'kod.js');
    fs.writeFileSync(targetFile, 'const deger = 100;\n', 'utf8');

    let stepIdx = 0;
    const stepResponses = [
      // Tur 1: oku ve düzenle (100 -> 200)
      {
        content: '',
        toolCalls: [
          { id: 'c1', name: 'read_file', arguments: JSON.stringify({ path: 'kod.js' }) },
        ],
      },
      {
        content: '',
        toolCalls: [
          {
            id: 'c2',
            name: 'edit_file',
            arguments: JSON.stringify({ path: 'kod.js', old_string: '100', new_string: '200' }),
          },
        ],
      },
      { content: 'ok 1', toolCalls: [] },
      // Tur 2 (revert sonrası): dosyayı tekrar okumadan düzenle (100 -> 300)
      {
        content: '',
        toolCalls: [
          {
            id: 'c3',
            name: 'edit_file',
            arguments: JSON.stringify({ path: 'kod.js', old_string: '100', new_string: '300' }),
          },
        ],
      },
      { content: 'ok 2', toolCalls: [] },
    ];

    const fakeModel = {
      async complete() {
        return stepResponses[stepIdx++];
      },
    };

    const runtime = createAgentRuntime({
      rootDir,
      sessionDir,
      sessionId: 'revert_readfiles_sync',
      model: fakeModel,
      mode: 'ask',
      async requestApproval() {
        return { approved: true };
      },
    });

    await runtime.runTurn('tur 1');
    assert.equal(fs.readFileSync(targetFile, 'utf8'), 'const deger = 200;\n');

    runtime.revertLastTurn();
    assert.equal(fs.readFileSync(targetFile, 'utf8'), 'const deger = 100;\n');

    // Tur 2: readFiles güncellendiyse hash eşleşmeli ve edit_file 100 -> 300 yapabilmeli
    const turn2Res = await runtime.runTurn('tur 2');
    assert.equal(turn2Res.status, 'completed');
    assert.equal(fs.readFileSync(targetFile, 'utf8'), 'const deger = 300;\n');
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('index: webSearch ve webFetch olan modelde web araçları ana kayıtta ve alt agent\'ta vardır; metotsuz modelde yoktur', async () => {
  const { rootDir, sessionDir } = makeDirs5a();
  try {
    const webModel = {
      async complete() {
        return { content: 'tamam', toolCalls: [] };
      },
      async webSearch(query) {
        return [{ title: 'Sonuc', query }];
      },
      async webFetch(url) {
        return { url, title: 'Baslik', content: 'Metin' };
      },
    };

    const runtimeWithWeb = createAgentRuntime({
      rootDir,
      sessionDir,
      sessionId: 'web_var_01',
      model: webModel,
    });

    const webNames = runtimeWithWeb.registry.list().map((t) => t.name);
    assert.ok(webNames.includes('web_search'));
    assert.ok(webNames.includes('web_fetch'));
    assert.equal(runtimeWithWeb.registry.get('web_search').risk, 'read');
    assert.equal(runtimeWithWeb.registry.get('web_fetch').risk, 'read');

    // Alt agent'ın da web_search ve web_fetch'e erişimi olduğunu doğrula
    let subToolsProvided = null;
    let subStep = 0;
    const modelForSubagent = {
      async complete(req) {
        if (req.messages[0].content === SUB_PROMPT_FOR_INDEX) {
          subToolsProvided = req.tools.map((t) => t.function.name);
          return { content: 'alt agent tamam', toolCalls: [] };
        }
        subStep += 1;
        if (subStep === 1) {
          return {
            content: '',
            toolCalls: [
              { id: 'call_sub', name: 'task', arguments: { description: 'araştır', prompt: 'ara' } },
            ],
          };
        }
        return { content: 'ana agent bitti', toolCalls: [] };
      },
      async webSearch() {
        return [];
      },
      async webFetch() {
        return {};
      },
    };

    const runtimeTaskWeb = createAgentRuntime({
      rootDir,
      sessionDir,
      sessionId: 'web_task_01',
      model: modelForSubagent,
    });

    const taskResult = await runtimeTaskWeb.runTurn('araştır');
    assert.equal(taskResult.status, 'completed');
    assert.ok(subToolsProvided);
    assert.ok(subToolsProvided.includes('web_search'));
    assert.ok(subToolsProvided.includes('web_fetch'));

    // Metotsuz modelde web araçları kayda eklenmez
    const plainModel = {
      async complete() {
        return { content: 'metotsuz', toolCalls: [] };
      },
    };

    const runtimePlain = createAgentRuntime({
      rootDir,
      sessionDir,
      sessionId: 'web_yok_01',
      model: plainModel,
    });

    const plainNames = runtimePlain.registry.list().map((t) => t.name);
    assert.ok(!plainNames.includes('web_search'));
    assert.ok(!plainNames.includes('web_fetch'));
    assert.equal(runtimePlain.registry.get('web_search'), undefined);
    assert.equal(runtimePlain.registry.get('web_fetch'), undefined);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});
