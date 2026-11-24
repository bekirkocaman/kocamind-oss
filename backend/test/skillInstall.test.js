const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Readable } = require('node:stream');
const express = require('express');
const request = require('supertest');
const { createSkillStore } = require('../skills/skillStore');
const { downloadSkill, resolveSkillSource, LIMITS } = require('../skills/skillInstaller');
const userSkills = require('../skills/userSkills');
const { buildSystemPrompt } = require('../skills/prompt');
const { createDefaultToolRegistry } = require('../agent/tools');
const { createToolExecutor } = require('../llm/chatToolLoop');
const { AgentRunner } = require('../agent/runner');
const { MemoryAgentStore } = require('../agent/store');
const { registerSkillRoutes } = require('../routes/skills');
const { fakeFirestore } = require('./fakeFirestore');

const skillStore = createSkillStore({ root: path.join(__dirname, '..', 'skills') });

const SKILL_MD = `---
name: sunum-hazirlama
title: Sunum hazırlama
description: Slayt sunumu için başlık ve akış önerir.
---
Sunum hazırlarken önce hedef kitleyi sor, sonra 10 slaytlık akış öner.
`;

function textResponse(body, { status = 200, type = 'text/plain; charset=utf-8', length } = {}) {
  const headers = { 'content-type': type, ...(length !== undefined ? { 'content-length': String(length) } : {}) };
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => headers[name.toLowerCase()] ?? null },
    text: async () => body,
  };
}

// Adres → yanıt eşlemesi; istenen adresleri kaydeder.
function fakeWeb(routes) {
  const calls = [];
  const fetchPage = async url => {
    calls.push(url);
    const route = routes[url];
    if (!route) return textResponse('yok', { status: 404 });
    return typeof route === 'function' ? route() : route;
  };
  return { fetchPage, calls };
}

const RAW_URL = 'https://raw.githubusercontent.com/ornek/skills/main/sunum-hazirlama/SKILL.md';

function makeRegistry(routes = { [RAW_URL]: () => textResponse(SKILL_MD) }) {
  const web = fakeWeb(routes);
  const registry = createDefaultToolRegistry({ fetchImpl: async () => ({}), env: {}, webSearch: async () => ({ items: [] }), skillStore, fetchSkillPage: web.fetchPage });
  return { registry, web };
}

test('GitHub adresleri indirme planına çevrilir, https dışı ve tanınmayan adresler reddedilir', () => {
  assert.deepEqual(resolveSkillSource('https://github.com/ornek/skills/blob/main/sunum-hazirlama/SKILL.md'), { kind: 'file', url: RAW_URL });
  assert.deepEqual(resolveSkillSource('https://github.com/ornek/skills/tree/main/sunum-hazirlama'), { kind: 'github-dir', owner: 'ornek', repo: 'skills', ref: 'main', path: 'sunum-hazirlama' });
  assert.deepEqual(resolveSkillSource('https://github.com/ornek/tek-skill'), { kind: 'github-dir', owner: 'ornek', repo: 'tek-skill', ref: null, path: '' });
  assert.deepEqual(resolveSkillSource(RAW_URL), { kind: 'file', url: RAW_URL });
  assert.throws(() => resolveSkillSource('http://ornek.com/SKILL.md'), /https/);
  assert.throws(() => resolveSkillSource('https://kullanici:parola@ornek.com/SKILL.md'), /parola/);
  assert.throws(() => resolveSkillSource('https://github.com/ornek/skills/blob/main/kur.sh'), /\.md/);
  assert.throws(() => resolveSkillSource('https://github.com/ornek/skills/issues/1'), /blob|tree/);
});

test('ham SKILL.md indirilir ve frontmatter doğrulanır', async () => {
  const { fetchPage } = fakeWeb({ [RAW_URL]: () => textResponse(SKILL_MD) });
  const skill = await downloadSkill(RAW_URL, { fetchPage });
  assert.equal(skill.name, 'sunum-hazirlama');
  assert.equal(skill.title, 'Sunum hazırlama');
  assert.match(skill.body, /10 slaytlık/);
  assert.deepEqual(skill.assistants, ['*']);
  assert.equal(skill.sourceUrl, RAW_URL);
  assert.match(skill.sha256, /^[0-9a-f]{64}$/);
});

