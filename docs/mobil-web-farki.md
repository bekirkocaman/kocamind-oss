# Android ile web arasındaki farklar

`klon-tasarim` dalındaki Android uygulaması (`kocamind-android/`) ile web uygulaması (`kocamind-web/`) karşılaştırıldı (24 Ekim 2026). Jüri yalnız web'e baktığı için önce görünen farklar, sonra davranış farkları ele alındı. Backend değiştirilmedi; web yalnız mevcut uçları kullanır.

Durum: **Yapıldı** (bu dalda web'e taşındı), **Zaten vardı** (web'de önceden aynı davranış vardı), **Yapılmadı** (neden yanında), **Backend gerekli**, **Web'e uymaz** (yalnız telefona özgü).

## Görsel tasarım (Claude klonu)

| Özellik | Android'de nerede | Web'deki eski durum | Durum |
|---|---|---|---|
| Sıcak gri / turuncu palet (açık ve koyu) | `ui/theme/Color.kt` | `claude-theme.css` benzer ama farklı tonlar | Yapıldı: değerler Android paletinden alındı |
| Inter arayüz, JetBrains Mono kod, Newsreader serif yanıt yazısı | `ui/theme/Type.kt`, `res/font/` | Inter ve JetBrains Mono vardı, serif yanıt yoktu | Yapıldı |
| Çekmece: serif "KocaMind" başlığı, arama düğmesi, bölümler (Hafıza, Bağlantılar, Skill'ler, Admin), "Son kullanılanlar", altta profil yuvarlağı + "Yeni sohbet" hapı | `ui/drawer/AppDrawer.kt` | Logo, "Yeni Sohbet" düğmesi, arama kutusu, altta profil satırı ve menü | Yapıldı |
| Üst çubuk: solda menü, sohbet varken sağda yeni sohbet ve seçenekler menüsü (Paylaş, Yeniden adlandır, Sabitle, Sil) | `ui/chat/ChatScreen.kt` `ChatTopBar` | İndir düğmesi ve model seçici | Yapıldı |
| Karşılama: logo işareti + serif "Merhaba, Ad" | `ChatScreen.kt` `EmptyState` | "Günaydın, Ad." başlığı ve alt yazı | Yapıldı |
| Yazı kutusu: üstte metin, altta "+" ve model hapı, sağda mikrofon / gönder / durdur | `ChatScreen.kt` `Composer` | Tek satır: +, mikrofon, metin, gönder; model üst çubukta | Yapıldı (model seçici yazı kutusuna taşındı) |
| "En alta" yuvarlak düğmesi | `ChatScreen.kt` `MessageList` | Yoktu | Yapıldı |
| Sohbet sonu uyarısı "KocaMind bir yapay zekâdır ve hata yapabilir." | `ChatScreen.kt` | Yoktu | Yapıldı |
| Model seç ve Sohbete ekle sheet'leri (X ve ortalı başlık) | `ui/chat/ToolSheets.kt`, `ui/components/Sheet.kt` | Açılır panel | Yapılmadı: web'de açılır panel masaüstüne daha uygun; düzeni korundu, yalnız yer ve renkler uyarlandı |
| Giriş ekranı: sade karşılama (işaret + "KocaMind", "Google ile devam et", "E-posta ile devam et", koşullar notu); e-posta formunda Giriş Yap / Kayıt Ol sekmeleri, etiketli alanlar, Şifremi Unuttum; "E-postanı kontrol et" ekranı | `ui/auth/AuthScreen.kt` | Kayan öneri kartları ve mor/turuncu ışıklı arka plan üstünde giriş kutusu; Google hatası ham kodla gösteriliyordu | Yapıldı (ilk turda atlanmıştı, kullanıcı fark etti). Google betiği ekran açılınca önceden yüklenir; hatalar Türkçe |
| Animasyonlar: düşünme penceresi ("Düşünüyor" ışıltısı, canlı sayaç, akan düşünce metni, sonra "N saniye düşündü"), yeni mesajın süzülerek gelmesi, yanıp sönen turuncu imleç, ayar gruplarının sırayla yükselmesi, kullanım çubuğunun dolması | `ui/chat/ThinkingPanel.kt`, `ChatParts.kt` (`FadeInDown`, `StreamCursor`), `SettingsKit.kt` (`Rise`) | Yalnız "Yanıtını hazırlıyorum" yazısı ve dolu kare imleç; modelin düşünce metni (`reasoning_content`) web'de hiç gösterilmiyordu | Yapıldı; azaltılmış harekette kapanır |
| Dokunsal geri bildirim (titreşim) | `AppPrefs.haptics` | — | Web'e uymaz |

## Ayarlar

| Özellik | Android'de nerede | Web'deki eski durum | Durum |
|---|---|---|---|
| Klon düzeni: en üstte hesap satırı (e-posta, plan hapı), "Daha fazlasını ister misin?" Yükselt kartı, başlıksız gruplar | `ui/settings/SettingsScreen.kt` | 13 sekmeli düz liste | Yapıldı: sol menü hesap satırıyla başlar, sekmeler Android sırasıyla başlıksız gruplara ayrıldı, Pro olmayana Yükselt kartı (Faturalama sekmesine götürür) |
| Profil: görünen adı Firebase'de güncelleme | `SettingsSheets.kt` `ProfileSheet` | Hesap sekmesinde yalnız ad/e-posta gösterimi | Yapıldı (`updateProfile`) |
| Kullanım: günlük limit çubuğu, yüzde, yenilenmeye kalan süre (UTC gece yarısı) | `SettingsScreen.kt` `UsageCard`, `UsageLogic.kt` | Mesaj/görsel/video/kod sayıları | Yapıldı (sayılar da korundu) |
| Renk modu: Sistem / Açık / Koyu | `SettingsSheets.kt` | Yalnız Açık / Koyu | Yapıldı |
| Yazı tipi stili: yanıtlarda Serif / Sade | `FontSheet`, `AppPrefs.replySans` | Yoktu | Yapıldı |
| Ses: okuma dili (Türkçe/İngilizce), hızı, önizleme | `VoiceSheet` | Sabit `tr-TR`, varsayılan hız | Yapıldı (Web Speech API) |
| Bildirimler: arka planda biten yanıtı bildir | `NotificationsSheet`, `ReplyNotifier.kt` | Yoktu | Yapıldı (sekme arka plandayken tarayıcı bildirimi) |
| Azaltılmış hareket anahtarı | `SettingsScreen.kt` | Yalnız işletim sistemi tercihi | Yapıldı |
| Gizlilik: hafıza anahtarı, politika bağlantısı | `PrivacySheet` | Hafıza anahtarı vardı | Yapıldı: politika bağlantısı eklendi |
| Gizlilik: ekran görüntüsünü engelle (FLAG_SECURE) | `PrivacySheet` | — | Web'e uymaz: tarayıcı ekran görüntüsünü engelleyemez |
| Faturalandırma, Özellikler, Code, API anahtarı, Paylaşım | `SettingsScreen.kt` ("Yakında") | Faturalama sekmesi çalışıyor | Zaten vardı (Faturalama); diğerleri Android'de de yok |
| Kitaplık (üretilen görseller) | `ui/settings/LibraryScreen.kt` | Yoktu | Yapılmadı: Android görselleri cihazda tutuyor; web'de sohbetlerdeki görselleri toplamak ayrı bir iş, sıraya alındı |
| Sohbetleri dışa aktar: okunaklı belge / Markdown / metin | `ExportSheet.kt`, `ExportFormats.kt` | JSON ve tek sohbet metni | Yapıldı: tek sohbet (üst çubuk menüsü) ve tüm sohbetler (Ayarlar > Veri) için Markdown ve düz metin; okunaklı HTML belge yapılmadı |
| Çevrimdışı AI modelleri (GGUF) | `ui/offline/` | — | Web'e uymaz |

## Bağlantılar ve Skill'ler

| Özellik | Android'de nerede | Web'deki eski durum | Durum |
|---|---|---|---|
| Bağlantılar sunucu kataloğundan (ad ve açıklama `/connectors` yanıtından) | `ui/settings/ConnectorsScreen.kt` | Sabit liste; Spotify/YouTube "Yakında" satırları | Yapıldı: liste sunucudan, Gmail (web'e özgü) korunur, sahte "Yakında" satırları kaldırıldı |
| Bağlantıyı kesmeden önce onay | `ConnectorsScreen.kt` | Doğrudan kesiyordu | Yapıldı |
| Durum satırı (Bağlı / Yeniden bağlanman gerekiyor), "çok yakında açılıyor" notu, yüklenemedi + Tekrar dene | `ConnectorsScreen.kt` | Kısmen | Yapıldı |
| Skill'lerde "nerede çalışır" rozetleri | `SkillsScreen.kt` | Yoktu | Yapıldı |

## Hafıza

| Özellik | Android'de nerede | Web'deki eski durum | Durum |
|---|---|---|---|
| Kategorilere göre gruplama (Kişisel, Tercihler, İş, Sağlık, Projeler, Diğer) | `MemoryScreen.kt` `groupMemories` | Düz liste | Yapıldı |
| "KocaMind'in yorumu" kartı (`POST /memory/insight`) | `MemoryScreen.kt` `InsightCard` | Yoktu | Yapıldı |
| Başka bir yapay zekâdan hafıza taşıma (istem + `POST /memory/import`) | `MemoryImport.kt` | Yoktu | Yapıldı |
| Hafıza ve otomatik kaydetme anahtarları hafıza sayfasında | `MemoryScreen.kt` | Gizlilik sekmesinde | Yapıldı (aynı ayarlar iki yerde) |
| Hafızanın cihazda kopyası (çevrimdışı açılış) | `data/memory/MemoryRepository.kt` | Yoktu | Yapıldı: kullanıcı başına localStorage kopyası, çıkışta silinir |
| Yerel model hafızayı kullanır | `OfflineAiService.kt` | — | Web'e uymaz |

## Sohbet davranışı

| Özellik | Android'de nerede | Web'deki eski durum | Durum |
|---|---|---|---|
| Ortak sohbet şeması (mesaj kimliği, rol, zaman) | `data/sync/CloudChatMapping.kt` | `lib/chatSchema.js` | Zaten vardı |
| Üç yönlü eşitleme, işlemle yazma, tekrar deneme, gerçek zamanlı | `data/sync/` | `lib/chatMerge.js`, `lib/chatSync.js`, `useChatLibrary.js` | Zaten vardı |
| Sohbet özeti: kullanıcının söyledikleri / asistanın doğrulanmamış iddiaları | `MemoryContext.kt` | `lib/memoryContext.js` | Zaten vardı |
| Hesap değişince süren cevap durur, açık sohbet sonraki hesaba yazılmaz, ekran temizlenir | `ui/chat/ChatViewModel.kt` | Çıkışta liste temizleniyordu ama süren cevap durmuyor, bitince yeni hesabın listesine yazılabiliyordu | Yapıldı: süren cevap durdurulur, yeni hesaba yazılmaz. Fark: Android yarım kalan cevabı sahibinin geçmişine kaydeder, web kaydetmez (sohbetin o ana kadarki kısmı zaten kayıtlı) |
| Çevrimdışı kuyruk kendi hesabına döner | `ChatViewModel.kt` | Kuyruk `userId` ile filtreleniyordu | Zaten vardı |
| Uzun basınca sohbet menüsü (Sabitle, Yeniden adlandır, Sil) | `AppDrawer.kt` | Üzerine gelince düğmeler | Zaten vardı (masaüstü karşılığı) |
| Derin düşünme anahtarı (Sohbete ekle sheet'i) | `ToolSheets.kt` | Yoktu | Yapılmadı: web `/chat` isteği bu bayrağı göndermiyor; backend'in web için desteği doğrulanmadan eklenmedi |
| Kamera ile fotoğraf, belge (PDF) ekleme | `ChatScreen.kt` | Yalnız görsel | Yapılmadı: web dosya yükleme `/upload` ile görsel odaklı; belge ekleme ayrı iş |

## Ek bulgu

- Ayarlar açılınca `--font-ui: var(--font-ui)` satırı değişkeni geçersiz kılıyor, bütün arayüz tarayıcının varsayılan serif yazısına düşüyordu (canlı sitede de var). Düzeltildi.

## Doğrulama (24 Ekim 2026)

- `kocamind-web`: `npm ci`, `npm run lint` temiz, `npm test` 74/74, `npm run build` temiz.
- Playwright misafir testleri 8/8 (giriş ekranı testleri yeni akışa göre güncellendi); giriş yapmış kullanıcı testleri (Firebase emülatörü + gerçek backend + sahte model) 4/4. Hesap silme testi yeni akışa (Profil > Hesabı sil > "SİL") göre güncellendi.
- Backend'e dokunulmadı; bağımlılık güncellemesi sonrası `backend` testleri 250/250.
