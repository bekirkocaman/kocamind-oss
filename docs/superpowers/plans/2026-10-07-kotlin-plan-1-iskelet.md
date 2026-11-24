# Kotlin Plan 1: İskelet, Giriş ve Backend İstemcisi — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drawer menülü, e-posta ve Google ile giriş yapılabilen, giriş sonrası backend'den `/models` listesini çekip gösteren native Kotlin Android uygulaması.

**Architecture:** Repo kökünde tek modüllü `kocamind-android/` Gradle projesi. UI tarafında Jetpack Compose ve Navigation Compose, durum yönetimi için ViewModel ve StateFlow kullanılıyor. Firebase ve HTTP erişimi arayüzlerin arkasında, böylece ViewModel'ler sahte (fake) implementasyonlarla test edilebiliyor. DI kütüphanesi yok, `AppContainer` içinde elle bağlama yapılıyor (YAGNI).

**Tech Stack:** Kotlin 2.x, Jetpack Compose (Material 3), Navigation Compose, Firebase Android BoM (Auth, Firestore), Credential Manager + `googleid`, OkHttp, kotlinx.serialization, JUnit4, MockWebServer, kotlinx-coroutines-test, Compose UI test.

**Spec:** `docs/superpowers/plans/2026-10-07-kotlin-gecis-yol-haritasi.md` ve davranış kaynağı olarak `kocamind-mobil/src`.

## Global Constraints

- Proje yolu: `kocamind-android/`. Paket: `com.tyler.kocamind`. Debug sürümünde `applicationIdSuffix ".dev"` olacak ki eski Expo uygulamasının yanında kurulabilsin.
- `minSdk 26`, `targetSdk` ve `compileSdk` Android Studio'nun güncel kararlı değerleri. Bağımlılık sürümleri `gradle/libs.versions.toml` dosyasında tutulacak.
- Gradle, Android Studio JBR ile çalıştırılacak: `JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"`. SDK yolu: `C:\Users\tyler\AppData\Local\Android\Sdk`.
- Sadece koyu tema. Renkler `kocamind-mobil/src/constants/theme.ts` dosyasındaki değerlerle birebir aynı olacak (`bg #20201E`, `surface #292825`, `brand #DC8260`, `text #EEEAE3`, `textMuted #918A81`, `danger #E5675A` ve diğerleri).
- Kullanıcıya görünen bütün metinler Türkçe olacak ve mevcut uygulamadaki metinler aynen kullanılacak.
- `BACKEND_URL` varsayılanı `https://zeka-puce.vercel.app`. `BuildConfig.BACKEND_URL` olarak tanımlanacak ve `local.properties` içindeki `backendUrl` ile ezilebilecek.
- `google-services.json` dosyası `kocamind-mobil/android/app/google-services.json` konumundan kopyalanacak. Bu dosyada `com.tyler.kocamind.dev` için de bir client bulunmalı (bkz. Task 3).
- Firestore yolları `users/{uid}/...` şeklinde olacak. `deviceId` hiçbir yerde belge yolu olarak kullanılmayacak.
- **Cihazsız çalışma (bulut ve CI):** Compose UI testleri `src/test` altında **Robolectric** ile çalışacak (`@RunWith(AndroidJUnit4::class)`, `createComposeRule()`, `testOptions.unitTests.isIncludeAndroidResources = true`). Bu sayede `connectedAndroidTest` yerine `./gradlew testDebugUnitTest` yeterli olur. Cihaz gerektiren adımlar (Task 5 Step 5, Task 7 Step 3) **"CİHAZDA DOĞRULANACAK"** etiketiyle README'ye yazılacak ve atlanacak, başarılı sayılmayacak.
- **`google-services.json` git'e girmez.** `com.google.gms.google-services` eklentisi sadece `app/google-services.json` dosyası varsa uygulanacak. Dosya yoksa derleme yine geçmeli. Bu durumda `FirebaseAuthRepository` derlenir ama çalışma anında Firebase başlatılamaz, ve uygulama bunu çökmeden "Firebase yapılandırması eksik" mesajıyla gösterir.

