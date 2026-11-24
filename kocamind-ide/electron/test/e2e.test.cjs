'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Readable } = require('node:stream');

const express = require(require.resolve('express', { paths: [path.join(__dirname, '../../../backend')] }));
const { registerIdeRoutes } = require(path.join(__dirname, '../../../backend/routes/ide.js'));
const { createAgentRuntime } = require('../agent/index.cjs');
const { createBackendModel } = require('../agent/modelAdapter.cjs');

let server;
let baseUrl;
let providerHandler = null;
const providerCalls = [];

const sahteSaglayiciFetch = async (url, init) => {
  const record = {
    url,
    init,
    body: init?.body ? JSON.parse(init.body) : null,
  };
  providerCalls.push(record);
  if (!providerHandler) {
    throw new Error('providerHandler atanmamış.');
  }
  return providerHandler(url, init, record);
};

before(async () => {
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use((req, res, next) => {
    const auth = req.headers['authorization'];
    if (auth === 'Bearer test-token') {
      req.user = { uid: 'u1' };
      return next();
    }
    return res.status(401).json({ error: { message: 'Oturum açman gerekiyor.' } });
  });

  registerIdeRoutes(app, {
    enforceDailyQuota: () => (_req, _res, next) => next(),
    PROVIDERS: {
      deepseek: {
        name: 'DeepSeek',
        envKey: 'DEEPSEEK_API_KEY',
        baseUrl: 'https://sahte.saglayici/v1/chat/completions',
      },
    },
    MODEL_CATALOG: [{ id: 'deepseek-chat', provider: 'deepseek', label: 'DeepSeek' }],
    ACTIVE_PROVIDERS: new Set(['deepseek']),
    fetch: sahteSaglayiciFetch,
    env: { DEEPSEEK_API_KEY: 'x', IDE_MODELS: 'deepseek:deepseek-chat' },
    toolRegistry: null,
  });

  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

function sseChunk(obj) {
  return `data: ${typeof obj === 'string' ? obj : JSON.stringify(obj)}\n\n`;
}

function sseResponse(chunks) {
  return {
    ok: true,
    status: 200,
    body: Readable.from([...chunks, 'data: [DONE]\n\n']),
  };
}

test('1. Tam tur: read_file (argüman parçalı) -> edit_file -> Tamam.', async () => {
  providerCalls.length = 0;
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-e2e-ws-'));
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-e2e-ss-'));
  try {
    fs.writeFileSync(path.join(rootDir, 'a.txt'), 'merhaba dunya', 'utf8');

    let callCount = 0;
    providerHandler = async () => {
      callCount++;
      if (callCount === 1) {
        return sseResponse([
          sseChunk({
            choices: [{
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [{
                  index: 0,
                  id: 'call_read_1',
                  type: 'function',
                  function: { name: 'read_file', arguments: '{"pa' },
                }],
              },
            }],
          }),
          sseChunk({
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: 0,
                  function: { arguments: 'th": "a' },
                }],
              },
            }],
          }),
          sseChunk({
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: 0,
                  function: { arguments: '.txt"}' },
                }],
              },
            }],
          }),
          sseChunk({
            choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
            usage: { prompt_tokens: 15, completion_tokens: 10, total_tokens: 25 },
          }),
        ]);
      } else if (callCount === 2) {
        return sseResponse([
          sseChunk({
            choices: [{
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [{
                  index: 0,
                  id: 'call_edit_1',
                  type: 'function',
                  function: {
                    name: 'edit_file',
                    arguments: JSON.stringify({
                      path: 'a.txt',
                      old_string: 'dunya',
                      new_string: 'kanka',
                    }),
                  },
                }],
              },
            }],
          }),
          sseChunk({
            choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
            usage: { prompt_tokens: 25, completion_tokens: 15, total_tokens: 40 },
          }),
        ]);
      } else {
        return sseResponse([
          sseChunk({
            choices: [{
              index: 0,
              delta: { role: 'assistant', content: 'Tamam.' },
            }],
          }),
          sseChunk({
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            usage: { prompt_tokens: 35, completion_tokens: 5, total_tokens: 40 },
          }),
        ]);
      }
    };

    const events = [];
    const runtime = createAgentRuntime({
      rootDir,
      sessionDir,
      sessionId: 'e2e-1',
      model: createBackendModel({
        baseUrl,
        getToken: () => 'test-token',
        retryDelaysMs: [10, 10],
      }),
      mode: 'ask',
      requestApproval: async () => ({ approved: true }),
      onEvent: (ev) => events.push(ev),
    });

    const result = await runtime.runTurn('a.txt içindeki dunya kelimesini kanka yap');

    assert.equal(result.status, 'completed');
    assert.equal(result.text, 'Tamam.');

    const finalContent = fs.readFileSync(path.join(rootDir, 'a.txt'), 'utf8');
    assert.equal(finalContent, 'merhaba kanka');

    const logEvents = runtime.log.read();
    const toolResults = logEvents.filter((e) => e.type === 'tool/result');
    assert.equal(toolResults.length, 2);
    for (const tr of toolResults) {
      assert.equal(tr.ok, true);
    }

    assert.equal(providerCalls.length, 3);

    const call2Messages = providerCalls[1].body.messages;
    const toolMsgCall2 = call2Messages.filter((m) => m.role === 'tool');
    assert.equal(toolMsgCall2.length, 1);
    assert.equal(toolMsgCall2[0].tool_call_id, 'call_read_1');

    const call3Messages = providerCalls[2].body.messages;
    const toolMsgsCall3 = call3Messages.filter((m) => m.role === 'tool');
    assert.equal(toolMsgsCall3.length, 2);
    assert.equal(toolMsgsCall3[0].tool_call_id, 'call_read_1');
    assert.equal(toolMsgsCall3[1].tool_call_id, 'call_edit_1');

    const deltas = events.filter((e) => e.type === 'assistant/delta');
    assert.ok(deltas.length >= 1);
    assert.ok(deltas.map((d) => d.delta).join('').includes('Tamam.'));
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('2. Onay reddi: requestApproval approved: false; dosya degismez, edit_file sonucu Kullanıcı işlemi onaylamadı.', async () => {
  providerCalls.length = 0;
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-e2e-ws-'));
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-e2e-ss-'));
  try {
    fs.writeFileSync(path.join(rootDir, 'a.txt'), 'merhaba dunya', 'utf8');

    let callCount = 0;
    providerHandler = async () => {
      callCount++;
      if (callCount === 1) {
        return sseResponse([
          sseChunk({
            choices: [{
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [{
                  index: 0,
                  id: 'call_read_1',
                  type: 'function',
                  function: { name: 'read_file', arguments: JSON.stringify({ path: 'a.txt' }) },
                }],
              },
            }],
          }),
          sseChunk({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }),
        ]);
      } else if (callCount === 2) {
        return sseResponse([
          sseChunk({
            choices: [{
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [{
                  index: 0,
                  id: 'call_edit_1',
                  type: 'function',
                  function: {
                    name: 'edit_file',
                    arguments: JSON.stringify({
                      path: 'a.txt',
                      old_string: 'dunya',
                      new_string: 'kanka',
                    }),
                  },
                }],
              },
            }],
          }),
          sseChunk({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }),
        ]);
      } else {
        return sseResponse([
          sseChunk({
            choices: [{
              index: 0,
              delta: { role: 'assistant', content: 'Kullanıcı onayı reddettiği için işlem iptal edildi.' },
            }],
          }),
          sseChunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
        ]);
      }
    };

    const runtime = createAgentRuntime({
      rootDir,
      sessionDir,
      sessionId: 'e2e-2',
      model: createBackendModel({
        baseUrl,
        getToken: () => 'test-token',
        retryDelaysMs: [10, 10],
      }),
      mode: 'ask',
      requestApproval: async () => ({ approved: false }),
    });

    const result = await runtime.runTurn('a.txt dosyasını güncelle');

    assert.equal(result.status, 'completed');

    const content = fs.readFileSync(path.join(rootDir, 'a.txt'), 'utf8');
    assert.equal(content, 'merhaba dunya');

    const logEvents = runtime.log.read();
    const editResult = logEvents.find((e) => e.type === 'tool/result' && e.name === 'edit_file');
    assert.ok(editResult);
    assert.equal(editResult.ok, false);
    assert.match(editResult.content, /Kullanıcı işlemi onaylamadı\./);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('3. Okumadan duzenleme kurali: model dogrudan edit_file ister; sonuc okumadan duzenleme hatasi; dosya degismez.', async () => {
  providerCalls.length = 0;
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-e2e-ws-'));
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-e2e-ss-'));
  try {
    fs.writeFileSync(path.join(rootDir, 'a.txt'), 'merhaba dunya', 'utf8');

    let callCount = 0;
    providerHandler = async () => {
      callCount++;
      if (callCount === 1) {
        return sseResponse([
          sseChunk({
            choices: [{
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [{
                  index: 0,
                  id: 'call_edit_direct',
                  type: 'function',
                  function: {
                    name: 'edit_file',
                    arguments: JSON.stringify({
                      path: 'a.txt',
                      old_string: 'dunya',
                      new_string: 'kanka',
                    }),
                  },
                }],
              },
            }],
          }),
          sseChunk({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }),
        ]);
      } else {
        return sseResponse([
          sseChunk({
            choices: [{
              index: 0,
              delta: { role: 'assistant', content: 'Dosyayı önce okumam gerektiğini anladım.' },
            }],
          }),
          sseChunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
        ]);
      }
    };

    const runtime = createAgentRuntime({
      rootDir,
      sessionDir,
      sessionId: 'e2e-3',
      model: createBackendModel({
        baseUrl,
        getToken: () => 'test-token',
        retryDelaysMs: [10, 10],
      }),
      mode: 'ask',
      requestApproval: async () => ({ approved: true }),
    });

    const result = await runtime.runTurn('a.txt dosyasını doğrudan güncelle');

    assert.equal(result.status, 'completed');

    const content = fs.readFileSync(path.join(rootDir, 'a.txt'), 'utf8');
    assert.equal(content, 'merhaba dunya');

    const logEvents = runtime.log.read();
    const editResult = logEvents.find((e) => e.type === 'tool/result' && e.name === 'edit_file');
    assert.ok(editResult);
    assert.equal(editResult.ok, false);
    assert.match(editResult.content, /Bu dosyayı önce read_file ile oku; okumadan değiştiremezsin\./);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('4. Kimlik yok: getToken null; tur failed, hata Önce giriş yap.; saglayici hic cagrilmaz.', async () => {
  providerCalls.length = 0;
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-e2e-ws-'));
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-e2e-ss-'));
  try {
    providerHandler = async () => {
      assert.fail('Sağlayıcı çağrılmamalıydı.');
    };

    const runtime = createAgentRuntime({
      rootDir,
      sessionDir,
      sessionId: 'e2e-4',
      model: createBackendModel({
        baseUrl,
        getToken: () => null,
        retryDelaysMs: [10, 10],
      }),
      mode: 'ask',
      requestApproval: async () => ({ approved: true }),
    });

    const result = await runtime.runTurn('selam');

    assert.equal(result.status, 'failed');
    assert.equal(result.error, 'Önce giriş yap.');
    assert.equal(providerCalls.length, 0);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('5. Saglayici 503: saglayici iki kez 503, ucuncude basarili akis; tur completed; saglayici 3 kez cagrildi.', async () => {
  providerCalls.length = 0;
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-e2e-ws-'));
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-e2e-ss-'));
  try {
    let callCount = 0;
    providerHandler = async () => {
      callCount++;
      if (callCount <= 2) {
        return {
          ok: false,
          status: 503,
          json: async () => ({ error: { message: 'Servis geçici olarak servis dışı' } }),
        };
      }
      return sseResponse([
        sseChunk({
          choices: [{
            index: 0,
            delta: { role: 'assistant', content: 'Üçüncü denemede başarılı.' },
          }],
        }),
        sseChunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
      ]);
    };

    const runtime = createAgentRuntime({
      rootDir,
      sessionDir,
      sessionId: 'e2e-5',
      model: createBackendModel({
        baseUrl,
        getToken: () => 'test-token',
        retryDelaysMs: [10, 10],
      }),
      mode: 'ask',
      requestApproval: async () => ({ approved: true }),
    });

    const result = await runtime.runTurn('503 senaryosu testi');

    assert.equal(result.status, 'completed');
    assert.equal(result.text, 'Üçüncü denemede başarılı.');
    assert.equal(providerCalls.length, 3);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('6. Web araci yokken: toolRegistry: null iken modelin web_search istemesi turu dusurmez; arac sonucu ok: false doner ve tur completed biter.', async () => {
  providerCalls.length = 0;
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-e2e-ws-'));
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-e2e-ss-'));
  try {
    let callCount = 0;
    providerHandler = async () => {
      callCount++;
      if (callCount === 1) {
        return sseResponse([
          sseChunk({
            choices: [{
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [{
                  index: 0,
                  id: 'call_web_search_1',
                  type: 'function',
                  function: {
                    name: 'web_search',
                    arguments: JSON.stringify({ query: 'nodejs documentation' }),
                  },
                }],
              },
            }],
          }),
          sseChunk({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }),
        ]);
      } else {
        return sseResponse([
          sseChunk({
            choices: [{
              index: 0,
              delta: { role: 'assistant', content: 'Web araması kullanılamadığı için genel bilgiyle yanıtlıyorum.' },
            }],
          }),
          sseChunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
        ]);
      }
    };

    const runtime = createAgentRuntime({
      rootDir,
      sessionDir,
      sessionId: 'e2e-6',
      model: createBackendModel({
        baseUrl,
        getToken: () => 'test-token',
        retryDelaysMs: [10, 10],
      }),
      mode: 'ask',
      requestApproval: async () => ({ approved: true }),
    });

    const result = await runtime.runTurn('Webde nodejs dokümantasyonunu ara');

    assert.equal(result.status, 'completed');

    const logEvents = runtime.log.read();
    const searchResult = logEvents.find((e) => e.type === 'tool/result' && e.name === 'web_search');
    assert.ok(searchResult);
    assert.equal(searchResult.ok, false);
    assert.match(searchResult.content, /Web araçları şu anda kullanılamıyor/);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});
