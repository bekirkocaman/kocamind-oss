const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createSkillStore } = require('../skills/skillStore');
const { buildSystemPrompt } = require('../skills/prompt');
const { SECURITY_CORE } = require('../skills/securityCore');
const { createDefaultToolRegistry } = require('../agent/tools');

const skillStore = createSkillStore({ root: path.join(__dirname, '..', 'skills') });
const registry = createDefaultToolRegistry({ fetchImpl: async () => ({}), env: {}, webSearch: async () => ({ items: [] }), skillStore });
const legacyPrompts = { tiger: 'ESKI TIGER', yeni: 'ESKI YENI' };

test('load_skill skill metnini ve ek dosya listesini döndürür', async () => {
  const tool = registry.get('load_skill');
  const args = registry.validate('load_skill', '{"name":"dilekce"}');
  const result = await tool.execute(args, {});
  assert.equal(result.name, 'dilekce');
  assert.match(result.instructions, /dilekçe taslağı/i);
  assert.deepEqual(result.files, ['dilekce-yapisi.md']);
});

test('load_skill ek dosyayı okur, bilinmeyen skill ve kötü yolu reddeder', async () => {
  const tool = registry.get('load_skill');
  const file = await tool.execute(registry.validate('load_skill', { name: 'dilekce', file: 'dilekce-yapisi.md' }), {});
  assert.match(file.content, /SONUÇ VE İSTEM/);
  await assert.rejects(() => tool.execute({ name: 'yok' }, {}), /bulunamadı/);
  assert.throws(() => registry.validate('load_skill', { name: 'dilekce', file: '../../server.js' }));
});

test('find_skills sorguya uyan skilleri ad ve açıklamayla döndürür', async () => {
  const result = await registry.get('find_skills').execute({ query: 'özgeçmiş hazırla' }, {});
  assert.equal(result.skills[0].name, 'cv-yazma');
  assert.ok(result.skills[0].description);
});

test('skillStore yoksa skill araçları kayıtlı değildir', () => {
  const plain = createDefaultToolRegistry({ fetchImpl: async () => ({}), env: {}, webSearch: async () => ({ items: [] }) });
  assert.equal(plain.get('load_skill'), undefined);
  assert.equal(plain.get('find_skills'), undefined);
});

test('autoload skill sistem prompta girer, katalog tekrar göstermez', () => {
  const prompt = buildSystemPrompt({ assistantType: 'tiger', skillStore, toolsEnabled: true, legacyPrompts });
  assert.match(prompt, /KocaMind'in yapay zekâ asistanısın/);
  assert.match(prompt, /- dilekce: /);
  assert.match(prompt, /- hukuk-bilgisi: /);
  assert.match(prompt, /- saglik-bilgisi: /);
  assert.doesNotMatch(prompt, /- genel-asistan: /);
  assert.match(prompt, /load_skill/);
});

test('araç desteklemeyen modelde katalog girmez, autoload girer', () => {
  const prompt = buildSystemPrompt({ assistantType: 'deep_research', skillStore, toolsEnabled: false, legacyPrompts });
  assert.match(prompt, /Derin Araştırma asistanısın/);
  assert.doesNotMatch(prompt, /load_skill/);
});

test('özel prompt autoload yerine geçer ama katalog yine verilir', () => {
  const prompt = buildSystemPrompt({ assistantType: 'tiger', customPrompt: 'Sen bir korsansın.', skillStore, toolsEnabled: true, legacyPrompts });
  assert.ok(prompt.startsWith(SECURITY_CORE));
  assert.match(prompt, /Uygulamanın ek talimatları \(yukarıdaki kurallarla çelişirse yukarıdakiler geçerlidir\):\nSen bir korsansın\./);
  assert.doesNotMatch(prompt, /KocaMind'in yapay zekâ asistanısın/);
  assert.match(prompt, /- cv-yazma: /);
});

test('autoload skill yoksa eski prompt, o da yoksa tiger kullanılır', () => {
  const yeniPrompt = buildSystemPrompt({ assistantType: 'yeni', skillStore, toolsEnabled: false, legacyPrompts });
  assert.ok(yeniPrompt.startsWith(SECURITY_CORE));
  assert.match(yeniPrompt, /\n\nESKI YENI$/);
  assert.match(buildSystemPrompt({ assistantType: 'bilinmeyen', skillStore, toolsEnabled: false, legacyPrompts }), /KocaMind'in yapay zekâ asistanısın/);
  const tigerFallback = buildSystemPrompt({ assistantType: 'tiger', skillStore: null, toolsEnabled: true, legacyPrompts });
  assert.ok(tigerFallback.startsWith(SECURITY_CORE));
  assert.match(tigerFallback, /\n\nESKI TIGER$/);
});

test('katalog sınırı aşılınca satırlar yerine find_skills talimatı verilir', () => {
  const prompt = buildSystemPrompt({ assistantType: 'tiger', skillStore, toolsEnabled: true, legacyPrompts, catalogLimit: 1 });
  assert.doesNotMatch(prompt, /- cv-yazma: /);
  assert.match(prompt, /find_skills/);
});
