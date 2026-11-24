const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { extractDsmlToolCalls, createDsmlStreamFilter } = require('../llm/dsml');
const { runChatToolLoop } = require('../llm/chatToolLoop');

const LEAK = '<｜DSML｜function_calls>\n'
  + '<｜DSML｜invoke name="scrape_website">\n'
  + '<｜DSML｜parameter name="url" string="true">https://rust.facepunch.com/news/2015</｜DSML｜parameter>\n'
  + '<｜DSML｜parameter name="limit" string="false">3</｜DSML｜parameter>\n'
  + '</｜DSML｜invoke>\n'
  + '<｜DSML｜invoke name="web_search">\n'
  + '<｜DSML｜parameter name="query" string="true">rust attack helicopter</｜DSML｜parameter>\n'
  + '</｜DSML｜invoke>\n'
  + '</｜DSML｜function_calls>';

const sseResponse = chunks => ({
  ok: true,
  status: 200,
  body: Readable.from(chunks.map(chunk => `data: ${typeof chunk === 'string' ? chunk : JSON.stringify(chunk)}\n\n`)),
});
const jsonResponse = body => ({ ok: true, status: 200, json: async () => body });

function fakeRes() {
  const written = [];
  return { written, write: text => written.push(text), end: () => written.push('<end>'), text: () => written.join('') };
}

test('DSML araç çağrıları ayrıştırılır, önceki metin korunur', () => {
  const result = extractDsmlToolCalls(`Bakıyorum.\n${LEAK}`);
  assert.equal(result.text, 'Bakıyorum.');
  assert.deepEqual(result.toolCalls.map(call => call.function.name), ['scrape_website', 'web_search']);
  assert.deepEqual(JSON.parse(result.toolCalls[0].function.arguments), { url: 'https://rust.facepunch.com/news/2015', limit: 3 });
  assert.equal(result.toolCalls[0].id, 'dsml_0');
});

test('ASCII çubuklu ve boşluklu DSML de tanınır', () => {
  const result = extractDsmlToolCalls('< | DSML | function_calls><| DSML |invoke name="web_search"><|DSML|parameter name="query" string="true">x</|DSML|parameter></|DSML|invoke>');
  assert.equal(result.toolCalls[0].function.name, 'web_search');
  assert.equal(JSON.parse(result.toolCalls[0].function.arguments).query, 'x');
});

test('DSML yoksa null döner; sıradan < içeren metne dokunulmaz', () => {
  assert.equal(extractDsmlToolCalls('3 < 5 ve <b>kalın</b>'), null);
});

test('Akış filtresi parçalara bölünmüş DSML işaretini kullanıcıya sızdırmaz', () => {
  const out = [];
  const filter = createDsmlStreamFilter(text => out.push(text));
  for (const piece of ['Tamam, bakı', 'yorum. <', '｜DS', 'ML｜function_calls><｜DSML｜invoke name="x">', '...']) filter.push(piece);
  filter.flush();
  assert.equal(out.join(''), 'Tamam, bakıyorum. ');
});

test('Akış filtresi DSML olmayan < karakterini bekletip sonra iletir', () => {
  const out = [];
  const filter = createDsmlStreamFilter(text => out.push(text));
  filter.push('a <');
  filter.push(' b');
  filter.push(' <');
  filter.flush();
  assert.equal(out.join(''), 'a < b <');
});

test('Akışta metne sızan DSML gerçek araç çağrısına çevrilir ve ekrana yazılmaz', async () => {
  const payloads = [];
  const executed = [];
  const responses = [
    sseResponse([{ choices: [{ delta: { content: LEAK.slice(0, 40) } }] }, { choices: [{ delta: { content: LEAK.slice(40) } }] }, '[DONE]']),
    sseResponse([{ choices: [{ delta: { content: '2017 sonlarında eklendi.' } }] }, '[DONE]']),
  ];
  const res = fakeRes();
  const result = await runChatToolLoop({
    send: async body => { payloads.push(body); return responses.shift(); },
    payload: { model: 'deepseek-reasoner', stream: true, messages: [{ role: 'user', content: 'heli?' }] },
    tools: [],
    executeTool: async (name, args) => { executed.push([name, JSON.parse(args)]); return { ok: true, result: {} }; },
    res,
  });
  assert.equal(result.ok, true);
  assert.doesNotMatch(res.text(), /DSML/);
  assert.match(res.text(), /2017 sonlarında eklendi\./);
  assert.deepEqual(executed.map(([name]) => name), ['scrape_website', 'web_search']);
  const assistantTurn = payloads[1].messages.find(message => message.tool_calls);
  assert.equal(assistantTurn.content, null);
  assert.equal(payloads[1].messages.filter(message => message.role === 'tool').length, 2);
});