## Review Focus

1. **E-postası doğrulanmamış kullanıcı:** Giriş reddedilmeli ve oturum kapatılmalı. "Tekrar Gönder" seçeneği sunulmalı. Test: Task 4 `unverifiedEmail_signsOutAndReturnsNeedsVerification`.
2. **Google giriş penceresini iptal etme:** Hata mesajı gösterilmemeli, ekran sessizce eski haline dönmeli. Test: Task 5 `cancelled_isSilent`.
3. **Backend hata gövdesi `{error:{message}}`, `{error:"..."}` ya da JSON değil:** Her durumda okunabilir bir Türkçe mesaj gösterilmeli. Test: Task 6 `errorMessage_*`.
4. **Giriş yapmadan backend çağrısı:** Ağ isteği hiç atılmamalı, "Devam etmek için hesabına giriş yapman gerekiyor." hatası dönmeli. Test: Task 6 `noUser_throwsWithoutRequest`.
5. **E-posta başında veya sonunda boşluk:** Firebase'e kırpılmış hali gönderilmeli. Test: Task 4 `email_isTrimmed`.

---

### Task 1: Proje iskeleti ve tema

**Files:**
- Create: `kocamind-android/settings.gradle.kts`, `build.gradle.kts`, `gradle/libs.versions.toml`, `gradle.properties`, Gradle wrapper
- Create: `kocamind-android/app/build.gradle.kts`, `app/src/main/AndroidManifest.xml`
- Create: `app/src/main/java/com/tyler/kocamind/MainActivity.kt`
- Create: `app/src/main/java/com/tyler/kocamind/ui/theme/{Color.kt,Theme.kt,Dimens.kt}`
- Copy: uygulama ikonları `kocamind-mobil/android/app/src/main/res/mipmap-*` → `app/src/main/res/`
- Modify: kök `.gitignore` (`kocamind-android/local.properties`, `build/`, `.gradle/`)
- Test: `app/src/test/java/com/tyler/kocamind/MainActivityTest.kt`

**Interfaces:**
- Produces: `@Composable fun KocaMindTheme(content: @Composable () -> Unit)`, `object KmColors` (theme.ts içindeki her renk için bir `Color` alanı), `object KmRadius { sm=8.dp, md=12.dp, lg=16.dp, xl=24.dp }`

- [ ] **Step 1:** Android Studio'da "Empty Activity (Compose)" şablonuyla `kocamind-android/` projesini oluştur. Namespace ve applicationId `com.tyler.kocamind`, debug için `applicationIdSuffix = ".dev"`, `minSdk = 26`. Uygulama adı `KocaMind`, debug sürümünde `KocaMind Dev`.
- [ ] **Step 2:** Başarısız olacak UI testini yaz: `appLaunches_showsKocaMind` → `composeRule.onNodeWithText("KocaMind").assertIsDisplayed()`.
- [ ] **Step 3:** `KmColors`, `KmRadius` ve `KocaMindTheme` dosyalarını yaz. Material 3 `darkColorScheme` içinde `background=bg`, `surface=surface`, `primary=brand`, `onBackground=text`, `error=danger` olacak. Status bar ve navigation bar rengi `bg`. `MainActivity` içinde `enableEdgeToEdge()` çağrılacak ve ekranda geçici olarak ortalanmış "KocaMind" yazısı gösterilecek.
- [ ] **Step 4:** Çalıştır: `cd kocamind-android && ./gradlew assembleDebug testDebugUnitTest` (Robolectric). Beklenen: `BUILD SUCCESSFUL` ve 1 test geçmiş.
- [ ] **Step 5:** Commit: `git add kocamind-android .gitignore && git commit -m "Kotlin Android iskeletini ve temayı ekle"`

### Task 2: Drawer ve navigasyon kabuğu

