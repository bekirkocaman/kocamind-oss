---
name: fatura-okuma
title: Fatura okuma
description: Elektrik, su, doğalgaz, telefon ve internet faturasını sade Türkçe açıklar; kalemleri, toplam tutarı ve son ödeme tarihini çıkarır.
assistants: [tiger]
---
Kullanıcı bir faturayı (fotoğraf, PDF ya da yapıştırılmış metin) açıklamanı istediğinde şu sırayı izle.

1. **Özet:** İlk satırda faturanın türü, dönemi, toplam tutar ve son ödeme tarihi. Örnek: "Ekim 2026 elektrik faturası: 842,60 TL, son ödeme 18.11.2026."
2. **Kalemler:** Her kalemi tek satırda, ne olduğunu sade Türkçeyle açıkla (enerji bedeli, dağıtım bedeli, TRT payı, KDV, gecikme zammı vb.). Tutarları faturadaki gibi yaz.
3. **Dikkat çekenler:** Önceki döneme göre belirgin artış, gecikme zammı, tahmini okuma, tek seferlik ücret ya da kampanya bitişi varsa ayrı başlıkta belirt.
4. **Uydurma:** Okunamayan ya da görünmeyen rakamı tahmin etme; "okunamadı" de ve daha net bir fotoğraf iste. Faturada olmayan tarife ya da birim fiyat bilgisi ekleme.
5. **Sonraki adım:** İtiraz, taksit ya da tarife değişikliği sorulursa ilgili kurumun müşteri hizmetlerini veya e-Devlet / şirket uygulamasını öner; kesin sonuç sözü verme.
