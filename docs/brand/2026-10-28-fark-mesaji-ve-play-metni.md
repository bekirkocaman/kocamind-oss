# KocaMind: fark mesajı ve Play Store metni (taslak)

28 Ekim 2026. Dayandığı rakip analizi BekooOS'ta: `🏰 300-Projects/KocaMind/` altındaki Rakip Analizi, Küçük Rakipler, Codeway ve Genie İncelemesi, Yerli Rakipler, Cortex İncelemesi.

> **Henüz karar verilmeyenler:** fiyat, ücretsiz planın içeriği ve deneme süresi. Metinde bunlar `[KARAR]` diye işaretlendi. Karar verilmeden yayınlanmamalı.

---

## 1. Fark mesajı (iç kullanım)

### Pazarda gördüğümüz
- Türkiye'deki "Türkçe yapay zeka" uygulamalarının çoğu (Codeway, Genie, Codespace, EXP AI) aynı modelleri paketleyip satıyor ve yorumlarda hep aynı şikâyet var: *"ücretsiz deneme deyip para kestiler"*, *"iptal edemiyorum"*, *"destek yok"*.
- "Her şey tek yerde" artık tek başına fark değil. Genie'de daha fazla model var, Cortex'te de internetsiz model ve otomatik model seçimi var.
- Pazardaki asıl boşluk güven.

### Tek cümle
**KocaMind: Türkçe düşünen, işini bitiren ve seni kandırmayan yapay zeka.**

### Üç dayanak
| Dayanak | Ne demek | Kanıtı (ürün içinde) |
|---|---|---|
| **Dürüst** | Ne ödediğini bilirsin. Haftalık abonelik yok, ödeme ekranında oyun yok, yıldız dayatması yok, iptali tek dokunuş. | Ödeme ekranı tasarımı, fiyat sayfası `[KARAR]` |
| **İş bitirir** | Sadece sohbet etmez; araştırır, belge okur, onayınla işlem yapar. | Agent (onaylı işlemler), Derin Araştırma, belge ve fotoğraf ekleme |
| **Türkçe önce** | Metinler çeviri gibi durmaz, Türkçe karakterler kusursuz, internet yokken de çalışır. | Türkçe arayüz, çevrimdışı GGUF modeller |

### Kime karşı nasıl konuşuruz
- **Türk stüdyo uygulamaları:** Dürüstlük. Rakibin adını hiçbir zaman anmayız; sadece kendi sözümüzü söyleriz ("haftalık abonelik yok").
- **Cortex:** İş bitirme (Agent ve derin araştırma) ve cila (hafif native uygulama, fotoğrafın sorunsuz çalışması).
- **Büyük şirketler:** Fiyat ve Türkçe `[KARAR: fiyat netleşince]`.

### Kaçınılacaklar
- "En iyi", "en akıllı", "1 numara" gibi kanıtlayamayacağımız üstünlük iddiaları.
- Model ve marka adlarıyla anahtar kelime doldurmak (Play politikası riski; rakipler bunu yapıyor).
- "Verini asla toplamayız" gibi Play'deki veri güvenliği beyanımızla doğrulanmamış gizlilik sözleri. Cortex'in düştüğü çelişkiye düşmeyelim.
- "Ücretsiz" kelimesini, ücretsiz plan gerçekten var olmadan kullanmak.

---

## 2. Play Store metni (taslak)

### Uygulama adı (en fazla 30 karakter)
```
KocaMind: Türkçe Yapay Zeka
```

### Kısa açıklama (en fazla 80 karakter)
```
Sohbet et, araştır, görsel ve video üret. İnternet yokken bile Türkçe AI.
```

### Uzun açıklama (en fazla 4000 karakter)
```
KocaMind, Türkçe düşünen ve işini bitiren yapay zeka asistanıdır. Sohbet, araştırma, görsel ve video üretimi, belge okuma ve internetsiz yapay zeka tek uygulamada.

NE ÖDEDİĞİNİ BİLİRSİN
• Haftalık abonelik yok, sürpriz ücret yok.
• Fiyat ve limitler uygulamada açıkça yazar.
• Aboneliğini tek dokunuşla iptal edersin.
[KARAR: ücretsiz plan kesinleşirse buraya bir satır eklenecek]

SOHBET ET
• Sorularına Türkçe, doğal ve net yanıtlar.
• Yanıt yazılırken ne yaptığını görürsün: düşünüyor, arıyor, yazıyor.
• Mesajlarını düzenle, yeniden dene, kopyala, paylaş.
• Sohbet geçmişinde ara, sabitle, yeniden adlandır.

İŞİNİ BİTİRSİN
• Derin Araştırma: Bir konuyu kaynaklarıyla birlikte derinlemesine araştırır.
• Agent: Senin için adım adım iş yapar; önemli bir adımdan önce mutlaka onayını ister.
• Belge ve fotoğraf ekle: PDF'ini özetlesin, fotoğrafını yorumlasın, ödevine yardım etsin.

ÜRET
• Yazdığın fikirden görsel oluştur.
• Kısa videolar üret.

KONUŞ VE DİNLE
• Sesli mesajla yaz, yanıtları sesli dinle.

İNTERNET YOKKEN DE ÇALIŞIR
• Yapay zeka modelini telefonuna indir, internet olmadan sohbet et.
• Çevrimdışıyken gönderdiğin mesajlar sıraya alınır, bağlantı gelince gönderilir.

TÜRKÇE ÖNCE
• Arayüzden yanıtlara kadar her şey Türkçe düşünülerek tasarlandı.
• Büyük yazı boyutu, TalkBack desteği ve azaltılmış hareket seçeneği.

KocaMind Türkiye'de geliştirildi. Önerin ya da sorunun varsa uygulama içinden bize yaz, okuyoruz.
```

---

## 3. Yayından önce yapılacaklar
1. `[KARAR]` işaretli yerler: fiyat, ücretsiz plan, deneme süresi.
2. "Tek dokunuşla iptal" sözü için uygulama içinde aboneliği yönetme bağlantısı olmalı (Google Play abonelik sayfasına giden bir bağlantı yeterli).
3. Play veri güvenliği formunu doldur. Açıklamadaki her söz bu formla tutarlı olmalı.
4. Ödeme için Play Billing gerekip gerekmediğini netleştir. Backend şu an iyzico kullanıyor; Play'de dijital abonelik için genelde Play Billing isteniyor.
5. "Kaynaklarıyla birlikte araştırır" ve "kısa videolar üret" sözlerini gerçek cihazda doğrula. Video, maliyet yüzünden kredi sistemine bağlanırsa metni buna göre güncelle.
