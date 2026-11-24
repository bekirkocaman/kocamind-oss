// Onay kelimesi (ör. "SİL") büyük/küçük harf ve boşluktan bağımsız eşleşir; Türkçe İ/i korunur.
export function confirmWordMatches(typed, word) {
  return typed.trim().toLocaleUpperCase('tr') === word
}
