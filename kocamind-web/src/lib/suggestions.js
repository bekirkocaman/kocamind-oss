// Boş sohbet ekranındaki Türkiye işleri kartları (Android Suggestions.kt ile aynı liste).
// Kart mesaj kutusunu doldurur, göndermez; needsImage olanlar fotoğraf seçiciyi de açar.
export const SUGGESTIONS = [
  { id: 'dilekce', label: 'Dilekçe yaz', prompt: 'Bir dilekçe yazmama yardım et. Konu: ', needsImage: false },
  { id: 'resmi-eposta', label: 'Resmi e-posta yaz', prompt: 'Resmi bir e-posta yazmama yardım et. Kime ve ne hakkında: ', needsImage: false },
  { id: 'fatura', label: 'Faturamı açıkla', prompt: 'Bu faturayı sade Türkçe açıkla: kalemler, toplam tutar ve son ödeme tarihi.', needsImage: true },
  { id: 'soru', label: 'Fotoğraftan soru çöz', prompt: 'Bu soruyu adım adım çöz, cevabı en sonda ver.', needsImage: true },
]
