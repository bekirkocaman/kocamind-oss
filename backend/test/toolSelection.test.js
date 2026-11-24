const test = require('node:test');
const assert = require('node:assert/strict');
const { ToolRegistry, prepareExtraTools, z } = require('../agent/toolRegistry');
const { createToolSelection } = require('../llm/toolSelection');

const def = (name, description) => ({
  name,
  description,
  inputSchema: z.record(z.string(), z.unknown()),
  jsonSchema: { type: 'object', properties: {} },
  execute: async () => ({ ok: name }),
});

function setup(extraCount) {
  const registry = new ToolRegistry().register(def('web_search', 'İnternette arama')).register(def('calculate', 'Hesap yapar'));
  const extras = Array.from({ length: extraCount }, (_, i) => def(`notion__tool_${i}`, `[Notion] araç ${i}`));
  extras.push(def('google_calendar__list_events', '[Google Takvim] Etkinlikleri listeler'));
  const context = { extraTools: prepareExtraTools(extras) };
  return { registry, context };
}

const names = tools => tools.map(tool => tool.function.name);

test('araç sayısı sınırın altındaysa hepsi verilir, find_tools eklenmez', () => {
  const { registry, context } = setup(2);
  const selection = createToolSelection({ registry, context, maxTools: 10 });
  assert.deepEqual(names(selection.tools()), ['web_search', 'calculate', 'notion__tool_0', 'notion__tool_1', 'google_calendar__list_events']);
});

test('sınır aşılınca ortak araçlar + find_tools verilir; find_tools eşleşeni etkinleştirir', async () => {
  const { registry, context } = setup(30);
  const selection = createToolSelection({ registry, context, maxTools: 10 });
  assert.deepEqual(names(selection.tools()), ['web_search', 'calculate', 'find_tools']);
  const findTools = registry.get('find_tools', context);
  const result = await findTools.execute({ query: 'takvim etkinlik' }, context);
  assert.equal(result.tools[0].name, 'google_calendar__list_events');
  assert.ok(names(selection.tools()).includes('google_calendar__list_events'));
  assert.equal(registry.get('google_calendar__list_events', context).name, 'google_calendar__list_events');
});

test('find_tools eşleşme yoksa boş liste döndürür', async () => {
  const { registry, context } = setup(30);
  createToolSelection({ registry, context, maxTools: 10 });
  const result = await registry.get('find_tools', context).execute({ query: 'uzay roketi' }, context);
  assert.deepEqual(result.tools, []);
});

test('Groq araç seçimi niyeti, özel skill adını ve kurulum onayının bağlamını eşleştirir', () => {
  const { registry, context } = setup(2);
  for (const name of ['get_weather', 'convert_currency', 'search_wikipedia', 'scrape_website', 'save_memory', 'load_skill', 'find_skills', 'install_skill']) {
    registry.register(def(name, name));
  }
  const toolsFor = (message, extra = {}) => names(createToolSelection({ registry, context, groq: { message, ...extra } }).groqTools());
  const base = ['web_search', 'calculate'];
  assert.deepEqual(toolsFor('Try explaining how to set up a server. Kuru fasulye nedir?'), base);
  assert.deepEqual(toolsFor('Havacılık ve cvv ne demek?'), base);
  assert.deepEqual(toolsFor('Takvimler tarih boyunca nasıl gelişti?'), base);
  assert.deepEqual(toolsFor('VİKİPEDİ’den Atatürk hakkında bilgi getir.'), [...base, 'search_wikipedia']);
  assert.deepEqual(toolsFor('Bu bağlantıyı özetle. https://example.com'), [...base, 'scrape_website']);
  assert.deepEqual(toolsFor('En sevdiğim renk mavi. Bunu hafızana kaydet.'), [...base, 'save_memory']);
  const skills = [{ name: 'butce-izleme', title: 'Bütçe izleme' }];
  assert.deepEqual(toolsFor('BÜTÇE İZLEME ile hazırla.', { skills }), [...base, 'load_skill', 'find_skills']);
  assert.deepEqual(toolsFor('Bütçe izlemeli miyim?', { skills }), base);
  assert.deepEqual(toolsFor('Merhaba', { customPrompt: 'Yanıtlamadan önce load_skill kullan.' }), [...base, 'load_skill', 'find_skills']);
  assert.deepEqual(toolsFor('Evet, kur.'), base);
  assert.deepEqual(toolsFor('Evet, kur.', { previousAssistantMessage: 'Skill önizlemesi hazır. Kurulumu onaylıyor musun?' }), [...base, 'install_skill']);
});

test('Groq bağlı hesap niyetinde find_tools ile araç ekler, diğer sağlayıcıların küçük listesine dokunmaz', async () => {
  const { registry, context } = setup(2);
  const selection = createToolSelection({ registry, context, groq: { message: 'Google Takvim’deki etkinlikleri listele.' } });
  const full = ['web_search', 'calculate', 'notion__tool_0', 'notion__tool_1', 'google_calendar__list_events'];
  assert.deepEqual(names(selection.tools()), full);
  assert.deepEqual(names(selection.groqTools()), ['web_search', 'calculate', 'find_tools']);
  await registry.get('find_tools', context).execute({ query: 'takvim etkinlik' });
  assert.deepEqual(names(selection.groqTools()), ['web_search', 'calculate', 'google_calendar__list_events', 'find_tools']);
  assert.deepEqual(names(selection.tools()), full);
});
