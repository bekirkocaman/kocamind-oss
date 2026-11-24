// Mesajı kaba bir konu kategorisine ayırır. Yönlendirici ve gece raporu
// skorları kategori başına tutar: "kod sorusunda hangi model iyi" ile
// "kısa sohbette hangi model iyi" aynı şey değil.
// Bilerek basit ve deterministik: model çağrısı yok, maliyet yok, test edilebilir.

const CATEGORIES = ['kod', 'matematik', 'yazi', 'arastirma', 'sohbet'];

// \b Türkçe harflerde (ç, ş, ı...) çalışmadığı için kelime sınırı elle yazılır.
// stems: kelime başı eşleşir, ek alabilir ("denklem" → "denklemin").
// words: tam kelime ("yaz" eşleşir, "yazılım" eşleşmez).
const W = '(?:^|[^\\p{L}\\p{N}])';
const E = '(?=$|[^\\p{L}\\p{N}])';
const stems = list => new RegExp(`${W}(?:${list.join('|')})`, 'iu');
const words = list => new RegExp(`${W}(?:${list.join('|')})${E}`, 'iu');

const RULES = [
  ['kod', [/```|=>|\{\s*\n/,
    stems(['function', 'import', 'return', 'async', 'await', 'regex', 'stack trace', 'exception', 'compile', 'derle', 'debug', 'kotlin', 'python', 'javascript', 'typescript', 'react', 'kodu', 'kodun', 'fonksiyon', 'değişken']),
    words(['const', 'let', 'class', 'def', 'npm', 'pip', 'git', 'sql', 'json', 'api', 'java', 'html', 'css', 'kod', 'bug'])]],
  ['matematik', [/\d+\s*[-+*/^×÷]\s*\d+/,
    stems(['integral', 'türev', 'denklem', 'matris', 'determinant', 'olasılı', 'istatisti', 'hesapla', 'karekök', 'logaritma', 'ispat']),
    words(['limit', 'kaç eder'])]],
  ['yazi', [
    stems(['yazar mısın', 'metin', 'makale', 'e-posta', 'eposta', 'dilekçe', 'özgeçmiş', 'şiir', 'hikaye', 'paragraf', 'çevir', 'tercüme', 'düzelt', 'özetle', 'slogan']),
    words(['yaz', 'mail', 'cv', 'başlık'])]],
  ['arastirma', [
    stems(['nasıl çalışır', 'karşılaştır', 'farkı ne', 'araştır', 'kaynak', 'tarihçe', 'avantaj', 'dezavantaj', 'hangisi daha', 'güncel', 'son dakika', 'fiyatı']),
    words(['neden', 'kuru'])]],
];

function classifyMessage(text) {
  const value = String(text || '').slice(0, 4000);
  if (!value.trim()) return 'sohbet';
  for (const [category, patterns] of RULES) {
    if (patterns.some(pattern => pattern.test(value))) return category;
  }
  return 'sohbet';
}

module.exports = { CATEGORIES, classifyMessage };