**Files:**
- Create: `app/src/main/java/com/tyler/kocamind/ui/nav/{Routes.kt,KocaMindNavHost.kt,AppDrawer.kt}`
- Create: `app/src/main/java/com/tyler/kocamind/ui/screens/PlaceholderScreen.kt`
- Modify: `MainActivity.kt`
- Test: `app/src/test/java/com/tyler/kocamind/NavigationTest.kt`

**Interfaces:**
- Produces: `enum class Route(val path: String, val title: String, val inDrawer: Boolean)` değerleri `Chat("chat","Sohbet",true)`, `Library("library","Kitaplık",true)`, `Settings("settings","Ayarlar",true)`, `OfflineModels("offline-models","Çevrimdışı AI Modelleri",false)`, `Auth("auth","Giriş Yap",true)`, `Admin("admin","Admin Paneli",true)`, `AdminUser("admin-user/{uid}","Kullanıcı Düzenle",false)`. Ayrıca `@Composable fun KocaMindNavHost(navController: NavHostController)`.

- [ ] **Step 1:** Başarısız olacak testi yaz: `drawer_navigatesToSettings` → drawer'ı aç, "Ayarlar"a tıkla, `onNodeWithTag("screen-settings").assertIsDisplayed()`. İkinci test `drawer_hidesNonDrawerRoutes` → drawer içinde "Çevrimdışı AI Modelleri" metni bulunmamalı.
- [ ] **Step 2:** Testi çalıştır ve başarısız olduğunu gör.
- [ ] **Step 3:** `ModalNavigationDrawer` içinde `AppDrawer` yaz. Drawer genişliği `min(ekran genişliği * 0.88, 360.dp)` olacak. `NavHost` her route için `PlaceholderScreen(route)` göstersin ve testTag olarak `"screen-${route.path.substringBefore('/')}"` kullansın. Başlangıç ekranı `Chat`.
- [ ] **Step 4:** Çalıştır: `./gradlew testDebugUnitTest`. Beklenen: 3 test geçmiş.
- [ ] **Step 5:** Commit: `"Drawer ve navigasyon kabuğunu ekle"`

### Task 3: Firebase kurulumu ve AuthRepository

**Files:**
- Create: `app/google-services.json` (kopya), `app/src/main/java/com/tyler/kocamind/data/auth/{AuthRepository.kt,FirebaseAuthRepository.kt,AuthUser.kt}`
- Create: `app/src/main/java/com/tyler/kocamind/AppContainer.kt`, `KocaMindApp.kt` (`Application`)
- Create: `app/src/test/java/com/tyler/kocamind/data/auth/FakeAuthRepository.kt`
- Modify: `app/build.gradle.kts` (google-services eklentisi, Firebase BoM, `firebase-auth`, `firebase-firestore`)

**Interfaces:**
- Produces:
  ```kotlin
  data class AuthUser(val uid: String, val email: String?, val displayName: String?, val emailVerified: Boolean)
  interface AuthRepository {
      val currentUser: StateFlow<AuthUser?>
      suspend fun signInWithEmail(email: String, password: String): AuthUser
      suspend fun createAccount(email: String, password: String, displayName: String): AuthUser
      suspend fun sendEmailVerification()
      suspend fun sendPasswordReset(email: String)
      suspend fun signInWithGoogleIdToken(idToken: String): AuthUser
      suspend fun idToken(): String?   // giriş yoksa null
      fun signOut()
  }
  class AuthException(val code: String, message: String?) : Exception(message)
  ```
  Firebase hataları `AuthException` tipine çevrilir. `code` alanı JS SDK ile aynı string olmalı (`auth/invalid-credential`, `auth/email-already-in-use`, `auth/user-not-found`, `auth/weak-password`, `auth/invalid-email`, `auth/operation-not-allowed`), böylece Task 4'teki eşleme tablosu iki tarafta da aynı kalır.

