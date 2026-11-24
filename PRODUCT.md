# Product

<!-- impeccable:product-schema 1 -->

## Platform

android

## Users

Herkes: günlük Türkçe asistan arayan genel kullanıcı, öğrenci/çalışan, gizlilik isteyen. Bekir tek bir ana kitle seçmedi (11 Ekim 2026). Ortak beklenti: pahalı aboneliklere girmeden kaliteli bir AI'a ulaşmak.

## Product Purpose

KocaMind, Türkçe konuşan bir AI asistanı. Amaç **ucuzluk ve kalite**: rakiplerden daha uygun fiyata, kaliteden ödün vermeden çalışan bir uygulama. Başarı, kullanıcının ayrı ayrı uygulamalara ve aboneliklere ihtiyaç duymadan işini KocaMind'da bitirmesi.

## Positioning

**Hepsi tek yerde.** Sohbet, fotoğraf oluşturma, video oluşturma, Agent, derin araştırma, belge/görsel ekleme, sesli mesaj ve internetsiz yerel AI tek uygulamada. Tasarımın göstermesi gereken asıl fark bu.

## Operating Context

- Android telefon (minSdk 26, targetSdk 36), Jetpack Compose.
- Bulut modelleri (backend üzerinden) ve telefonda çalışan GGUF modelleri (llama.cpp).
- Çevrimdışıyken mesajlar kuyruğa alınır; yerel modelle internetsiz sohbet yapılabilir.
- Ücretsiz ve Pro plan var. Fiyatlar burada belirtilmedi; uydurulmamalı.

## Capabilities and Constraints

- Modlar: Sohbet, Agent (onay isteyen işlemler), Derin Araştırma.
- Medya: fotoğraf/video üretimi, fotoğraf/kamera/belge ekleme, ses → yazı, sesli okuma.
- Mesaj işlemleri: düzenle, kopyala, paylaş, yeniden dene, beğen/beğenme.
- Drawer: sohbet geçmişi, arama, sabitleme, yeniden adlandırma; Kitaplık, Ayarlar, Yönetim, Çevrimdışı Modeller.
- Azaltılmış hareket tercihi desteklenir ve korunmalıdır.

## Brand Commitments

- Ad: **KocaMind**. Bunun dışındaki görsel kimlik (renk, logo, font) 11 Ekim 2026'da sıfırdan yenilenmek üzere bırakıldı.
- Eski palet Claude uygulamasına çok benziyor; yeni kimlik rakiplere benzememeli.
- Bekir klişe, neonlu "AI slop" görselleri sevmiyor.
- **Görsel yön: kategori standardı, tam işçilikle** (11 Ekim 2026, Bekir'in seçimi). KocaMind; ChatGPT, Gemini, Perplexity ve Claude'un yanında durmalı, işçilik çıtası bunlar. Nötr yüzeyler ve tek vurgu rengi; rakiplerin renk/logo kimliği kopyalanmaz.
- Yanıt üretirken diğer AI'lar gibi görünür bir **düşünme penceresi** ve canlı yanıt animasyonu şart (11 Ekim 2026: animasyonsuz ilk demo "AI slop" bulundu).
- Bol, anlamlı animasyon isteniyor: hata ekranları dahil her hal (boş, yükleniyor, hata, çevrimdışı, kuyruk, onay) özenle tasarlanmalı.

## Evidence on Hand

Gerçek kullanıcı yorumu, kullanıcı sayısı, benchmark veya fiyat bilgisi yok; bunlar uydurulmamalı.

## Product Principles

1. Tek yerde her şey, ama kalabalık değil: özellikler ihtiyaç anında çıkar.
2. Ucuz hissettirmeyen ucuzluk: her detay özenli; hata ve boş durumlar da ürünün parçası.
3. Kullanıcı her an ne olduğunu bilir: gönderildi, düşünüyor, arıyor, kuyrukta, internetsiz.
4. Türkçe önce: metinler doğal Türkçe, Türkçe karakterler kusursuz.

## Accessibility & Inclusion

48 dp dokunma alanı, TalkBack eylemleri, büyük yazı boyutunda kesilmeyen içerik, azaltılmış hareket desteği.
