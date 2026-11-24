'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBackendModel, parseSseStream } = require('../modelAdapter.cjs');

// Yardimcilar
function sse(obj) {
  return `data: ${typeof obj === 'string' ? obj : JSON.stringify(obj)}\n\n`;
}

function contentChunk(text) {
  return { choices: [{ index: 0, delta: { content: text } }] };
}

function iterBody(chunks) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) {
        yield typeof c === 'string' ? Buffer.from(c, 'utf8') : c;
      }
    },
  };
}

function readerBody(chunks) {
  let i = 0;
  return {
    getReader() {
      return {
        async read() {
          if (i >= chunks.length) return { done: true, value: undefined };
          const c = chunks[i++];
          return { done: false, value: typeof c === 'string' ? new TextEncoder().encode(c) : c };
        },
        async cancel() {},
        releaseLock() {},
      };
    },
  };
}

function okResponse(body) {
  return { ok: true, status: 200, body, async json() { return {}; }, async text() { return ''; } };
}

function errorResponse(status, message) {
  const payload = message === undefined ? {} : { error: { message } };
  return {
    ok: false,
    status,
    body: null,
    async json() { return payload; },
    async text() { return JSON.stringify(payload); },
  };
}

function makeFetch(responders) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const r = responders[Math.min(calls.length - 1, responders.length - 1)];
    return typeof r === 'function' ? r(url, init) : r;
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

const noSleep = async () => {};

function baseModel(fetchImpl, extra = {}) {
  return createBackendModel({
    baseUrl: 'https://api.example.com/',
    getToken: async () => 'tok-123',
    fetchImpl,
    sleep: noSleep,
    ...extra,
  });
}

const simpleMessages = [{ role: 'user', content: 'selam' }];

test('1. metin parcalari birlesir, onDelta her parca icin cagrilir, usage doner', async () => {
  const fetchImpl = makeFetch([
    okResponse(
      iterBody([
        sse(contentChunk('Mer')),
        sse(contentChunk('haba ')),
        sse({ choices: [{ index: 0, delta: { reasoning_content: 'dusunce' } }] }),
        sse(contentChunk('dünya')),
        sse({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }),
        sse('[DONE]'),
      ])
    ),
  ]);
  const deltas = [];
  const res = await baseModel(fetchImpl).complete({
    messages: simpleMessages,
    tools: [],
    onDelta: (d) => deltas.push(d),
  });
  assert.equal(res.content, 'Merhaba dünya');
  assert.deepEqual(deltas, ['Mer', 'haba ', 'dünya']);
  assert.deepEqual(res.toolCalls, []);
  assert.deepEqual(res.usage, { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 });
  assert.equal(fetchImpl.calls[0].url, 'https://api.example.com/ide/complete');
});

test('2. arac cagrisi index e gore birlesir, iki paralel cagri ayri doner', async () => {
  const tc = (arr) => ({ choices: [{ index: 0, delta: { tool_calls: arr } }] });
  const fetchImpl = makeFetch([
    okResponse(
      iterBody([
        sse(tc([{ index: 0, id: 'call_a', function: { name: 'read_file', arguments: '{"pa' } }])),
        sse(tc([{ index: 1, id: 'call_b', function: { name: 'list_dir', arguments: '' } }])),
        sse(tc([{ index: 0, function: { arguments: 'th":"a.' } }])),
        sse(tc([{ index: 1, function: { arguments: '{}' } }])),
        sse(tc([{ index: 0, function: { arguments: 'js"}' } }])),
        sse('[DONE]'),
      ])
    ),
  ]);
  const res = await baseModel(fetchImpl).complete({ messages: simpleMessages, tools: [] });
  assert.equal(res.content, '');
  assert.deepEqual(res.toolCalls, [
    { id: 'call_a', name: 'read_file', arguments: '{"path":"a.js"}' },
    { id: 'call_b', name: 'list_dir', arguments: '{}' },
  ]);
  assert.equal(res.usage, null);
});