- [ ] **Step 1:** Firebase Console'da `kocamind` projesine `com.tyler.kocamind.dev` Android uygulamasını ekle. Debug keystore'un SHA-1 değerini ekle (`./gradlew signingReport`). Güncel `google-services.json` dosyasını indir. **Bu adımı kullanıcı yapar**, çünkü Firebase Console'a giriş gerekiyor.
- [ ] **Step 2:** `FirebaseAuthRepository` yaz. `FirebaseAuthException.errorCode` değerlerini `auth/kebab-case` biçimine çevir: `ERROR_INVALID_CREDENTIAL` → `auth/invalid-credential`. `createAccount` sonrasında `updateProfile(displayName)` çağır ve `users/{uid}` belgesine `{uid, email, name, createdAt}` alanlarını `merge` ile yaz. `billing` alanı yazılmayacak.
- [ ] **Step 3:** `AppContainer` içinde `authRepository` alanını tanımla ve `KocaMindApp.onCreate` içinde oluştur.
- [ ] **Step 4:** Çalıştır: `./gradlew assembleDebug`. Beklenen: `BUILD SUCCESSFUL` ve google-services görevinin hatasız geçmesi.
- [ ] **Step 5:** Commit: `"Firebase Auth deposunu ekle"`

### Task 4: E-posta ile giriş, kayıt ve şifre sıfırlama ekranı

**Files:**
- Create: `app/src/main/java/com/tyler/kocamind/ui/auth/{AuthViewModel.kt,AuthScreen.kt,AuthMessages.kt}`
- Test: `app/src/test/java/com/tyler/kocamind/ui/auth/AuthViewModelTest.kt`

**Interfaces:**
- Consumes: `AuthRepository`, `AuthException` (Task 3)
- Produces:
  ```kotlin
  enum class AuthTab { Login, Register }
  sealed interface AuthEvent {
      data class Error(val title: String, val message: String) : AuthEvent
      data class NeedsVerification(val email: String) : AuthEvent
      data class VerificationSent(val email: String) : AuthEvent
      data object ResetSent : AuthEvent
      data object SignedIn : AuthEvent
  }
  class AuthViewModel(repo: AuthRepository) { fun submit(tab: AuthTab, name: String, email: String, password: String); fun resendVerification(email: String, password: String); fun resetPassword(email: String); val events: Flow<AuthEvent>; val isLoading: StateFlow<Boolean> }
  fun authErrorMessage(code: String): String
  ```

- [ ] **Step 1:** `AuthViewModelTest` içine başarısız olacak testleri yaz:
  - `emptyFields_emitsMissingInfo` → `Error("Eksik Bilgi", "Lütfen e-posta ve şifrenizi girin.")`
  - `registerWithoutName_emitsMissingName` → `Error("Eksik Bilgi", "Lütfen adınızı girin.")`
  - `invalidEmail_emitsInvalidEmail` → `Error("Geçersiz E-posta", "Lütfen geçerli bir e-posta adresi girin.\nÖrnek: isim@gmail.com")`
  - `email_isTrimmed` → fake repo'ya `"a@b.com"` ulaşır (giriş `"  a@b.com "`)
  - `unverifiedEmail_signsOutAndReturnsNeedsVerification` → `NeedsVerification`, ve `fake.signOutCalled == true`
  - `register_sendsVerificationAndSignsOut` → `VerificationSent`, `fake.verificationSent == true`, `fake.signOutCalled == true`
  - `errorCodes_mapToTurkish` → `authErrorMessage` için `auth/email-already-in-use` → "Bu e-posta zaten kullanımda.", `auth/invalid-credential` ve `auth/wrong-password` → "E-posta veya şifre hatalı.", `auth/weak-password` → "Şifre en az 6 karakter olmalı.", `auth/invalid-email` → "Geçersiz e-posta adresi.", `auth/operation-not-allowed` → "E-posta girişi henüz etkinleştirilmemiş.", `auth/user-not-found` → "Bu e-posta adresiyle kayıtlı bir kullanıcı bulunamadı."
  - `resetWithoutEmail_emitsMissingInfo` → "Lütfen şifresini sıfırlamak istediğiniz e-posta adresini yukarıdaki E-posta kutusuna girin."