test('HTML sayfa, ikili dosya, frontmatter eksikliği ve geçersiz ad reddedilir', async () => {
  const cases = [
    [textResponse('<html></html>', { type: 'text/html' }), /düz metin değil/],
    [textResponse('---\nname: x\n\0\n---\n', {}), /ikili/],
    [textResponse('# Sadece başlık\nfrontmatter yok'), /frontmatter/],
    [textResponse('---\nname: Kötü Ad\ndescription: x\n---\ngövde'), /geçersiz name/],
    [textResponse('---\nname: bos\ndescription: açıklama\n---\n'), /talimat içermiyor/],
    [textResponse('yok', { status: 404 }), /HTTP 404/],
  ];
  for (const [response, pattern] of cases) {
    await assert.rejects(() => downloadSkill(RAW_URL, { fetchPage: async () => response }), pattern);
  }
});

test('boyut sınırı Content-Length ve akış ortasında uygulanır', async () => {
  const declared = textResponse('kısa', { length: LIMITS.skillBytes + 1 });
  await assert.rejects(() => downloadSkill(RAW_URL, { fetchPage: async () => declared }), /çok büyük/);
  const chunk = Buffer.alloc(64 * 1024, 'a');
  const streaming = { ...textResponse(''), body: Readable.from([chunk, chunk]) };
  await assert.rejects(() => downloadSkill(RAW_URL, { fetchPage: async () => streaming }), /çok büyük/);
});

test('uzun (Anthropic biçimi) açıklama kabul edilir ama katalog için kısaltılır', async () => {
  const long = `---\nname: uzun\ndescription: ${'a'.repeat(600)}\nlicense: MIT\n---\ngövde`;
  const skill = await downloadSkill(RAW_URL, { fetchPage: async () => textResponse(long) });
  assert.equal(skill.description.length, 200);
  assert.ok(skill.description.endsWith('…'));
});

test('GitHub klasöründen yalnızca .md dosyaları alınır; script ve alt klasörler atlanır', async () => {
  const api = 'https://api.github.com/repos/ornek/skills/contents/sunum-hazirlama?ref=main';
  const raw = name => `https://raw.githubusercontent.com/ornek/skills/main/sunum-hazirlama/${name}`;
  const listing = [
    { name: 'SKILL.md', type: 'file', size: 200, download_url: raw('SKILL.md') },
    { name: 'sablon.md', type: 'file', size: 30, download_url: raw('sablon.md') },
    { name: 'kur.py', type: 'file', size: 30, download_url: raw('kur.py') },
    { name: 'scripts', type: 'dir', size: 0, download_url: null },
  ];
  const { fetchPage, calls } = fakeWeb({
    [api]: () => textResponse(JSON.stringify(listing), { type: 'application/json' }),
    [raw('SKILL.md')]: () => textResponse(SKILL_MD),
    [raw('sablon.md')]: () => textResponse('# Şablon'),
  });
  const skill = await downloadSkill('https://github.com/ornek/skills/tree/main/sunum-hazirlama', { fetchPage });
  assert.deepEqual(skill.files, [{ name: 'sablon.md', content: '# Şablon' }]);
  assert.deepEqual(skill.skippedFiles, ['kur.py', 'scripts/']);
  assert.ok(!calls.some(url => url.endsWith('kur.py')), 'script indirilmemeli');
});

test('GitHub listesindeki beklenmedik indirme adresi reddedilir', async () => {
  const api = 'https://api.github.com/repos/ornek/skills/contents?ref=main';
  const listing = [{ name: 'SKILL.md', type: 'file', size: 10, download_url: 'https://kotu.example/SKILL.md' }];
  const { fetchPage } = fakeWeb({ [api]: () => textResponse(JSON.stringify(listing), { type: 'application/json' }) });
  await assert.rejects(() => downloadSkill('https://github.com/ornek/skills/tree/main', { fetchPage }), /beklenmedik/);
});

