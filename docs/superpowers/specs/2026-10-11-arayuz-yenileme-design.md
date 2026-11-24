# KocaMind Android arayüz yenileme: tasarım

11 Ekim 2026. Durum: Bekir'in onayını bekliyor. Kaynak: onaylanan demo, https://claude.ai/artifact/FNUgV8FFpTLMq3NzMg2BwS (sürüm 5). Ürün kararları: `PRODUCT.md`.

## Amaç

Demoda beğenilen tasarımı gerçek uygulamaya (`kocamind-android`, Jetpack Compose) taşımak, derleyip telefondaki geliştirme sürümünün (`com.tyler.kocamind.dev`) **üstüne kurmak**. Sohbetler, ayarlar ve indirilen yerel model korunur; eski uygulama kaldırılmaz.

Başarı ölçütü: telefonda açılan uygulama demodaki gibi görünür ve hissettirir; mevcut özellikler (bulut ve yerel sohbet, medya, agent, çevrimdışı kuyruk, giriş, hesap işlemleri) gerilemez; JVM testleri geçer.

## Kararlar (Bekir'den)

- Görsel yön: kategori standardı, tam işçilikle (ChatGPT, Gemini, Perplexity, Claude çıtası). Nötr yüzeyler, tek vurgu rengi (lacivert `#2D4FD6`, koyuda `#8EA4FF`). Eski bakır/kömür palet bırakılır.
- Yanıt üretirken görünür düşünme penceresi ve canlı yanıt animasyonu zorunlu.
- Ayarlar profile dokununca açılır (sohbet üst çubuğundaki profil harfi ve yan menünün altındaki profil satırı). Ayrı dişli ikonu yok.
- Günlük kullanım mesaj sayısı olarak değil, **limit yüzdesi** olarak gösterilir.
- Dışa aktarma ham JSON olmaz: biçim seçimi (Belge .html varsayılan, Markdown, düz metin, Yedek .json) ve önizleme.

## Kapsam ve sıra

Her aşama ayrı derlenir, testleri çalışır ve telefona kurulup kontrol edilir. Bir aşama bitmeden diğerine geçilmez.

### Aşama 1: Tema temeli
- `ui/theme`: yeni renk token'ları, **açık / koyu / sistem** tema (tercih `SharedPreferences` içinde saklanır, varsayılan sistem). `KmColors` sabit nesnesi yerine `CompositionLocal` ile tema duyarlı renkler; mevcut ekranlar aynı adlarla çalışmaya devam eder (geçiş sırasında kırılma olmasın diye adlar korunur).
- Font: Roboto Flex (değişken font, `res/font` içine gömülü; Türkçe karakterleri destekler). `KmType` MaterialTheme typography ile bağlanır.
- Şekiller ve hareket token'ları demodaki değerlerle güncellenir; azaltılmış hareket desteği korunur.
- Yeni **canlı KocaMind işareti** (`KmMark`): dört nokta; durumlar `Idle`, `Think` (dönme ve nefes), `Stream` (yavaş dönüş), `Done` (yerine oturma). Eski `KMonogram` bunun yerine geçer.

