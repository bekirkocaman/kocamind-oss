const test = require('node:test');
const assert = require('node:assert/strict');
const { fixMixedScriptWords, createMixedScriptStreamFixer } = require('../llm/mixedScript');
const { createDefaultToolRegistry } = require('../agent/tools');
const { liveDataRules } = require('../routes/chat');

test('Latin kelimenin içine karışan Kiril harfler Latin harfe çevrilir', () => {
  assert.equal(fixMixedScriptWords('fotoелектрик etki üzerine'), 'fotoelektrik etki üzerine');
  assert.equal(fixMixedScriptWords('Ödülü Fotoелектрик'), 'Ödülü Fotoelektrik');
});

test('Tamamen Kiril kelimeler ve Türkçe karakterler olduğu gibi kalır', () => {
  const macedonian = 'Добар ден, како си? Скопје е главен град.';
  assert.equal(fixMixedScriptWords(macedonian), macedonian);
  assert.equal(fixMixedScriptWords('Çağrı, şöyle ığdır'), 'Çağrı, şöyle ığdır');
  assert.equal(fixMixedScriptWords('Bugün Скопје çok güzel'), 'Bugün Скопје çok güzel');
});

test('Akışta parçalara bölünen karışık kelime yine düzeltilir', () => {
  const out = [];
  const fixer = createMixedScriptStreamFixer(text => out.push(text));
  for (const piece of ['Einstein foto', 'елек', 'трик etki', 'si için.']) fixer.push(piece);
  fixer.flush();
  assert.equal(out.join(''), 'Einstein fotoelektrik etkisi için.');
});

test('search_wikipedia tam başlık bulunamazsa aramayla makaleyi bulur', async () => {
  const urls = [];
  const fetchImpl = async url => {
    urls.push(url);
    if (url.includes('/page/summary/Linus%20Torvalds%20Linux%20duyurusu')) return { ok: false, status: 404 };
    if (url.includes('list=search')) return { ok: true, status: 200, json: async () => ({ query: { search: [{ title: 'Linux' }] } }) };
    if (url.includes('/page/summary/Linux')) {
      return { ok: true, status: 200, json: async () => ({ title: 'Linux', extract: 'Linux bir çekirdektir.', content_urls: { desktop: { page: 'https://tr.wikipedia.org/wiki/Linux' } } }) };
    }
    throw new Error(`beklenmeyen istek ${url}`);
  };
  const tool = createDefaultToolRegistry({ fetchImpl }).get('search_wikipedia', {});
  const result = await tool.execute({ query: 'Linus Torvalds Linux duyurusu', lang: 'tr' });
  assert.equal(result.title, 'Linux');
  assert.equal(result.url, 'https://tr.wikipedia.org/wiki/Linux');
  assert.equal(urls.length, 3);
});

test('search_wikipedia aramada da sonuç yoksa anlaşılır hata verir', async () => {
  const fetchImpl = async url => (url.includes('list=search')
    ? { ok: true, status: 200, json: async () => ({ query: { search: [] } }) }
    : { ok: false, status: 404 });
  const tool = createDefaultToolRegistry({ fetchImpl }).get('search_wikipedia', {});
  await assert.rejects(tool.execute({ query: 'yokboyle', lang: 'tr' }), /eşleşen makale bulunamadı/);
});

test('Kur aracı kaynağını döndürür; ortak kural kaynak ve süsleme ayrıntısını kapsar', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ rates: { TRY: 56 }, date: '2026-11-03' }) });
  const tool = createDefaultToolRegistry({ fetchImpl }).get('convert_currency', {});
  const result = await tool.execute({ amount: 1, from: 'EUR', to: 'TRY' });
  assert.match(result.source, /exchangerate-api\.com/);
  const rules = liveDataRules(new Date('2026-11-03T12:00:00Z'));
  assert.match(rules, /araç sonucunda kaynak/);
  assert.match(rules, /emin olmadığın ayrıntıyı hiç yazma/);
});