test('agent yolunda install_skill onay bekler, onaydan sonra kullanıcının hesabına kurar', async () => {
  const { registry } = makeRegistry();
  const firestoreDb = fakeFirestore();
  const context = { userId: 'u1', firestoreDb, enableWebSearch: false };
  const tool = registry.get('install_skill');
  assert.equal(tool.requiresConfirmation, true);
  assert.ok(registry.list(context).some(item => item.name === 'install_skill'));
  assert.ok(!registry.list({}).some(item => item.name === 'install_skill'), 'oturum yoksa araç kapalı');

  const runner = new AgentRunner({ registry, store: new MemoryAgentStore(), apiKey: 'test' });
  let index = 0;
  const responses = [
    { id: 'r1', output: [{ type: 'function_call', call_id: 'c1', name: 'install_skill', arguments: JSON.stringify({ url: RAW_URL }) }] },
    { id: 'r2', output_text: 'Skill kuruldu.', output: [] },
  ];
  runner.callOpenAI = async () => responses[index++];
  const events = [];
  const paused = await runner.start({ userId: 'u1', message: 'şu skill\'i kur', instructions: 'test', context, onEvent: event => events.push(event) });
  assert.equal(paused.status, 'waiting_confirmation');
  assert.deepEqual(await userSkills.listUserSkills(firestoreDb, 'u1'), [], 'onaydan önce kurulmamalı');
  const approval = events.find(event => event.type === 'approval_required');
  assert.match(approval.actions[0].summary, /kod çalıştırılmaz/);

  const done = await runner.resume({ runId: paused.runId, confirmationId: approval.confirmationId, approved: true, userId: 'u1', context, onEvent: event => events.push(event) });
  assert.equal(done.status, 'completed');
  const [installed] = await userSkills.listUserSkills(firestoreDb, 'u1');
  assert.equal(installed.name, 'sunum-hazirlama');
  assert.equal(installed.sourceUrl, RAW_URL);
  assert.deepEqual(await userSkills.listUserSkills(firestoreDb, 'u2'), [], 'başka kullanıcıya görünmemeli');
});

