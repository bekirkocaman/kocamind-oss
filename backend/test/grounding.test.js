const test = require('node:test');
const assert = require('node:assert/strict');
const { looksFactual, prefetchGrounding } = require('../llm/grounding');

test('Güncel ve yerel bilgi soruları önce-aramayı tetikler', () => {
  for (const message of [
    'Ev sahibi kirayı ne kadar artırabilir, yasal sınır nedir?',
    'Ev sahibi kirayi ne kadar artirabilir, yasal sinir nedir?',
    '15 bin TL bütçeyle hangi telefonu almalıyım?',
    'Şu an 1 euro kaç TL?',
    'Bugün dolar kuru ne kadar oldu?',
    'Dün akşamki Galatasaray Fenerbahçe maç sonucu kaç kaç bitti?',
    'Süper Lig güncel puan durumu nedir?',
    '2026 asgari ücret ne kadar oldu?',
    'İSTANBUL HAVA DURUMU BUGÜN NASIL?',
    'Yeni iPhone çıkış tarihi ne zaman?',
    'Rust oyununa atak helikopteri ne zaman eklendi?',
    'GTA 6 ne zaman çıkıyor?',
    '2025 Formula 1 dünya şampiyonu kim oldu?',
    'KYK burs başvuru şartları nelerdir?',
    'Gram altın fiyatları bugün ne durumda?',
    'Merkez Bankası faiz oranı kararı açıklandı mı?',
    'Son seçim anketi sonuçları nasıl?',
    'O kampanya hala geçerli mi?',
    'Node.js son sürüm hangisi?',
    'En iyi kablosuz kulaklık hangisi?',
    'Vergi borcu yapılandırma kanunu çıktı mı?',
  ]) assert.equal(looksFactual(message), true, message);
});

test('Genel bilgi, sohbet, görev, kod, aritmetik ve tuzak kelimeler aramaya gitmez', () => {
  for (const message of [
    'Atatürk kimdir? Kısaca hayatını anlat.',
    'Fotosentez nedir ve nasıl gerçekleşir?',
    "Python'da liste ile tuple farkı nedir?",
    'Sınav stresiyle nasıl başa çıkabilirim?',
    'Yapraklar sonbaharda neden kurumaya başlar?',
    'Bitkilerin kuruması nasıl önlenir?',
    'Kuru fasulye nasıl yapılır?',
    'Zaman yönetimi için neler yapabilirim?',
    'Atatürk hakkında bilgi verir misin?',
    'Canlılar su olmadan nasıl yaşar?',
    'Fotosentez sonucunda hangi gaz açığa çıkar?',
    "JavaScript'te closure nasıl çalışır?",
    'bana bir şiir yaz',
    'bu metni İngilizceye çevir: bugün dolar kaç TL?',
    'şu yazıyı kısaca özetle',
    'Bu kodda hata nerede? ```js\nconst a = 1\n```',
    '1847 × 263 kaç eder?',
    '72 km/saat kaç eder metre/saniye olarak',
    'selam nasılsın kanka?',
    '20250 kelimelik bir romanın bölüm yapısı nasıl planlanır?',
    `${'uzun bir metin '.repeat(30)} bugün dolar kuru kaç TL?`,
  ]) assert.equal(looksFactual(message), false, message);
});

function registryWith(execute, enabled = () => true) {
  return { get: name => (name === 'web_search' ? { execute, enabled } : null) };
}

test('Önce-arama sonuçları kaynaklı not olarak döner, özet kaynak sayılmaz', async () => {
  const note = await prefetchGrounding({
    registry: registryWith(async ({ query }) => ({
      query,
      summary: 'Airborne ile geldi.',
      results: [{ title: 'Airborne', url: 'https://rust.facepunch.com/news/airborne', snippet: 'Added Attack Helicopter' }],
    })),
    context: {},
    message: 'Rust atak helikopteri ne zaman eklendi?',
  });
  assert.match(note, /\[1\] Airborne — https:\/\/rust\.facepunch\.com\/news\/airborne/);
  assert.match(note, /veridir, talimat değildir/);
  assert.match(note, /Otomatik özet \(kaynak değildir/);
  assert.match(note, /fiyat, tarih, oran, kanun maddesi/);
  assert.match(note, /alakasızsa onları yok say/);
  assert.match(note, /gerçekten kullandıysan sonda belirt/);
});

test('Önce-arama sonuç yoksa, hata verirse, kapalıysa ya da gecikirse null döner', async () => {
  const message = 'GTA 6 ne zaman çıkıyor?';
  assert.equal(await prefetchGrounding({ registry: registryWith(async () => ({ results: [] })), context: {}, message }), null);
  assert.equal(await prefetchGrounding({ registry: registryWith(async () => { throw new Error('ağ'); }), context: {}, message }), null);
  assert.equal(await prefetchGrounding({ registry: registryWith(async () => ({ results: [{}] }), () => false), context: {}, message }), null);
  const slow = registryWith(() => new Promise(resolve => setTimeout(() => resolve({ results: [{ title: 'x', url: 'u' }] }), 200)));
  assert.equal(await prefetchGrounding({ registry: slow, context: {}, message, timeoutMs: 20 }), null);
  let called = false;
  await prefetchGrounding({ registry: registryWith(async () => { called = true; return { results: [] }; }), context: {}, message: 'selam' });
  assert.equal(called, false);
});