### Aşama 2: Sohbet ekranı
- Üst çubuk: menü, ortada model seçici, yeni sohbet, sağda profil harfi (Ayarlar'ı açar).
- Boş ekran: animasyonlu işaret, saate göre selamlama, yatay öneri kartları (gerçek eylemlere bağlı: örnek soru, fotoğraf oluştur, derin araştırma, agent).
- Composer: üstte metin, altta `+`, mikrofon, gönder/durdur dönüşümü; mod ve ek çipleri composer içinde.
- **Düşünme penceresi (11 Ekim 2026'da öne alındı ve uygulandı):** gönderince açılır, "Düşünüyor · N sn" ışıltısı, sayaç, işaret `Think` durumunda; modelin düşünce metni canlı akar. İlk yanıt metni gelince "N saniye düşündü" olarak kapanır, dokununca açılır. Kaynak: SSE `delta.reasoning_content` (DeepSeek R1 doğal olarak gönderir; OpenAI Responses için backend `reasoning.summary: auto` ister ve özet olaylarını bu alana çevirir, hesap desteklemezse özetsiz tekrar dener). Düşünce metni `ChatMessage.thinking` içinde saklanır, modele geçmiş olarak gönderilmez. Düşünce metni gelmeyen modellerde (yerel, DeepSeek V3) yalnız bekleyiş başlığı görünür; metin **uydurulmaz**.
- **Akış yumuşatma:** gelen parçalar bir kelime tamponuna girer, sabit hızda (kuyruk büyürse hızlanarak) ekrana çıkar; her kelime bulanıktan netleşerek belirir. Düzen kaymaz. Markdown her parçada baştan çizilmez.
- Kullanıcı mesajı yaylanarak yerine oturur; yanıt bitince eylemler sırayla belirir: Kopyala, Yeniden üret, beğen, beğenme, `⋯` (Sesli oku, Paylaş). Beğenmeme ince geri bildirim çiplerini açar.
- Haptic: gönder, onay, kopyala, uzun basma (ayarlardan kapatılabilir).
- Bağlantı hatası, kota, çevrimdışı kuyruk ve tam ekran sunucu hatası demodaki görünüme getirilir.

### Aşama 3: Ayarlar ve alt ekranlar
- Ayarlar: Android 16 tarzı gruplu kartlar. Profil kartı + **günlük limit**: `GET /usage/me` uçtan `usage.chat / limits.chat` yüzdesi; renk %70 sarı, %90 kırmızı; sıfırlanma UTC gece yarısı olduğu için geri sayım Türkiye saatiyle 03:00'e göre gösterilir. Uç yanıt vermezse kart "Kullanım bilgisi alınamadı" der, sayı uydurmaz.
- Gruplar: Görünüm ve his (tema, titreşim, azaltılmış hareket), Yapay zekâ (Özel Talimatlar, varsayılan model, Çevrimdışı AI Modelleri), Veri ve gizlilik (Kitaplık, Dışa aktar, Geçmişi temizle), Hakkında, Hesap (Çıkış, Hesabı sil).
- Özel Talimatlar ayrı sayfa: öneri çipleri, sayaç, kaydet. Mevcut `custom_instructions_<e-posta>` anahtarı korunur.
- Dışa aktarma alt sayfası: kapsam (Bu sohbet / Tüm sohbetler), biçim, önizleme. Dosya Android'in "dosya oluştur" penceresiyle (`ACTION_CREATE_DOCUMENT`) kaydedilir.
- Çevrimdışı AI Modelleri, Kitaplık (tam ekran görüntüleyici, tekli silme ve geri al), Giriş/Kayıt ekranları yeni görünüme getirilir; mevcut mantık değişmez.
- Hesap silme onayında "SİL" yazma şartı.

### Aşama 4: Geçişler
- Ekranlar arası Android paylaşılan eksen geçişi ve **tahmini geri** (predictive back) desteği.

## Kapsam dışı

- Backend'e yeni uç eklemek. (Düşünce metni mevcut `/chat` akışına eklendi, yeni uç gerekmedi.)
- Web uygulaması (`kocamind-web`): bu tasarım dili sonra ayrıca uygulanır.
- Fiyat veya Pro plan sayfası (fiyatlar belli değil, uydurulmaz).
- Yönetim (admin) ekranlarının yeniden tasarımı.

## Mimari notlar

- `ChatViewModel` (868 satır) büyütülmez. Akış yumuşatma ayrı, test edilebilir bir sınıf (`StreamSmoother`); düşünme süresi ve durumu `ChatMessage` üzerinde küçük alanlarla taşınır.
- Kullanım bilgisi için `BackendClient` içinde `usage()` çağrısı ve küçük bir `UsageRepository`.
- Dışa aktarma biçimleri saf fonksiyonlar (`exportHtml`, `exportMarkdown`, `exportText`, mevcut `exportChatsJson`) ve birim testleri.

## Test ve kurulum

- Her aşamada `./gradlew testDebugUnitTest` ve `assembleDebug`. Yeni saf mantıklar (akış yumuşatma, dışa aktarma biçimleri, limit yüzdesi) için birim testleri.
- Kurulum: `installDebug` ile `com.tyler.kocamind.dev` üzerine güncelleme. **Kaldırma yapılmaz**, veriler korunur.
- Telefonda kontrol: açık/koyu tema, büyük yazı (font_scale 1.3), giriş, sohbet akışı ve durdurma, düşünme penceresi, ayarlar, limit, dışa aktarma, çevrimdışı kuyruk.

## Riskler

- Tema token'larının tüm ekranlara yayılması geniş bir değişiklik; adlar korunarak aşamalı geçilecek.
- Roboto Flex dosyası APK'yı birkaç yüz KB büyütür.
- Akış yumuşatma yanıtın bitişini yarım saniye kadar geciktirebilir; kuyruk hızlanması bunu sınırlar.