test('sohbet yolunda install_skill önizler; aynı istekte onaylanamaz, yeni mesajla kurulur', async () => {
  const { registry } = makeRegistry();
  const firestoreDb = fakeFirestore();
  const first = { userId: 'u1', firestoreDb, requestId: 'istek-1' };

  const chatTool = registry.toChatCompletionsTools(first).find(item => item.function.name === 'install_skill');
  assert.ok(chatTool, 'sohbette sohbet varyantı verilmeli');
  assert.ok(chatTool.function.parameters.properties.skill_name);
  assert.ok(!registry.toChatCompletionsTools(first).some(item => item.function.name === 'send_email'), 'varyantı olmayan onaylı araç yine gizli');

  const run = createToolExecutor(registry, first);
  const preview = await run('install_skill', JSON.stringify({ url: RAW_URL, skill_name: null }));
  assert.equal(preview.ok, true);
  assert.equal(preview.result.status, 'awaiting_user_confirmation');
  assert.equal(preview.result.preview.name, 'sunum-hazirlama');
  assert.deepEqual(await userSkills.listUserSkills(firestoreDb, 'u1'), [], 'önizleme kurmaz');

  const selfConfirm = await run('install_skill', JSON.stringify({ url: null, skill_name: preview.result.skill_name }));
  assert.equal(selfConfirm.ok, false);
  assert.match(selfConfirm.error, /yeni bir mesajla/);

  // Kendi kendine onay denemesi kodu yakmaz; kullanıcı sonraki mesajda onaylayınca kurulur.
  const second = { userId: 'u1', firestoreDb, requestId: 'istek-2' };
  const ok = await createToolExecutor(registry, second)('install_skill', JSON.stringify({ url: null, skill_name: preview.result.skill_name }));
  assert.equal(ok.ok, true);
  assert.equal(ok.result.installed, true);
  const reused = await createToolExecutor(registry, { ...first, requestId: 'istek-3' })('install_skill', JSON.stringify({ url: null, skill_name: preview.result.skill_name }));
  assert.equal(reused.ok, false, 'bekleyen kurulum bir kez kullanılır');

  // Kurulan skill load_skill ve find_skills ile kullanılabilir, prompt kataloğunda görünür.
  const later = { userId: 'u1', firestoreDb, requestId: 'istek-5' };
  const loaded = await createToolExecutor(registry, later)('load_skill', JSON.stringify({ name: 'sunum-hazirlama', file: null }));
  assert.equal(loaded.ok, true);
  assert.match(loaded.result.instructions, /10 slaytlık/);
  assert.equal(loaded.result.source, 'user');
  assert.match(loaded.result.note, /aşamaz/);
  const found = await createToolExecutor(registry, later)('find_skills', JSON.stringify({ query: 'slayt sunumu' }));
  assert.equal(found.result.skills[0].name, 'sunum-hazirlama');
  const prompt = buildSystemPrompt({ assistantType: 'tiger', skillStore, toolsEnabled: true, legacyPrompts: {}, extraSkills: await userSkills.listUserSkills(firestoreDb, 'u1') });
  assert.match(prompt, /- sunum-hazirlama: Slayt sunumu/);

  const otherUser = await createToolExecutor(registry, { userId: 'u2', firestoreDb, requestId: 'x' })('load_skill', JSON.stringify({ name: 'sunum-hazirlama', file: null }));
  assert.equal(otherUser.ok, false);
});

test('süresi dolmuş onay kodu kabul edilmez', async () => {
  const firestoreDb = fakeFirestore();
  const downloaded = await downloadSkill(RAW_URL, { fetchPage: async () => textResponse(SKILL_MD) });
  const id = await userSkills.createPendingInstall(firestoreDb, 'u1', downloaded, { requestId: 'a', now: () => new Date('2026-10-15T10:00:00Z') });
  await assert.rejects(
    () => userSkills.consumePendingInstall(firestoreDb, 'u1', id, { requestId: 'b', now: () => new Date('2026-10-15T11:00:00Z') }),
    /süresi doldu/,
  );
});

test('yerleşik skill ve kurulu skill üzerine yazılmaz', async () => {
  const firestoreDb = fakeFirestore();
  const builtIn = SKILL_MD.replace('name: sunum-hazirlama', 'name: dilekce');
  const { registry } = makeRegistry({ [RAW_URL]: () => textResponse(builtIn) });
  const run = createToolExecutor(registry, { userId: 'u1', firestoreDb, requestId: 'r1' });
  const clash = await run('install_skill', JSON.stringify({ url: RAW_URL, skill_name: null }));
  assert.equal(clash.ok, false);
  assert.match(clash.error, /yerleşik/);

  const downloaded = await downloadSkill(RAW_URL, { fetchPage: async () => textResponse(SKILL_MD) });
  await userSkills.installUserSkill(firestoreDb, 'u1', downloaded, { builtInNames: new Set() });
  const changed = { ...downloaded, body: 'DEĞİŞTİRİLMİŞ' };
  await assert.rejects(() => userSkills.installUserSkill(firestoreDb, 'u1', changed, { builtInNames: new Set() }), /zaten kurulu/);
  assert.match((await userSkills.getUserSkill(firestoreDb, 'u1', 'sunum-hazirlama')).body, /10 slaytlık/);
});

