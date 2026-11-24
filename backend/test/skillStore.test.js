const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSkillStore, parseFrontmatter } = require('../skills/skillStore');

function tempSkills(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-'));
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

const skill = (name, { description = `${name} açıklaması`, assistants, autoload, body = `${name} talimatları` } = {}) => [
  '---',
  `name: ${name}`,
  `description: ${description}`,
  ...(assistants ? [`assistants: [${assistants.join(', ')}]`] : []),
  ...(autoload !== undefined ? [`autoload: ${autoload}`] : []),
  '---',
  body,
].join('\n');

test('parseFrontmatter alanları, listeleri ve gövdeyi ayırır', () => {
  const parsed = parseFrontmatter('---\r\nname: a\r\ndescription: "Tırnaklı: değer"\r\nassistants: [lawyer, tiger]\r\nautoload: true\r\n---\r\nGövde\r\n');
  assert.deepEqual(parsed.data, { name: 'a', description: 'Tırnaklı: değer', assistants: ['lawyer', 'tiger'], autoload: true });
  assert.equal(parsed.body.trim(), 'Gövde');
});

test('parseFrontmatter başlık yoksa null döner', () => {
  assert.equal(parseFrontmatter('sadece metin'), null);
});

test('geçerli skilleri yükler, bozukları atlar ve uyarır', () => {
  const root = tempSkills({
    'iyi/SKILL.md': skill('iyi'),
    'ad-uyusmaz/SKILL.md': skill('baska-ad'),
    'aciklamasiz/SKILL.md': '---\nname: aciklamasiz\n---\nmetin',
    'BUYUK/SKILL.md': skill('BUYUK'),
    'dosyasiz/notlar.md': 'skill değil',
  });
  const warnings = [];
  const store = createSkillStore({ root, warn: message => warnings.push(message) });
  assert.deepEqual(store.list().map(item => item.name), ['iyi']);
  assert.equal(warnings.length, 3);
});

test('katalog asistan tipine göre süzülür; assistants yoksa herkese açıktır', () => {
  const root = tempSkills({
    'genel/SKILL.md': skill('genel'),
    'hukuk/SKILL.md': skill('hukuk', { assistants: ['lawyer'] }),
  });
  const store = createSkillStore({ root });
  assert.deepEqual(store.list({ assistant: 'lawyer' }).map(item => item.name), ['genel', 'hukuk']);
  assert.deepEqual(store.list({ assistant: 'tiger' }).map(item => item.name), ['genel']);
});

test('autoloadFor yalnızca o asistanın autoload skillerini döndürür', () => {
  const root = tempSkills({
    'hukuk-asistani/SKILL.md': skill('hukuk-asistani', { assistants: ['lawyer'], autoload: true, body: 'Hukuk kuralları' }),
    'dilekce/SKILL.md': skill('dilekce', { assistants: ['lawyer'] }),
  });
  const store = createSkillStore({ root });
  assert.deepEqual(store.autoloadFor('lawyer').map(item => item.body.trim()), ['Hukuk kuralları']);
  assert.deepEqual(store.autoloadFor('tiger'), []);
  // Autoload skill zaten prompt'ta olduğu için katalogda tekrar görünmez.
  assert.deepEqual(store.list({ assistant: 'lawyer', excludeAutoload: true }).map(item => item.name), ['dilekce']);
});

test('get ve readFile skill klasörü dışına çıkamaz', () => {
  const root = tempSkills({
    'hukuk/SKILL.md': skill('hukuk'),
    'hukuk/dilekce-yapisi.md': 'Dilekçe bölümleri',
    'hukuk/gizli.txt': 'md değil',
    'gizli.md': 'kök dosyası',
  });
  const store = createSkillStore({ root });
  assert.equal(store.get('hukuk').name, 'hukuk');
  assert.equal(store.get('../hukuk'), null);
  assert.equal(store.get('yok'), null);
  assert.equal(store.readFile('hukuk', 'dilekce-yapisi.md'), 'Dilekçe bölümleri');
  for (const bad of ['../gizli.md', '..\\gizli.md', '/etc/passwd', 'gizli.txt', 'SKILL.md/../x.md', 'alt/dosya.md', 'yok.md']) {
    assert.throws(() => store.readFile('hukuk', bad), /bulunamadı|geçersiz/i, bad);
  }
  assert.deepEqual(store.get('hukuk').files, ['dilekce-yapisi.md']);
});

test('search aksan duyarsız puanlar ve en iyi eşleşmeyi öne alır', () => {
  const root = tempSkills({
    'cv-yazma/SKILL.md': skill('cv-yazma', { description: 'Özgeçmiş (CV) ve ön yazı hazırlar.' }),
    'dilekce/SKILL.md': skill('dilekce', { description: 'Resmî dilekçe yazar.' }),
  });
  const store = createSkillStore({ root });
  assert.equal(store.search('ozgecmis')[0].name, 'cv-yazma');
  assert.equal(store.search('DİLEKÇE yaz')[0].name, 'dilekce');
  assert.deepEqual(store.search('uzay roketi'), []);
});

test('uzun skill gövdesi sınırda kesilir', () => {
  const root = tempSkills({ 'uzun/SKILL.md': skill('uzun', { body: 'x'.repeat(50) }) });
  const store = createSkillStore({ root, maxChars: 10 });
  assert.ok(store.get('uzun').body.length <= 30);
  assert.match(store.get('uzun').body, /kısaltıldı/);
});

test('repodaki bütün skiller geçerli ve en az bir tane var', () => {
  const warnings = [];
  const root = path.join(__dirname, '..', 'skills');
  const store = createSkillStore({ root, warn: message => warnings.push(message) });
  assert.deepEqual(warnings, []);
  assert.ok(store.list().length >= 5);
  for (const assistant of ['tiger', 'deep_research']) {
    assert.ok(store.autoloadFor(assistant).length >= 1, `${assistant} için autoload skill yok`);
  }
});

test('Türkiye işleri skilleri yüklenir ve aramada bulunur', () => {
  const store = createSkillStore({ root: path.join(__dirname, '..', 'skills') });
  for (const name of ['fatura-okuma', 'soru-cozme']) assert.ok(store.get(name), `${name} yok`);
  assert.equal(store.search('elektrik faturamı açıkla')[0].name, 'fatura-okuma');
  assert.equal(store.search('bu YKS sorusunu çöz')[0].name, 'soru-cozme');
});
