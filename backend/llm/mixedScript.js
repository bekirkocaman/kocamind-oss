// DeepSeek ara sıra bir kelimenin ortasında Latin yerine Kiril harf üretir
// ("fotoелектрик"). Yalnızca iki alfabeyi aynı kelimede karıştıran kelimeler
// düzeltilir; tamamen Kiril kelimeler (Makedonca, Rusça cevaplar) olduğu gibi kalır.

const CYRILLIC_TO_LATIN = {
  а: 'a', б: 'b', в: 'v', г: 'g', ґ: 'g', д: 'd', ђ: 'đ', е: 'e', ё: 'yo', є: 'ye', ж: 'j', з: 'z', ѕ: 'dz',
  и: 'i', і: 'i', ї: 'yi', й: 'y', ј: 'j', к: 'k', ќ: 'k', л: 'l', љ: 'lj', м: 'm', н: 'n', њ: 'nj', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', ћ: 'ć', у: 'u', ў: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ç', џ: 'dž', ш: 'ş',
  щ: 'şç', ъ: '', ы: 'ı', ь: '', э: 'e', ю: 'yu', я: 'ya',
};
const WORD_RE = /[\p{L}\p{M}]+/gu;
const CYRILLIC_RE = /\p{Script=Cyrillic}/u;
const LATIN_RE = /\p{Script=Latin}/u;

function transliterate(char) {
  const lower = char.toLowerCase();
  const latin = CYRILLIC_TO_LATIN[lower];
  if (latin === undefined) return char;
  return char === lower ? latin : latin.charAt(0).toUpperCase() + latin.slice(1);
}

function fixMixedScriptWords(text) {
  if (typeof text !== 'string' || !CYRILLIC_RE.test(text)) return text;
  return text.replace(WORD_RE, word => (CYRILLIC_RE.test(word) && LATIN_RE.test(word)
    ? [...word].map(char => (CYRILLIC_RE.test(char) ? transliterate(char) : char)).join('')
    : word));
}

// Akışta kelime parçalara bölünebilir; son yarım kelime bir sonraki parçaya kadar bekletilir.
function createMixedScriptStreamFixer(emit) {
  let pending = '';
  return {
    push(text) {
      pending += text;
      const match = /[\p{L}\p{M}]+$/u.exec(pending);
      const cut = match ? match.index : pending.length;
      if (cut > 0) emit(fixMixedScriptWords(pending.slice(0, cut)));
      pending = pending.slice(cut);
    },
    flush() {
      if (pending) emit(fixMixedScriptWords(pending));
      pending = '';
    },
  };
}

module.exports = { fixMixedScriptWords, createMixedScriptStreamFixer };
