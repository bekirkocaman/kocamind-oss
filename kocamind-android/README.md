# KocaMind Android (Kotlin + Jetpack Compose)

Eski Expo uygulamasının native karşılığı. Eski uygulama 2026-10-08'de arşivlendi: repodan çıkarıldı, yerelde `Desktop/kocamind-arsiv/kocamind-mobil` (kendi git deposu, GitHub `bekirkocaman/kocamind-mobil`). Yol haritası: `docs/superpowers/plans/2026-10-07-kotlin-gecis-yol-haritasi.md`.

## Sürümler

| Sürüm | Paket | Ad | Ne için |
|---|---|---|---|
| debug | `com.tyler.kocamind.dev` | KocaMind Dev | Geliştirme; eski uygulamanın **yanına** kurulur |
| release | `com.tyler.kocamind` 2.0.0 (9) | KocaMind | Asıl uygulama |

Release, gerçek yükleme anahtarıyla imzalanır: `keystore/release.jks` + `keystore.properties` (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`). İkisi de git'e girmez; yoksa release imzasız çıkar. **Anahtar kaybolursa uygulama aynı paket adıyla güncellenemez, yedeği güvenli bir yerde tutulmalı.** SHA-1 `BB:35:98:06:2A:0C:A8:61:6C:23:DB:B4:E0:CA:73:32:62:33:38:C8` Firebase'de `com.tyler.kocamind` için kayıtlı olmalı (Google girişi).

2026-10-08'de eski Expo uygulaması (1.3.3) telefondan silinip 2.0.0 temiz kuruldu. `data/legacy/LegacyMigration` ve `keystore/legacy-debug.keystore` artık kullanılmıyor (eski anahtarla imzalı bir sürüm olmadan üzerine kurulum mümkün değil).

## Taşınanlar

- **Görünüm:** `theme.ts` renk, tipografi, boşluk ve hareket değerleri; PressableScale, Button, IconButton, KMonogram, Surface, Banner, Skeleton, Sheet; lucide ikonları (`tools/gen_lucide.py` ile üretilir).
- **Drawer:** yeni sohbet, arama, kitaplık, admin, geçmiş sohbetler (sabitle / yeniden adlandır / sil), profil kartı ve PRO rozeti.
- **Giriş:** e-posta, kayıt, doğrulama, şifre sıfırlama, Google (Credential Manager).
- **Sohbet:** SSE akışı, markdown, düşünme noktaları, akış imleci, durdurma, düzenleme, yeniden deneme, sesli okuma, kopyalama, paylaşma, beğeni; model seçici.
- **Modlar ve medya:** derin araştırma, agent (onay sorusuyla), fotoğraf/kamera/dosya ekleme, görsel ve video üretimi, sesli mesaj.
- **Çevrimdışı:** internet yokken kuyruk, bağlantı gelince gönderim; `users/{uid}/chats` bulut eşitlemesi (web ile aynı şema).
- **Ekranlar:** Ayarlar, Kitaplık, Admin Paneli, Kullanıcı Düzenle, Çevrimdışı AI Modelleri.
- **Yerel AI:** llama.cpp. Model kataloğu, cihaz uyumluluk puanı, akıllı öneri, indirme, hız testi, çökme koruması; saat/tarih/hesap/birim soruları cihazda cevaplanır; geçmiş sohbetlerden yerel hafıza.
- **Veri taşıma (kullanılmıyor):** eski uygulamanın AsyncStorage veritabanını (`RKStorage`) okuyan kod duruyor; yalnız eski uygulamanın üzerine kurulumda çalışırdı.

## Yerel AI nasıl çalışıyor

`app/src/main/jniLibs/arm64-v8a/librnllama_*.so` dosyaları, `llama.rn` 0.12.7 paketinin hazır derlenmiş **saf llama.cpp** kütüphaneleri (React Native bağımlılığı yok; llama C API'si önek olmadan dışa açık). `app/src/main/cpp/llama_jni.cpp` bunların üstünde küçük bir JNI köprüsü. Her CPU varyantı (v8, dotprod, dotprod+i8mm) için ayrı köprü derlenir ve çalışma anında en hızlısı yüklenir. Başlıklar `cpp/include/` altında (MIT, lisanslar yanında).

Yalnız `arm64-v8a` desteklenir (eski uygulama da 64 bit gerektiriyordu).

## Kurulum

- Android Studio + SDK, NDK `27.1.12297006`, CMake `3.22.1`.
- Gradle, Android Studio JBR ile: `export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"`
- `local.properties` (git'e girmez):

  ```properties
  sdk.dir=C:/Users/tyler/AppData/Local/Android/Sdk
  # İsteğe bağlı, varsayılan https://api.kocamind.com
  backendUrl=http://10.0.2.2:3000
  ```

- `app/google-services.json` git'e girmez. İçinde `com.tyler.kocamind` ve `com.tyler.kocamind.dev` client'ları olmalı (her ikisinde debug SHA-1'leri kayıtlı). Dosya yoksa derleme yine geçer, uygulama "Firebase yapılandırması eksik." der. CI için içeriği `GOOGLE_SERVICES_JSON` secret'ına konur.

## Komutlar

```bash
./gradlew testDebugUnitTest      # JVM + Robolectric testleri, cihaz gerekmez
./gradlew installDebug           # KocaMind Dev'i telefona kurar (açmaz)
./gradlew assembleRelease        # app/build/outputs/apk/release/app-release.apk
```

### Yerel AI cihaz testi

Model dosyasını uygulamanın klasörüne koyup duman testini çalıştırır (uygulamayı kaldırmaz, ekrana bir şey getirmez):

```bash
adb push qwen2.5-0.5b-instruct-q4_k_m.gguf /data/local/tmp/qwen.gguf
adb shell "cat /data/local/tmp/qwen.gguf | run-as com.tyler.kocamind.dev sh -c 'mkdir -p files/offline-models && cat > files/offline-models/qwen2.5-0.5b-instruct-q4_k_m.gguf'"
./gradlew installDebug installDebugAndroidTest
adb shell am instrument -w -e class com.tyler.kocamind.LlamaSmokeTest com.tyler.kocamind.dev.test/androidx.test.runner.AndroidJUnitRunner
```

Sonuç (2026-10-08, Samsung SM-S711B, Qwen 2.5 0.5B): varyant `v8_2_dotprod_i8mm`, Türkçe akışlı cevap, EOS'ta durdu; ısınmış üretim 16,6 token/sn, hız testi 18 token/sn. İlk üretim soğuk başlangıçta ~1–4 token/sn.

Robolectric ilk çalıştırmada ~200 MB'lık `android-all-instrumented` jar'ını indirir; takılırsa jar'ı Maven Central'dan `~/.m2/repository/org/robolectric/android-all-instrumented/<sürüm>/` altına koymak yeterli.