test('Son turda DSML yazılırsa bir kez araçsız yeniden istenir', async () => {
  const payloads = [];
  const send = async body => {
    payloads.push(body);
    if (body.tool_choice === 'auto') return jsonResponse({ choices: [{ message: { tool_calls: [{ id: `c${payloads.length}`, type: 'function', function: { name: 'web_search', arguments: `{"query":"q${payloads.length}"}` } }] } }] });
    if (body.tool_choice === 'none') return jsonResponse({ choices: [{ message: { content: LEAK } }] });
    return jsonResponse({ choices: [{ message: { content: 'Elimdekiyle cevap.' } }] });
  };
  const result = await runChatToolLoop({
    send,
    payload: { model: 'deepseek-reasoner', messages: [{ role: 'user', content: 'x' }] },
    tools: [],
    executeTool: async () => ({ ok: true, result: {} }),
    maxRounds: 2,
  });
  assert.equal(result.data.choices[0].message.content, 'Elimdekiyle cevap.');
  const last = payloads.at(-1);
  assert.equal(last.tools, undefined);
  assert.equal(last.tool_choice, undefined);
  assert.match(last.messages.at(-1).content, /araç çağıramazsın/);
  assert.equal(payloads.length, 4);
});

test('Yeniden istekte de DSML gelirse ham metin yerine kısa bir açıklama döner', async () => {
  const send = async () => jsonResponse({ choices: [{ message: { content: LEAK } }] });
  const result = await runChatToolLoop({
    send,
    payload: { model: 'deepseek-reasoner', messages: [{ role: 'user', content: 'x' }] },
    tools: [],
    executeTool: async () => ({ ok: true, result: {} }),
    maxRounds: 0,
  });
  assert.doesNotMatch(result.data.choices[0].message.content, /DSML/);
  assert.match(result.data.choices[0].message.content, /aksilik/);
});

test('Aynı turdaki araçlar paralel çalışır, sonuçlar çağrı sırasıyla modele döner', async () => {
  const payloads = [];
  const calls = [
    { id: 'a', type: 'function', function: { name: 'slow', arguments: '{}' } },
    { id: 'b', type: 'function', function: { name: 'fast', arguments: '{}' } },
  ];
  const responses = [
    jsonResponse({ choices: [{ message: { content: null, tool_calls: calls } }] }),
    jsonResponse({ choices: [{ message: { content: 'bitti' } }] }),
  ];
  let running = 0;
  let maxRunning = 0;
  const completionOrder = [];
  const executeTool = async name => {
    running += 1;
    maxRunning = Math.max(maxRunning, running);
    if (name === 'slow') await new Promise(resolve => setImmediate(resolve));
    running -= 1;
    completionOrder.push(name);
    return { ok: true, result: name };
  };
  const result = await runChatToolLoop({
    send: async body => { payloads.push(body); return responses.shift(); },
    payload: { model: 'm', messages: [{ role: 'user', content: 'x' }] },
    tools: [],
    executeTool,
  });
  assert.equal(result.ok, true);
  assert.equal(maxRunning, 2);
  assert.deepEqual(completionOrder, ['fast', 'slow']);
  const toolMessages = payloads[1].messages.filter(message => message.role === 'tool');
  assert.deepEqual(toolMessages.map(message => message.tool_call_id), ['a', 'b']);
  assert.match(toolMessages[0].content, /slow/);
});

test('Paralel turda aynı çağrı iki kez gelirse araç bir kez çalışır', async () => {
  const { ToolRegistry, objectSchema, z } = require('../agent/toolRegistry');
  const { createToolExecutor } = require('../llm/chatToolLoop');
  const registry = new ToolRegistry();
  let runs = 0;
  registry.register({
    name: 'web_search',
    description: 'Arar.',
    inputSchema: z.object({ query: z.string() }).strict(),
    jsonSchema: objectSchema({ query: { type: 'string' } }, ['query']),
    execute: async ({ query }) => {
      runs += 1;
      await new Promise(resolve => setImmediate(resolve));
      return { query };
    },
  });
  const executeTool = createToolExecutor(registry, {});
  const [first, second] = await Promise.all([
    executeTool('web_search', '{"query":"rust"}'),
    executeTool('web_search', '{"query":"rust"}'),
  ]);
  assert.equal(runs, 1);
  assert.deepEqual(first, second);
  assert.equal(first.ok, true);
});