test('/skills kurulan skill\'i gösterir; DELETE yalnızca kullanıcının skill\'ini kaldırır', async () => {
  const firestoreDb = fakeFirestore();
  const downloaded = await downloadSkill(RAW_URL, { fetchPage: async () => textResponse(SKILL_MD) });
  await userSkills.installUserSkill(firestoreDb, 'u1', downloaded, { builtInNames: new Set() });
  const server = express();
  server.use((req, res, next) => { req.user = { uid: 'u1' }; next(); });
  registerSkillRoutes(server, { skillStore, firestoreDb });

  const listed = await request(server).get('/skills');
  const mine = listed.body.skills.find(skill => skill.name === 'sunum-hazirlama');
  assert.equal(mine.installed, true);
  assert.equal(mine.sourceUrl, RAW_URL);
  assert.doesNotMatch(JSON.stringify(listed.body), /10 slaytlık/, 'talimat gövdesi istemciye gitmez');
  assert.equal(listed.headers['cache-control'], 'private, no-cache');

  assert.equal((await request(server).delete('/skills/dilekce')).status, 403);
  assert.equal((await request(server).delete('/skills/Kotu..ad')).status, 400);
  assert.equal((await request(server).delete('/skills/sunum-hazirlama')).status, 200);
  assert.equal((await request(server).delete('/skills/sunum-hazirlama')).status, 404);
  assert.deepEqual(await userSkills.listUserSkills(firestoreDb, 'u1'), []);
});

test('sohbet rotası: model ilk mesajda önizler, kullanıcının sonraki mesajında kurar, katalogda görünür', async () => {
  const { registerChatRoutes } = require('../routes/chat');
  process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'test-key';
  const { registry } = makeRegistry();
  const firestoreDb = fakeFirestore();
  const payloads = [];
  // Sahte sağlayıcı: sıradaki yanıtı verir; araç sonucu gelince metinle bitirir.
  let script = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    payloads.push(body);
    const next = script.shift();
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: next(body) }] }) };
  };
  const callTool = args => () => ({ role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'install_skill', arguments: JSON.stringify(args) } }] });
  const lastToolOutput = body => JSON.parse(body.messages[body.messages.length - 1].content);
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { uid: 'u1' }; next(); });
  registerChatRoutes(app, {
    enforceDailyQuota: () => (req, res, next) => next(),
    hasActivePlus: async () => false,
    DEFAULT_MODEL: { id: 'deepseek-chat', provider: 'deepseek' },
    PROVIDERS: { deepseek: { name: 'DeepSeek', envKey: 'DEEPSEEK_API_KEY', baseUrl: 'https://deepseek.test/v1/chat/completions' } },
    MODEL_CATALOG: [{ id: 'deepseek-chat', provider: 'deepseek' }],
    ACTIVE_PROVIDERS: new Set(['deepseek']),
    ASSISTANT_PROMPTS: { tiger: 'x' },
    fetch,
    toolRegistry: registry,
    skillStore,
    firestoreDb,
  });

  let previewOutput;
  script = [
    callTool({ url: RAW_URL, skill_name: null }),
    body => { previewOutput = lastToolOutput(body); return { role: 'assistant', content: 'Önizleme hazır, kurayım mı?' }; },
  ];
  await request(app).post('/chat').send({ message: `${RAW_URL} skill'ini kur`, stream: false });
  assert.ok(payloads[0].tools.some(tool => tool.function.name === 'install_skill'));
  assert.equal(previewOutput.result.status, 'awaiting_user_confirmation');
  assert.deepEqual(await userSkills.listUserSkills(firestoreDb, 'u1'), []);

  let installOutput;
  script = [
    callTool({ url: null, skill_name: 'sunum-hazirlama' }),
    body => { installOutput = lastToolOutput(body); return { role: 'assistant', content: 'Kuruldu.' }; },
  ];
  await request(app).post('/chat').send({ message: 'evet kur', stream: false });
  assert.equal(installOutput.ok, true, JSON.stringify(installOutput));
  assert.equal(installOutput.result.installed, true);

  script = [() => ({ role: 'assistant', content: 'Tamam' })];
  await request(app).post('/chat').send({ message: 'sunum hazırla', stream: false });
  assert.match(payloads[payloads.length - 1].messages[0].content, /- sunum-hazirlama: /);
});