- [ ] **Step 2:** Çalıştır: `./gradlew testDebugUnitTest --tests "*AuthViewModelTest*"`. Beklenen: derleme hatası ya da FAIL.
- [ ] **Step 3:** `AuthViewModel` ve `authErrorMessage` yaz. Davranış `kocamind-mobil/src/app/auth.tsx:125-235` ile aynı olacak. E-posta doğrulaması için `android.util.Patterns` yerine saf Kotlin regex `^[^\s@]+@[^\s@]+\.[^\s@]+$` kullanılacak, böylece JVM unit testinde çalışır.
- [ ] **Step 4:** `AuthScreen` yaz: Giriş ve Kayıt sekmeleri, ad alanı (sadece kayıtta), e-posta, şifre, "Şifremi unuttum" bağlantısı. Olaylar `AlertDialog` ile gösterilecek. `NeedsVerification` dialoğunda "Tamam" ve "Tekrar Gönder" düğmeleri olacak. Başarılı girişte `Route.Chat` ekranına dönülecek.
- [ ] **Step 5:** Çalıştır: `./gradlew testDebugUnitTest`. Beklenen: bütün testler PASS.
- [ ] **Step 6:** Commit: `"E-posta giriş ve kayıt ekranını ekle"`

### Task 5: Google ile giriş

**Files:**
- Create: `app/src/main/java/com/tyler/kocamind/data/auth/GoogleSignInClient.kt`
- Modify: `AuthViewModel.kt`, `AuthScreen.kt`, `app/build.gradle.kts` (`androidx.credentials`, `credentials-play-services-auth`, `googleid`)
- Test: `AuthViewModelTest.kt` (ekleme)

**Interfaces:**
- Consumes: `AuthRepository.signInWithGoogleIdToken` (Task 3)
- Produces: `sealed interface GoogleResult { data class Token(val idToken: String); data object Cancelled; data class Failed(val message: String) }`, `interface GoogleSignInClient { suspend fun requestIdToken(activity: Activity): GoogleResult }`, `fun AuthViewModel.onGoogleResult(result: GoogleResult)`

- [ ] **Step 1:** Başarısız olacak testleri yaz:
  - `cancelled_isSilent` → `onGoogleResult(Cancelled)` hiçbir olay yaymaz ve `isLoading == false`
  - `failed_emitsGoogleError` → `Error("Google Giriş Hatası", message)`
  - `token_signsIn` → `SignedIn` ve fake repo'nun aldığı token `"tok"`
- [ ] **Step 2:** Testleri çalıştır ve başarısız olduklarını gör.
- [ ] **Step 3:** `CredentialManagerGoogleSignInClient` yaz. `GetGoogleIdOption` içinde `serverClientId` değeri `kocamind-mobil/src/app/auth.tsx:36` satırındaki web client ID, `filterByAuthorizedAccounts = false`. `GetCredentialCancellationException` → `Cancelled`. Diğer hatalar → `Failed("Google ile giriş tamamlanamadı. Lütfen tekrar dene.")`.
- [ ] **Step 4:** Çalıştır: `./gradlew testDebugUnitTest`. Beklenen: PASS.
- [ ] **Step 5:** Cihazda elle doğrula: SM-S711B üzerinde `./gradlew installDebug`, ardından "Google ile devam et". Beklenen: hesap seçici açılır, giriş yapılır ve Sohbet ekranına dönülür. Hesap seçici kapatılırsa hata gösterilmez.
- [ ] **Step 6:** Commit: `"Google ile girişi Credential Manager üzerinden ekle"`

### Task 6: Backend istemcisi ve model listesi

**Files:**
- Create: `app/src/main/java/com/tyler/kocamind/data/backend/{BackendClient.kt,RemoteModel.kt}`
- Create: `app/src/main/java/com/tyler/kocamind/ui/screens/ChatPlaceholderScreen.kt` (`Route.Chat` için)
- Modify: `AppContainer.kt`, `KocaMindNavHost.kt`, `app/build.gradle.kts` (OkHttp, kotlinx.serialization, `buildConfigField BACKEND_URL`)
- Test: `app/src/test/java/com/tyler/kocamind/data/backend/BackendClientTest.kt`

