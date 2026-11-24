const test = require('node:test');
const assert = require('node:assert/strict');
const { ToolRegistry, prepareExtraTools, z } = require('../agent/toolRegistry');

function baseRegistry() {
  return new ToolRegistry().register({
    name: 'calculate',
    description: 'Hesap',
    inputSchema: z.object({ expression: z.string() }).strict(),
    jsonSchema: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'], additionalProperties: false },
    execute: async () => 1,
  });
}

const extraTools = prepareExtraTools([
  {
    name: 'notion__search',
    description: '[Notion] Ara',
    inputSchema: z.record(z.string(), z.unknown()),
    jsonSchema: { type: 'object', properties: { query: { type: 'string' } } },
    strict: false,
    execute: async args => ({ found: args.query }),
  },
  {
    name: 'notion__create_page',
    description: '[Notion] Sayfa oluştur',
    requiresConfirmation: true,
    inputSchema: z.record(z.string(), z.unknown()),
    jsonSchema: { type: 'object', properties: {} },
    strict: false,
    execute: async () => ({ created: true }),
  },
]);

test('ek araçlar yalnızca o isteğin bağlamında görünür, ortak depoya yazılmaz', () => {
  const registry = baseRegistry();
  assert.deepEqual(registry.list({}).map(tool => tool.name), ['calculate']);
  assert.deepEqual(registry.list({ extraTools }).map(tool => tool.name), ['calculate', 'notion__search', 'notion__create_page']);
  assert.equal(registry.get('notion__search'), undefined);
  assert.equal(registry.get('notion__search', { extraTools }).name, 'notion__search');
});

test('ek araç ortak araçla aynı adı taşıyamaz', () => {
  const registry = baseRegistry();
  const clash = prepareExtraTools([{ name: 'calculate', description: 'x', inputSchema: z.object({}), jsonSchema: {}, execute: async () => 0 }]);
  assert.equal(registry.get('calculate', { extraTools: clash }).description, 'Hesap');
  assert.deepEqual(registry.list({ extraTools: clash }).map(tool => tool.name), ['calculate']);
});

test('validate ek araç şemasını kullanır', () => {
  const registry = baseRegistry();
  assert.deepEqual(registry.validate('notion__search', '{"query":"plan"}', { extraTools }), { query: 'plan' });
  assert.throws(() => registry.validate('notion__search', '{"query":"plan"}'), /Bilinmeyen araç/);
});

test('sohbet biçimi onay isteyen ek aracı vermez; OpenAI biçimi strict:false taşır', () => {
  const registry = baseRegistry();
  assert.deepEqual(registry.toChatCompletionsTools({ extraTools }).map(tool => tool.function.name), ['calculate', 'notion__search']);
  const openai = registry.toOpenAITools({ extraTools });
  assert.equal(openai.find(tool => tool.name === 'calculate').strict, true);
  assert.equal(openai.find(tool => tool.name === 'notion__search').strict, false);
});

test('sohbet biçiminde ["x","null"] birleşik tipleri sadeleşir ve alan isteğe bağlı olur; OpenAI strict biçimi değişmez', () => {
  const registry = new ToolRegistry().register({
    name: 'load_skill',
    description: 'skill',
    inputSchema: z.object({ name: z.string(), file: z.string().nullable().optional() }).strict(),
    jsonSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, file: { type: ['string', 'null'], description: 'ek dosya' }, nested: { type: 'object', properties: { x: { type: ['number', 'null'] } }, required: ['x'] } },
      required: ['name', 'file', 'nested'],
      additionalProperties: false,
    },
    execute: async () => ({}),
  });
  const [chat] = registry.toChatCompletionsTools({});
  assert.deepEqual(chat.function.parameters.properties.file, { type: 'string', description: 'ek dosya' });
  assert.deepEqual(chat.function.parameters.required, ['name', 'nested']);
  assert.deepEqual(chat.function.parameters.properties.nested.properties.x, { type: 'number' });
  assert.deepEqual(chat.function.parameters.properties.nested.required, []);
  const [openai] = registry.toOpenAITools({});
  assert.deepEqual(openai.parameters.properties.file.type, ['string', 'null']);
  assert.deepEqual(openai.parameters.required, ['name', 'file', 'nested']);
});