test('3. satir ve UTF-8 karakteri parca ortasinda bolunse de dogru birlesir', async () => {
  const full =
    sse(contentChunk('ağaç ')).replace(/\n\n$/, '\r\n\r\n') + sse(contentChunk('şişe')) + sse('[DONE]');
  const bytes = Buffer.from(full, 'utf8');
  // 'ğ' ve 'ş' baytlarinin ortasindan bol
  const gIdx = bytes.indexOf(Buffer.from('ğ', 'utf8'));
  const sIdx = bytes.indexOf(Buffer.from('ş', 'utf8'));
  const chunks = [
    bytes.subarray(0, 4), // "data" ortasinda
    bytes.subarray(4, gIdx + 1), // ğ'nin ilk bayti
    bytes.subarray(gIdx + 1, sIdx + 1), // ş'nin ilk bayti
    bytes.subarray(sIdx + 1),
  ];
  const deltas = [];
  const res = await parseSseStream(iterBody(chunks), { onDelta: (d) => deltas.push(d) });
  assert.equal(res.content, 'ağaç şişe');
  assert.deepEqual(deltas, ['ağaç ', 'şişe']);
  assert.equal(res.sawDone, true);
});

test('4. getReader li govde de okunur', async () => {
  const fetchImpl = makeFetch([
    okResponse(
      readerBody([
        'data: {"choices":[{"delta":{"content":"Sel"}}]}\n',
        '\ndata: bozuk-json\n\n: yorum\n',
        sse(contentChunk('am')),
        sse('[DONE]'),
      ])
    ),
  ]);
  const res = await baseModel(fetchImpl).complete({ messages: simpleMessages });
  assert.equal(res.content, 'Selam');
});

test('5. istek govdesi: bos tools gonderilmez, toolChoice none, Authorization, stream true', async () => {
  const mk = () => okResponse(iterBody([sse(contentChunk('x')), sse('[DONE]')]));
  const fetchImpl = makeFetch([mk, mk, mk]);
  const model = baseModel(fetchImpl, { model: 'm1', provider: 'p1' });

  await model.complete({ messages: simpleMessages, tools: [] });
  let init = fetchImpl.calls[0].init;
  let body = JSON.parse(init.body);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.equal(init.headers.Authorization, 'Bearer tok-123');
  assert.equal(body.stream, true);
  assert.deepEqual(body.messages, simpleMessages);
  assert.equal('tools' in body, false);
  assert.equal('tool_choice' in body, false);
  assert.equal(body.model, 'm1');
  assert.equal(body.provider, 'p1');

  const tools = [{ type: 'function', function: { name: 'read_file', parameters: {} } }];
  await model.complete({ messages: simpleMessages, tools, toolChoice: 'none' });
  body = JSON.parse(fetchImpl.calls[1].init.body);
  assert.deepEqual(body.tools, tools);
  assert.equal(body.tool_choice, 'none');

  await model.complete({ messages: simpleMessages, tools });
  body = JSON.parse(fetchImpl.calls[2].init.body);
  assert.equal(body.tool_choice, 'auto');
});

test('6. baseUrl yok ya da jeton yok: fetch cagrilmaz', async () => {
  const fetchImpl = makeFetch([okResponse(iterBody([]))]);
  const noUrl = createBackendModel({ baseUrl: '', getToken: () => 'x', fetchImpl, sleep: noSleep });
  await assert.rejects(noUrl.complete({ messages: simpleMessages }), {
    message: 'Backend adresi ayarlı değil.',
  });
  const noToken = createBackendModel({
    baseUrl: 'http://x',
    getToken: async () => null,
    fetchImpl,
    sleep: noSleep,
  });
  await assert.rejects(noToken.complete({ messages: simpleMessages }), { message: 'Önce giriş yap.' });
  assert.equal(fetchImpl.calls.length, 0);
});