**Interfaces:**
- Consumes: `AuthRepository.idToken()` (Task 3)
- Produces:
  ```kotlin
  @Serializable data class RemoteModel(val id: String, val provider: String, val providerName: String, val label: String, val badge: String? = null, val available: Boolean, val isDefault: Boolean = false)
  class BackendException(message: String) : Exception(message)
  class BackendClient(baseUrl: String, http: OkHttpClient, tokenProvider: suspend () -> String?) {
      suspend fun getRemoteModels(): List<RemoteModel>
  }
  internal fun backendErrorMessage(body: String?, fallback: String): String
  ```

- [ ] **Step 1:** `MockWebServer` ile başarısız olacak testleri yaz:
  - `models_sendsBearerToken` → istekte `Authorization: Bearer tok` başlığı bulunur
  - `models_filtersUnavailable` → gövde `{"models":[{...available:true},{...available:false}]}` olduğunda sonuç 1 öğe
  - `models_acceptsBareArray` → gövde `[...]` olduğunda da çalışır
  - `noUser_throwsWithoutRequest` → token `null` iken `BackendException("Devam etmek için hesabına giriş yapman gerekiyor.")` fırlatılır ve `server.requestCount == 0`
  - `errorMessage_nestedObject` → `{"error":{"message":"X"}}` için `"X"`
  - `errorMessage_string` → `{"error":"Y"}` için `"Y"`
  - `errorMessage_nonJson` → `"<html>"` için `"Sunucu isteği tamamlanamadı."`
- [ ] **Step 2:** Çalıştır: `./gradlew testDebugUnitTest --tests "*BackendClientTest*"`. Beklenen: FAIL.
- [ ] **Step 3:** `BackendClient` yaz. Base URL'in sonundaki `/` karakterleri kırpılacak. JSON ayrıştırırken `ignoreUnknownKeys = true` kullanılacak. Ağ çağrısı `Dispatchers.IO` üzerinde yapılacak.
- [ ] **Step 4:** `ChatPlaceholderScreen` yaz: giriş yoksa "Giriş Yap" düğmesi gösterilir. Giriş varsa `getRemoteModels()` sonucu `label · providerName` biçiminde liste olarak gösterilir. Hata durumunda mesaj `KmColors.danger` renginde gösterilir.
- [ ] **Step 5:** Çalıştır: `./gradlew testDebugUnitTest`. Beklenen: PASS.
- [ ] **Step 6:** Commit: `"Backend istemcisini ve model listesini ekle"`

### Task 7: CI ve cihazda duman testi

**Files:**
- Create: `.github/workflows/android.yml`
- Create: `kocamind-android/README.md` (kurulum, JBR yolu, `google-services.json` notu, çalıştırma komutları)

- [ ] **Step 1:** Workflow yaz. Tetikleyiciler: `push` ve `pull_request`, yol filtresi `kocamind-android/**`. Adımlar: `actions/setup-java` (temurin 17), Gradle cache, `./gradlew testDebugUnitTest assembleDebug`. `google-services.json` dosyası `GOOGLE_SERVICES_JSON` secret'ından yazılacak. Secret yoksa adım atlanacak ve sadece unit testler çalışacak.
- [ ] **Step 2:** Yerelde doğrula: `./gradlew clean testDebugUnitTest assembleDebug`. Beklenen: `BUILD SUCCESSFUL`.
- [ ] **Step 3:** Cihazda duman testi: `./gradlew installDebug`. "KocaMind Dev" uygulaması eski "KocaMind" uygulamasının yanında kurulur, eski uygulama silinmez. Şu adımlar denenir: e-posta ile giriş, uygulamayı kapatıp açınca oturumun kalması, Google ile giriş, model listesinin görünmesi, drawer'daki 5 ekranın açılması. Sonuçlar README'ye "Plan 1 doğrulaması" başlığıyla yazılır.
- [ ] **Step 4:** Commit: `"Android CI ve README ekle"`
