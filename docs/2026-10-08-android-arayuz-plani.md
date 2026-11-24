# KocaMind Android arayüz incelemesi ve tasarım planı

8 Ekim 2026. Durum: öneri; uygulama koduna değişiklik yapılmadı. Bekir önce inceleme ve plan istedi. Bulgular kaynak koduna dayanır; telefonda görsel inceleme ve uçtan uca kullanım testi yapılmadı.

## Mevcut temel

Compose ekranları; ortak renk, boyut, hareket ve bileşenler; giriş/kayıt, sohbet, model/mod seçimi, medya, drawer, kitaplık, ayarlar, yönetim, çevrimdışı modeller mevcut. Yaşam döngüsüne uygun StateFlow toplama, klavye boşluğu ve azaltılmış hareket desteği var.

## Doğrulanan eksikler

- Kitaplık görseline basma boş callback çalıştırıyor. Büyük önizleme ve görsel işlemleri eksik (`ui/settings/LibraryScreen.kt`).
- Tema yalnız koyu; sistem/açık/koyu tercihi yok. `KmColors` sabit nesnesi tüm ekranlarda kullanılıyor; açık tema için renk erişimi de dönüştürülmeli (`ui/theme/Theme.kt`, `Color.kt`).
- Tipografi sistem fontu kullanıyor. `KmType` MaterialTheme typography alanına bağlanmamış; özel bileşenlerle varsayılan Material pencereleri farklı tipografi kullanabilir (`Type.kt`, `Theme.kt`).
- Özel ikon düğmeleri 32/40 dp; ortak bileşende 48 dp minimum etkileşim alanı açıkça uygulanmıyor. Cihazda gerçek dokunma sınırları ve TalkBack doğrulanmalı (`ui/components/Kit.kt`, `ui/chat/MessageRow.kt`).
- Drawer uzun basma yardımcısında pointerInput kullanılırken semantik onClick/onLongClick tanımlanmıyor; erişilebilir eylemler eklenmeli (`ui/components/PressableScale.kt`).
- Başlangıç ekranında selamlama var, hızlı başlangıç önerileri yok (`ui/chat/ChatScreen.kt`).
- Sohbet mantığı yaklaşık 40 KB ChatViewModel dosyasında toplanmış. Tasarım akışlarını değiştirmek gerektiğinde medya/agent/kuyruk sorumluluklarını ayırmak düşünülebilir; yalnız görünüm işi için kapsamlı yeniden yazım gerekli değil.

Android CI `.github/workflows/android.yml` içinde mevcut: JVM/Robolectric testleri ve debug APK. Önceki yalnız ci.yml üzerinden yapılan değerlendirme eksikti. 8 Ekim kontrolünde `testDebugUnitTest` başarılı; test görevi UP-TO-DATE olduğu için mevcut sonuç yeniden kullanıldı. Bu, telefondaki bütün özelliklerin doğrulanması değildir.

## Önerilen görsel yön

Sakin, sıcak ve odaklı: koyu kömür, kırık beyaz, sınırlı bakır vurgusu. Bu renkler mevcut kimliğin devamı; kullanıcı kararı henüz alınmadı. Türkçe karakterleri destekleyen okunaklı font, belirgin başlık hiyerarşisi, kontrollü boşluklar, işlevi anlatan kısa hareketler. Sohbet okunabilirliği ana öncelik.

## Uygulama sırası

1. Telefonda mevcut giriş, boş sohbet, dolu sohbet, drawer, seçim panelleri, ayarlar, kitaplık ve yerel model ekranlarının başlangıç görüntülerini incele. Küçük ekran, büyük yazı, klavye ve hata durumlarını kontrol et.
2. Sohbet/başlangıç, drawer ve ayarlar için iki görsel yönü önizleme olarak sun. Bekir ile yönü seç; sonra uygulamaya geç.
3. Ortak renk, font, boşluk, şekil ve düğme sistemini kur. Açık/koyu/sistem tema tercihi ve erişilebilir etkileşim alanlarını tamamla.
4. Önce sohbet ekranı: başlık/model seçimi, başlangıç önerileri, mesaj okunabilirliği, giriş alanı, ekler, durum/agent onayı ve mesaj işlemleri.
5. Drawer ve araç/model panelleri: geçmiş hiyerarşisi, arama, seçili durumlar, çevrimiçi/yerel model ayrımı, kullanılamayan özellik açıklamaları.
6. Giriş, ayarlar, kitaplık ve yerel model ekranları: ortak kimlik, anlamlı boş/hata/yükleme halleri. Kitaplıkta önizleme, paylaşma/kaydetme ve tekli silme. Yerel model ekranında önerilen model ve indirme/depoma/uyumluluk bilgilerine öncelik.
7. JVM testleri, Android lint ve APK derleme; cihazda giriş, akış/durdurma, medya, onay, çevrimdışı kuyruk, hesap değişimi ve tema/yazı boyutu testleri. Görsel öncesi/sonrası kontrolü.

## Kabul ölçütleri

Basılabilir görünen öğeler iş yapmalı; küçük ekranda ve büyük yazıda içerik kesilmemeli; klavye gönderme alanını örtmemeli; ışık/koyu temada metinler okunmalı; TalkBack eylemleri anlaşılır olmalı; ekran dönüşü ve geri dönüşte giriş verileri/durum korunmalı; mevcut backend ve AI işlevleri gerilememeli.

## Açık doğrulamalar

Google girişi ve release yapılandırması, hesaplar arası yerel veri ayrımı, internet dönüşünde kuyruk, uzun konuşma kaydırması, medya indirme/oynatma ve gerçek kota hatalarının sunumu cihazda ayrıca kontrol edilmeli. Bunlar bu incelemede doğrulanmış hata olarak sınıflandırılmadı.

## Rehberler

- android-compose-design: görsel yön ve Compose tema/yerleşim.
- material-design-3: tasarım tutarlılığı ve erişilebilirlik için sonraki aşamada.
- modern-jetpack-compose: uygulama ve teknik kontrol. Eski sürüm varsayımları projenin sürümlerini değiştirmek için kullanılmayacak.