test('7. 503 iki kez gelip ucuncude basarirsa sonuc doner, fetch uc kez cagrilir', async () => {
  const sleeps = [];
  const fetchImpl = makeFetch([
    errorResponse(503, 'Servis yoğun.'),
    errorResponse(503, 'Servis yoğun.'),
    okResponse(iterBody([sse(contentChunk('tamam')), sse('[DONE]')])),
  ]);
  const res = await baseModel(fetchImpl, { sleep: async (ms) => sleeps.push(ms) }).complete({
    messages: simpleMessages,
  });
  assert.equal(res.content, 'tamam');
  assert.equal(fetchImpl.calls.length, 3);
  assert.deepEqual(sleeps, [500, 1500]);
});

test('7b. 503 hep gelirse son hata firlatilir ve status tasir', async () => {
  const fetchImpl = makeFetch([errorResponse(503, 'Servis yoğun.')]);
  await assert.rejects(baseModel(fetchImpl).complete({ messages: simpleMessages }), (err) => {
    assert.equal(err.message, 'Servis yoğun.');
    assert.equal(err.status, 503);
    return true;
  });
  assert.equal(fetchImpl.calls.length, 3);
});

test('8. delta geldikten sonra akis koparsa yeniden denenmez', async () => {
  const brokenBody = {
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(sse(contentChunk('yarım')), 'utf8');
      throw new Error('socket hang up');
    },
  };
  const fetchImpl = makeFetch([
    okResponse(brokenBody),
    okResponse(iterBody([sse(contentChunk('ikinci')), sse('[DONE]')])),
  ]);
  const deltas = [];
  await assert.rejects(
    baseModel(fetchImpl).complete({ messages: simpleMessages, onDelta: (d) => deltas.push(d) })
  );
  assert.equal(fetchImpl.calls.length, 1);
  assert.deepEqual(deltas, ['yarım']);
});

test('8b. ag hatasi (delta yokken) yeniden denenir', async () => {
  let n = 0;
  const fetchImpl = makeFetch([
    () => {
      n += 1;
      throw new TypeError('fetch failed');
    },
    okResponse(iterBody([sse(contentChunk('oldu')), sse('[DONE]')])),
  ]);
  const res = await baseModel(fetchImpl).complete({ messages: simpleMessages });
  assert.equal(res.content, 'oldu');
  assert.equal(n, 1);
  assert.equal(fetchImpl.calls.length, 2);
});

test('9. 400 ve 401 yeniden denenmez; 401 mesaji sabittir', async () => {
  const f400 = makeFetch([errorResponse(400, 'Geçersiz istek.')]);
  await assert.rejects(baseModel(f400).complete({ messages: simpleMessages }), (err) => {
    assert.equal(err.message, 'Geçersiz istek.');
    assert.equal(err.status, 400);
    return true;
  });
  assert.equal(f400.calls.length, 1);

  const f401 = makeFetch([errorResponse(401, 'token expired')]);
  await assert.rejects(baseModel(f401).complete({ messages: simpleMessages }), (err) => {
    assert.equal(err.message, 'Oturum süresi doldu, yeniden giriş yap.');
    assert.equal(err.status, 401);
    return true;
  });
  assert.equal(f401.calls.length, 1);

  const f500 = makeFetch([errorResponse(500)]);
  await assert.rejects(baseModel(f500).complete({ messages: simpleMessages }), {
    message: 'Yapay zekâ servisine şu anda ulaşılamıyor.',
  });
  assert.equal(f500.calls.length, 1);

  const backendBalanceMsg =
    'Yapay zekâ sağlayıcısının bakiyesi yetersiz. Başka bir model seç ya da yöneticiye haber ver.';
  const f402 = makeFetch([errorResponse(402, backendBalanceMsg)]);
  await assert.rejects(baseModel(f402).complete({ messages: simpleMessages }), (err) => {
    assert.equal(err.message, backendBalanceMsg);
    assert.equal(err.status, 402);
    return true;
  });
  assert.equal(f402.calls.length, 1);
});

