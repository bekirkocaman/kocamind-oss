# KocaMind Mobil: Expo'dan Native Kotlin'e Geçiş — Yol Haritası

**Karar (7 Ekim 2026):** Mobil uygulama Expo/React Native'den native Kotlin + Jetpack Compose'a taşınacak. Sadece Android hedefleniyor. Faz 1 durduruldu, odak tamamen bu geçişte.

**Kaynak:** `kocamind-mobil/src` (~7.900 satır TS/TSX, 9 ekran).
**Hedef:** Repo kökünde yeni `kocamind-android/` Gradle projesi.

## İlkeler

- Eski Expo uygulaması, yeni uygulama işlev olarak ona yetişene kadar **silinmez** ve telefonda çalışmaya devam eder.
- Geliştirme sürümü `com.tyler.kocamind.dev` paket adıyla kurulur, böylece eski uygulamanın yanında yan yana çalışır. Asıl paket adına (`com.tyler.kocamind`) geçiş sadece Plan 7'de yapılır.
- Backend ve Firestore şeması **değişmez**. Yeni uygulama, web ve backend ile aynı sözleşmeyi konuşur.
- Her alt plan kendi başına çalışan ve telefonda denenebilen bir APK üretir.
- Her görev yarım günlük adımdır.

## Alt planlar

| # | Plan | Çıktı | Tahmini süre | Kaynak dosyalar |
|---|---|---|---|---|
| 1 | İskelet, giriş, backend istemcisi | Giriş yapılabilen, drawer menülü, `/models` listesini çeken APK | ~4 gün | `_layout.tsx`, `auth.tsx`, `firebaseConfig.ts`, `backend.ts` (ilk 60 satır), `theme.ts` |
| 2 | Sohbet çekirdeği | Room ile yerel sohbet, `/chat` SSE akışı, markdown, model seçici, durdurma, eski AsyncStorage sohbetlerini içe aktarma | ~6 gün | `index.tsx`, `backend.ts`, `chatTypes.ts`, `chatModels.ts`, `historyStorage.ts`, `components/chat/*` |
| 3 | Çevrimdışı kuyruk ve bulut eşitleme | uid ve sohbet kimliğine bağlı WorkManager kuyruğu, `users/{uid}/chats` eşitlemesi, hafıza | ~5 gün | `offlineQueue.ts`, `chatCloudSync.ts`, `firebase.ts`, `localChatMemory.ts` |
| 4 | Yerel AI | NDK/CMake ile llama.cpp JNI, model kataloğu ve cihaz uyumluluğu, SHA-256 doğrulamalı indirme, model ekranı | ~8 gün | `offlineAI.ts`, `offlineModelPolicy.ts`, `deviceCompatibility.ts`, `offlineDeviceTools.ts`, `offline-models.tsx` |
| 5 | Modlar ve medya | Derin araştırma, agent adımları ve onay, görsel/belge ekleme, görsel/video üretimi, sesli okuma | ~6 gün | `backend.ts` (geri kalanı), `ModeSheet.tsx`, `CreationSheet.tsx`, `GeneratedVideo.tsx` |
| 6 | Diğer ekranlar | Ayarlar, kitaplık, admin paneli, kullanıcı düzenleme | ~4 gün | `settings.tsx`, `library.tsx`, `admin.tsx`, `admin-user.tsx`, `CustomDrawerContent.tsx` |
| 7 | Geçiş ve emeklilik | Özellik eşitliği kontrol listesi, asıl paket adı, imzalama, veri taşıma testi, Expo projesinin arşivlenmesi, README ve TODO güncellemesi | ~3 gün | — |

**Toplam:** yaklaşık 36 iş günü, yarım günlük adımlarla yaklaşık 7–9 hafta. Bu yüzden yayın hedefi Mart–Nisan 2027'den en az 1,5–2 ay kayar.

Her alt planın detaylı hali bir önceki plan bitince yazılır. Böylece önceki plandan öğrenilenler bir sonrakine yansır.

## Bilinen riskler

- **Yerel veri kaybı:** Paket adı aynı kalsa bile yeni uygulama AsyncStorage verisini otomatik okuyamaz. Android'de AsyncStorage verisi `RKStorage` SQLite veritabanında, `catalystLocalStorage` tablosunda durur. İçe aktarma Plan 2'de, indirilmiş GGUF modellerinin yeniden kullanımı Plan 4'te ele alınır.
- **İmza:** Asıl paket adının üzerine kurulum yapabilmek için aynı keystore ile imzalamak gerekir. Şu an `kocamind-mobil/android/app/debug.keystore` kullanılıyor. Mağaza öncesinde gerçek bir release keystore'a geçilmeli (Plan 7).
- **llama.cpp JNI:** Planlar içindeki en riskli kısım bu. Plan 4'ün ilk görevi, sadece "model yükle ve tek token üret" yapan bir spike olacak.
- **Bilinen hata, taşınmayacak:** `auth.tsx:174-182` kayıt sırasında `users/{deviceId}` belgesine yazıyor. Kurallar sadece `users/{uid}` yazımına izin verdiği için bu yazım muhtemelen reddediliyor. Yeni uygulama `users/{uid}` kullanacak.