test('repodaki hiçbir sohbet aracı birleşik tip göndermez', () => {
  const path = require('node:path');
  const { createDefaultToolRegistry } = require('../agent/tools');
  const { createSkillStore } = require('../skills/skillStore');
  const registry = createDefaultToolRegistry({ env: {}, webSearch: async () => ({ items: [] }), skillStore: createSkillStore({ root: path.join(__dirname, '..', 'skills') }) });
  const text = JSON.stringify(registry.toChatCompletionsTools({ userId: 'u1', firestoreDb: {} }));
  assert.doesNotMatch(text, /"type":\[/);
});

test('executeWithRetry geçici hatada yeniden dener, onay isteyen aracı ve zaman aşımını yeniden denemez', async () => {
  const { executeWithRetry } = require('../agent/toolRegistry');

  // varsayılan retries 0'dır
  const reg = baseRegistry();
  assert.equal(reg.get('calculate').retries, 0);

  // retries: 1 ilk denemede fırlatıp ikincide başarırsa sonuç döner ve execute iki kez çağrılır
  let attempts1 = 0;
  const retryTool = new ToolRegistry().register({
    name: 'flaky_read',
    description: 'okuma',
    retries: 1,
    inputSchema: z.object({}),
    jsonSchema: {},
    execute: async () => {
      attempts1 += 1;
      if (attempts1 === 1) throw new Error('geçici ağ hatası');
      return { okData: 42 };
    },
  }).get('flaky_read');
  const res1 = await executeWithRetry(retryTool, {}, {}, { delayMs: 5 });
  assert.deepEqual(res1, { okData: 42 });
  assert.equal(attempts1, 2);

  // retries: 0 ise bir kez çağrılır ve hata fırlatılır
  let attempts0 = 0;
  const noRetryTool = new ToolRegistry().register({
    name: 'no_retry',
    description: 'okuma',
    retries: 0,
    inputSchema: z.object({}),
    jsonSchema: {},
    execute: async () => {
      attempts0 += 1;
      throw new Error('kalıcı hata');
    },
  }).get('no_retry');
  await assert.rejects(() => executeWithRetry(noRetryTool, {}, {}, { delayMs: 5 }), /kalıcı hata/);
  assert.equal(attempts0, 1);

  // requiresConfirmation: true + retries: 2 ise bir kez çağrılır
  let attemptsConfirm = 0;
  const confirmTool = new ToolRegistry().register({
    name: 'write_op',
    description: 'yazma',
    requiresConfirmation: true,
    retries: 2,
    inputSchema: z.object({}),
    jsonSchema: {},
    execute: async () => {
      attemptsConfirm += 1;
      throw new Error('yazma hatası');
    },
  }).get('write_op');
  await assert.rejects(() => executeWithRetry(confirmTool, {}, {}, { delayMs: 5 }), /yazma hatası/);
  assert.equal(attemptsConfirm, 1);

  // toplam süre aşılınca zaman aşımı hatası ve ek deneme yok
  let attemptsTimeout = 0;
  const slowTool = new ToolRegistry().register({
    name: 'slow_read',
    description: 'yavaş',
    retries: 2,
    timeoutMs: 40,
    inputSchema: z.object({}),
    jsonSchema: {},
    execute: async () => {
      attemptsTimeout += 1;
      await new Promise(resolve => setTimeout(resolve, 100));
      return 'done';
    },
  }).get('slow_read');
  await assert.rejects(() => executeWithRetry(slowTool, {}, {}, { timeoutMs: 30, delayMs: 5 }), /slow_read zaman aşımına uğradı\./);
  assert.equal(attemptsTimeout, 1);
});

test('tools.js içinde yalnızca beş okuma aracının retries değeri 1, diğerlerinin 0 olur', () => {
  const path = require('node:path');
  const { createDefaultToolRegistry } = require('../agent/tools');
  const { createSkillStore } = require('../skills/skillStore');
  const registry = createDefaultToolRegistry({
    env: { GMAIL_USER: 'a@b.c', GMAIL_APP_PASSWORD: 'p' },
    webSearch: async () => ({ items: [] }),
    skillStore: createSkillStore({ root: path.join(__dirname, '..', 'skills') }),
  });
  for (const name of ['web_search', 'get_weather', 'convert_currency', 'search_wikipedia', 'scrape_website']) {
    assert.equal(registry.get(name).retries, 1, name);
  }
  assert.equal(registry.get('send_email').retries, 0);
  assert.equal(registry.get('install_skill').retries, 0);
  assert.equal(registry.get('calculate').retries, 0);
});