test('10. bos akis Model boş yanıt döndürdü.', async () => {
  const fetchImpl = makeFetch([
    okResponse(iterBody([sse({ choices: [{ delta: { content: '' } }] }), sse('[DONE]')])),
  ]);
  await assert.rejects(baseModel(fetchImpl).complete({ messages: simpleMessages }), {
    message: 'Model boş yanıt döndürdü.',
  });
  assert.equal(fetchImpl.calls.length, 1);
});

test('11. cagiranin sinyali iptal edilince yeniden denenmez ve hata firlatilir', async () => {
  const controller = new AbortController();
  const fetchImpl = makeFetch([
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const e = new Error('This operation was aborted');
          e.name = 'AbortError';
          reject(e);
        });
        setTimeout(() => controller.abort(), 5);
      }),
  ]);
  await assert.rejects(
    baseModel(fetchImpl).complete({ messages: simpleMessages, signal: controller.signal }),
    (err) => {
      assert.notEqual(err.message, 'Model yanıtı zaman aşımına uğradı.');
      return true;
    }
  );
  assert.equal(controller.signal.aborted, true);
  assert.equal(fetchImpl.calls.length, 1);

  // Onceden iptal edilmis sinyal: fetch hic cagrilmaz
  const f2 = makeFetch([okResponse(iterBody([sse(contentChunk('x'))]))]);
  await assert.rejects(
    baseModel(f2).complete({ messages: simpleMessages, signal: controller.signal })
  );
  assert.equal(f2.calls.length, 0);
});

test('12. zaman asimi Model yanıtı zaman aşımına uğradı.', async () => {
  const hanging = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const e = new Error('aborted');
        e.name = 'AbortError';
        reject(e);
      });
    });
  const fetchImpl = makeFetch([hanging]);
  await assert.rejects(
    baseModel(fetchImpl, { timeoutMs: 20 }).complete({ messages: simpleMessages }),
    { message: 'Model yanıtı zaman aşımına uğradı.' }
  );
  // Zaman asimi yeniden denenir: 1 + 2 deneme
  assert.equal(fetchImpl.calls.length, 3);
});

test('13. webSearch: istek gövdesi ({ query }), başlıklar, başarıda results döner', async () => {
  const fetchImpl = makeFetch([
    {
      ok: true,
      status: 200,
      async json() {
        return {
          results: [
            { title: 'Node.js', url: 'https://nodejs.org', snippet: 'Docs' },
          ],
        };
      },
    },
  ]);

  const model = baseModel(fetchImpl);
  const results = await model.webSearch('node test runner');

  assert.deepEqual(results, [
    { title: 'Node.js', url: 'https://nodejs.org', snippet: 'Docs' },
  ]);
  assert.equal(fetchImpl.calls.length, 1);
  const call = fetchImpl.calls[0];
  assert.equal(call.url, 'https://api.example.com/ide/web/search');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers['Content-Type'], 'application/json');
  assert.equal(call.init.headers.Authorization, 'Bearer tok-123');
  assert.deepEqual(JSON.parse(call.init.body), { query: 'node test runner' });
});

test('14. webFetch: istek gövdesi ({ url }), başlıklar, başarıda page döner', async () => {
  const fetchImpl = makeFetch([
    {
      ok: true,
      status: 200,
      async json() {
        return {
          page: {
            url: 'https://example.com',
            title: 'Example',
            content: 'Hello World',
            truncated: false,
          },
        };
      },
    },
  ]);

  const model = baseModel(fetchImpl);
  const page = await model.webFetch('https://example.com');

  assert.deepEqual(page, {
    url: 'https://example.com',
    title: 'Example',
    content: 'Hello World',
    truncated: false,
  });
  assert.equal(fetchImpl.calls.length, 1);
  const call = fetchImpl.calls[0];
  assert.equal(call.url, 'https://api.example.com/ide/web/fetch');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers['Content-Type'], 'application/json');
  assert.equal(call.init.headers.Authorization, 'Bearer tok-123');
  assert.deepEqual(JSON.parse(call.init.body), { url: 'https://example.com' });
});

test('15. webSearch ve webFetch: baseUrl / jeton yoksa fetch çağrılmaz; 401 ve diğer hatalar', async () => {
  const fetchImpl = makeFetch([
    errorResponse(401, 'unauthorized token'),
    errorResponse(502, 'Web isteği başarısız oldu.'),
  ]);

  const noUrl = createBackendModel({ baseUrl: '', getToken: () => 'tok', fetchImpl });
  await assert.rejects(noUrl.webSearch('q'), { message: 'Backend adresi ayarlı değil.' });
  await assert.rejects(noUrl.webFetch('https://example.com'), { message: 'Backend adresi ayarlı değil.' });
  assert.equal(fetchImpl.calls.length, 0);

  const noToken = createBackendModel({ baseUrl: 'http://example.com', getToken: () => null, fetchImpl });
  await assert.rejects(noToken.webSearch('q'), { message: 'Önce giriş yap.' });
  await assert.rejects(noToken.webFetch('https://example.com'), { message: 'Önce giriş yap.' });
  assert.equal(fetchImpl.calls.length, 0);

  const model = baseModel(fetchImpl);
  await assert.rejects(model.webSearch('q'), { message: 'Oturum süresi doldu, yeniden giriş yap.' });
  await assert.rejects(model.webFetch('https://example.com'), { message: 'Web isteği başarısız oldu.' });
  assert.equal(fetchImpl.calls.length, 2);
});

test('16. webSearch ve webFetch: yeniden deneme YOK (503 tek istek), signal iptali iletilir', async () => {
  const fetchImpl = makeFetch([
    errorResponse(503, 'Servis yoğun.'),
    errorResponse(503, 'Servis yoğun.'),
  ]);

  const model = baseModel(fetchImpl);
  await assert.rejects(model.webSearch('q'), { message: 'Servis yoğun.' });
  assert.equal(fetchImpl.calls.length, 1);

  await assert.rejects(model.webFetch('https://example.com'), { message: 'Servis yoğun.' });
  assert.equal(fetchImpl.calls.length, 2);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(model.webSearch('q', { signal: controller.signal }));
  // Zaten iptal edilmiş sinyal ile fetch çağrılmaz
  assert.equal(fetchImpl.calls.length, 2);
});

test('17. setSelection ve getSelection: secim govdeye girer, null ve gecersiz tiplerde girmez', async () => {
  const mk = () => okResponse(iterBody([sse(contentChunk('ok')), sse('[DONE]')]));
  const fetchImpl = makeFetch([mk, mk, mk, mk]);
  const model = baseModel(fetchImpl, { model: 'init-m', provider: 'init-p' });

  assert.deepEqual(model.getSelection(), { model: 'init-m', provider: 'init-p' });
  await model.complete({ messages: simpleMessages });
  let body = JSON.parse(fetchImpl.calls[0].init.body);
  assert.equal(body.model, 'init-m');
  assert.equal(body.provider, 'init-p');

  model.setSelection({ model: 'm2', provider: 'p2' });
  assert.deepEqual(model.getSelection(), { model: 'm2', provider: 'p2' });
  await model.complete({ messages: simpleMessages });
  body = JSON.parse(fetchImpl.calls[1].init.body);
  assert.equal(body.model, 'm2');
  assert.equal(body.provider, 'p2');

  model.setSelection(null);
  assert.equal(model.getSelection(), null);
  await model.complete({ messages: simpleMessages });
  body = JSON.parse(fetchImpl.calls[2].init.body);
  assert.equal('model' in body, false);
  assert.equal('provider' in body, false);

  model.setSelection('gecersiz');
  assert.equal(model.getSelection(), null);
  model.setSelection({ model: '', provider: 'p2' });
  assert.equal(model.getSelection(), null);
  model.setSelection({ model: 123, provider: 'p2' });
  assert.equal(model.getSelection(), null);
  await model.complete({ messages: simpleMessages });
  body = JSON.parse(fetchImpl.calls[3].init.body);
  assert.equal('model' in body, false);
  assert.equal('provider' in body, false);
});

test('18. listModels: istek, basari ve hata durumlari', async () => {
  const payload = {
    models: [
      { id: 'deepseek-chat', provider: 'deepseek', label: 'DeepSeek Chat' },
      { id: 'gpt-5', provider: 'openai', label: 'GPT-5' },
    ],
    default: { id: 'deepseek-chat', provider: 'deepseek' },
  };
  const fetchImpl = makeFetch([
    {
      ok: true,
      status: 200,
      async json() {
        return payload;
      },
    },
    errorResponse(401, 'unauthorized'),
    errorResponse(503, 'Servis yok'),
  ]);

  const noUrl = createBackendModel({ baseUrl: '', getToken: () => 'tok', fetchImpl });
  await assert.rejects(noUrl.listModels(), { message: 'Backend adresi ayarlı değil.' });

  const noToken = createBackendModel({ baseUrl: 'https://api.example.com', getToken: () => null, fetchImpl });
  await assert.rejects(noToken.listModels(), { message: 'Önce giriş yap.' });
  assert.equal(fetchImpl.calls.length, 0);

  const model = baseModel(fetchImpl);
  const res = await model.listModels();
  assert.deepEqual(res, payload);
  assert.equal(fetchImpl.calls[0].url, 'https://api.example.com/ide/models');
  assert.equal(fetchImpl.calls[0].init.method, 'GET');
  assert.equal(fetchImpl.calls[0].init.headers.Authorization, 'Bearer tok-123');

  await assert.rejects(model.listModels(), { message: 'Oturum süresi doldu, yeniden giriş yap.' });
  await assert.rejects(model.listModels(), (err) => {
    assert.equal(err.message, 'Servis yok');
    assert.equal(err.status, 503);
    return true;
  });

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(model.listModels({ signal: controller.signal }));
  assert.equal(fetchImpl.calls.length, 3);
});

test('19. extra_content li tool_calls deltasi birlesince alan korunur, olmayan cagrida anahtar bulunmaz', async () => {
  const tc = (arr) => ({ choices: [{ index: 0, delta: { tool_calls: arr } }] });
  const fetchImpl = makeFetch([
    okResponse(
      iterBody([
        sse(
          tc([
            {
              index: 0,
              id: 'call_g1',
              function: { name: 'read_file', arguments: '{"path":' },
              extra_content: { google: { thought_signature: 'sig_ilk' } },
            },
          ])
        ),
        sse(
          tc([
            {
              index: 0,
              function: { arguments: '"a.js"}' },
              extra_content: { google: { thought_signature: 'sig_son' } },
            },
            {
              index: 1,
              id: 'call_g2',
              function: { name: 'list_dir', arguments: '{}' },
            },
          ])
        ),
        sse('[DONE]'),
      ])
    ),
  ]);
  const res = await baseModel(fetchImpl).complete({ messages: simpleMessages, tools: [] });
  assert.deepEqual(res.toolCalls, [
    {
      id: 'call_g1',
      name: 'read_file',
      arguments: '{"path":"a.js"}',
      extra_content: { google: { thought_signature: 'sig_son' } },
    },
    {
      id: 'call_g2',
      name: 'list_dir',
      arguments: '{}',
    },
  ]);
  assert.equal('extra_content' in res.toolCalls[1], false);
});
