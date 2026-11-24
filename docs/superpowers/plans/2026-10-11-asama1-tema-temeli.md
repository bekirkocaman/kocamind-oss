# Aşama 1: Tema temeli — uygulama planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uygulamaya açık / koyu / sistem tema, demodaki yeni renk paleti, Roboto Flex fontu ve canlı KocaMind işaretini her yerde kazandırmak; mevcut ekranlar kırılmadan.

**Architecture:** `KmColors` sabit nesnesi, adları korunarak `CompositionLocal` üzerinden tema duyarlı hale gelir (`@Composable` getter'lar). Tema tercihi `SharedPreferences` içinde `ThemePrefs` ile tutulur ve `StateFlow` olarak yayınlanır; `MainActivity` bunu dinleyip `KocaMindTheme`'e ve sistem çubuklarına uygular. Font gömülü değişken Roboto Flex.

**Tech Stack:** Kotlin, Jetpack Compose (BOM 2025.06.01), Material 3, JUnit4 + Robolectric (mevcut test düzeni).

**Spec:** `docs/superpowers/specs/2026-10-11-arayuz-yenileme-design.md` (Aşama 1)

## Global Constraints

- Vurgu rengi: açık `#2D4FD6`, koyu `#8EA4FF`. Eski bakır/kömür palet kaldırılır.
- Tema tercihi varsayılanı: Sistem. Anahtar: `theme_mode`, değerler `system` | `light` | `dark`, dosya `kocamind` SharedPreferences.
- Mevcut token adları (`KmColors.text`, `.brand`, `.surface` …) korunur; çağıranlar değiştirilmez, yalnız derleme hatası verenler düzeltilir.
- Azaltılmış hareket desteği korunur (`rememberReduceMotion`).
- minSdk 26. Kurulum `installDebug` / `adb install -r`; kaldırma yok.
- Metinler Türkçe.

## Review Focus

1. Uygulama açıkken sistem teması değişirse (Sistem modunda) ekran anında yeni temaya geçmeli; yeniden başlatma gerekmemeli. → Task 3 testi.
2. Açık temada durum çubuğu ve gezinme çubuğu simgeleri koyu olmalı, okunmalı. → Task 3 cihaz kontrolü.
3. Kayıtlı tercih bozuk ya da tanımsızsa (`"mavi"`, boş) Sistem kabul edilmeli, çökme olmamalı. → Task 1 testi.
4. Açık temada soluk metin (`textMuted`) yüzey üzerinde okunabilir kalmalı (≥ 4.5:1). → Task 2 kontrast testi.
5. Yazı boyutu %130'da başlık ve düğmeler kesilmemeli. → Task 6 cihaz kontrolü.

---

### Task 1: Tema tercihi

**Files:**
- Create: `app/src/main/java/com/tyler/kocamind/ui/theme/ThemePrefs.kt`
- Test: `app/src/test/java/com/tyler/kocamind/ui/theme/ThemePrefsTest.kt`

**Interfaces:**
- Produces: `enum class ThemeMode { System, Light, Dark }`; `fun ThemeMode.Companion.parse(raw: String?): ThemeMode`; `fun resolveDark(mode: ThemeMode, systemDark: Boolean): Boolean`; `class ThemePrefs(context: Context) { val mode: StateFlow<ThemeMode>; fun set(mode: ThemeMode) }`.

- [ ] **Step 1: Failing tests** — `parse_unknownOrNull_isSystem` (`parse(null)`, `parse("mavi")` → `System`; `parse("dark")` → `Dark`), `resolveDark_followsSystemOnlyInSystemMode` (System+true → true, System+false → false, Light+true → false, Dark+false → true), `prefs_persistAndEmit` (Robolectric context: `set(Dark)` → `mode.value == Dark`, yeni `ThemePrefs` örneği de `Dark` okur).
- [ ] **Step 2:** `./gradlew testDebugUnitTest --tests "*ThemePrefsTest"` → derleme hatası/FAIL.
- [ ] **Step 3:** Uygula. Saklanan değer `ThemeMode.name.lowercase()`.
- [ ] **Step 4:** Aynı komut → PASS.
- [ ] **Step 5:** Commit `Tema tercihi: sistem/açık/koyu`.

### Task 2: Paletler ve tema duyarlı KmColors

**Files:**
- Modify: `app/src/main/java/com/tyler/kocamind/ui/theme/Color.kt` (tamamı)
- Modify: `app/src/main/java/com/tyler/kocamind/ui/theme/Theme.kt`
- Modify: derleme hatası veren çağıranlar (çizim lambdaları içindeki `KmColors.x` kullanımları)
- Test: `app/src/test/java/com/tyler/kocamind/ui/theme/PaletteTest.kt`

**Interfaces:**
- Consumes: `resolveDark` (Task 1).
- Produces: `data class KmPalette(bg, surface, surfaceElevated, surfaceSunken, border, borderStrong, text, textSecondary, textMuted, textOnBrand, brand, brandPressed, brandSoft, brandMuted, success, successMuted, warning, warningMuted, danger, dangerMuted, info, infoMuted, overlay, pressed: Color)`; `val LightPalette: KmPalette`; `val DarkPalette: KmPalette`; `val LocalKmPalette: ProvidableCompositionLocal<KmPalette>` (varsayılan `DarkPalette`); `object KmColors` aynı adlarla `@Composable @ReadOnlyComposable get() = LocalKmPalette.current.x`; `@Composable fun KocaMindTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit)`.

Değerler (açık / koyu):

| token | açık | koyu |
|---|---|---|
| bg | `#FFFFFF` | `#0F1012` |
| surface | `#F4F5F7` | `#1A1C20` |
| surfaceElevated | `#EAECF0` | `#24272C` |
| surfaceSunken | `#EEF0F3` | `#0A0B0C` |
| border | `#E2E4E9` | `#2C2F35` |
| borderStrong | `#C9CCD3` | `#3A3E45` |
| text | `#0F1115` | `#ECEEF1` |
| textSecondary | `#4A4F5A` | `#B3B8C1` |
| textMuted | `#6B717D` | `#8A909B` |
| textOnBrand | `#FFFFFF` | `#0F1012` |
| brand | `#2D4FD6` | `#8EA4FF` |
| brandPressed | `#2443BD` | `#7C93F5` |
| brandSoft | `#4F6CE0` | `#A9BAFF` |
| brandMuted | `#E8EDFF` | `#1D2440` |
| success / Muted | `#1D8A57` / `#E3F4EC` | `#5CC493` / `#14291F` |
| warning / Muted | `#A8670F` / `#FBF0DE` | `#E2A64F` / `#2C2214` |
| danger / Muted | `#C93D3D` / `#FBE7E7` | `#F07A7A` / `#301818` |
| info / Muted | `#2F6FB0` / `#E4EEF8` | `#7AA2D6` / `#172433` |
| overlay | `#0C0E12` %42 | `#000000` %60 |
| pressed | `#0F1115` %6 | `#FFFFFF` %6 |

- [ ] **Step 1: Failing test** `PaletteTest` — WCAG kontrast oranı yardımcı fonksiyonuyla (göreli parlaklık, test dosyasında): her iki palette `text/bg ≥ 7.0`, `textSecondary/surface ≥ 4.5`, `textMuted/bg ≥ 4.5`, `textOnBrand/brand ≥ 4.5`.
- [ ] **Step 2:** `--tests "*PaletteTest"` → FAIL (palet yok).
- [ ] **Step 3:** `Color.kt` paletleri ve `KmColors` getter'ları; `Dimens.kt` içinde demodaki köşeler: `KmRadius.lg = 20.dp`, `KmRadius.xl = 28.dp` (diğerleri aynı); `Theme.kt` içinde `KocaMindTheme(dark)` `LocalKmPalette` sağlar ve `lightColorScheme`/`darkColorScheme`'i paletten kurar.
- [ ] **Step 4:** `./gradlew compileDebugKotlin` → `@Composable` bağlam hatası veren her kullanımda rengi composable kapsamda bir `val`'a al (ör. `val line = KmColors.border` sonra lambda içinde `line`). Hata kalmayana kadar.
- [ ] **Step 5:** `./gradlew testDebugUnitTest` → tüm testler PASS.
- [ ] **Step 6:** Commit `Yeni palet: tema duyarlı KmColors`.

### Task 3: Temayı uygulamaya bağla

**Files:**
- Modify: `app/src/main/java/com/tyler/kocamind/MainActivity.kt`
- Modify: uygulama kapsayıcısı (`ThemePrefs` örneğinin tutulduğu yer; mevcut `container`/`AppContainer` desenine uy)
- Test: `app/src/test/java/com/tyler/kocamind/ui/theme/ThemeHostTest.kt` (Robolectric + `createComposeRule`)

**Interfaces:**
- Consumes: `ThemePrefs.mode`, `resolveDark`, `KocaMindTheme(dark)`.
- Produces: `@Composable fun ThemeHost(prefs: ThemePrefs, content: @Composable () -> Unit)` — modu toplar, `isSystemInDarkTheme()` ile çözer, `KocaMindTheme`'i ve sistem çubuğu stilini uygular.

- [ ] **Step 1: Failing test** `themeHost_switchesPaletteWhenPrefChanges` — `ThemeHost` içinde `LocalKmPalette.current.bg` okunur; `prefs.set(Light)` → `#FFFFFF`, `prefs.set(Dark)` → `#0F1012`.
- [ ] **Step 2:** Çalıştır → FAIL.
- [ ] **Step 3:** `ThemeHost` uygula; sistem çubukları `enableEdgeToEdge(SystemBarStyle.auto(...))` değil, çözülen moda göre `SystemBarStyle.light(bg, bg)` / `SystemBarStyle.dark(bg)` ile `LaunchedEffect(dark)` içinde güncellenir. `MainActivity` `KocaMindTheme { … }` yerine `ThemeHost(prefs) { … }` kullanır.
- [ ] **Step 4:** Test PASS; `./gradlew testDebugUnitTest` PASS.
- [ ] **Step 5:** Commit `Tema tercihini uygulamaya bağla`.

### Task 4: Ayarlar'da tema seçimi

**Files:**
- Modify: `app/src/main/java/com/tyler/kocamind/ui/settings/SettingsScreen.kt` (en üst gruba "Tema" satırı)
- Test: `app/src/test/java/com/tyler/kocamind/ui/settings/ThemeRowTest.kt`

**Interfaces:**
- Consumes: `ThemePrefs` (Task 1).
- Produces: `@Composable fun ThemeSelector(mode: ThemeMode, onSelect: (ThemeMode) -> Unit)` — üç parçalı seçici: "Sistem", "Açık", "Koyu"; seçili parça `selected` semantiğiyle.

- [ ] **Step 1: Failing test** — "Koyu" düğmesine tıklama `onSelect(Dark)` çağırır; seçili parçada `SemanticsProperties.Selected == true`.
- [ ] **Step 2–4:** FAIL → uygula (48dp yükseklik, `KmColors.surfaceElevated` zemin, seçili parça `KmColors.bg`) → PASS.
- [ ] **Step 5:** Commit `Ayarlar: tema seçimi`.

### Task 5: Roboto Flex ve tipografi

**Files:**
- Create: `app/src/main/res/font/roboto_flex.ttf` (Google Fonts `RobotoFlex[GRAD,XOPQ,XTRA,YOPQ,YTAS,YTDE,YTFI,YTLC,YTUC,opsz,slnt,wdth,wght].ttf`, SIL OFL; kaynak `github.com/google/fonts/tree/main/ofl/robotoflex`) ve `app/src/main/res/font/OFL-RobotoFlex.txt`
- Modify: `app/src/main/java/com/tyler/kocamind/ui/theme/Type.kt`, `Theme.kt`

**Interfaces:**
- Produces: `val KmFont: FontFamily` (400, 500, 600, 650→`FontWeight(650)`, 700 ağırlıkları `FontVariation.weight(...)` ile aynı dosyadan); tüm `KmType` stilleri `fontFamily = KmFont`; `KocaMindTheme` Material `Typography`'yi `KmType`'tan kurar (`displaySmall=display`, `titleLarge=title`, `titleMedium=headline`, `bodyLarge=body`, `bodyMedium=callout`, `labelLarge=subhead`, `bodySmall=footnote`, `labelMedium=caption`, `labelSmall=overline`).

- [ ] **Step 1:** Font dosyasını ve lisansını ekle (indirme kullanıcı onayıyla).
- [ ] **Step 2:** `Type.kt` / `Theme.kt` güncelle; `./gradlew assembleDebug` → BUILD SUCCESSFUL.
- [ ] **Step 3:** Commit `Roboto Flex tipografi`.

### Task 6: Canlı işaret her yerde, cihazda doğrulama

**Files:**
- Modify: `KMonogram(` kullanan 5 yer (`grep -rn "KMonogram(" app/src/main`) → `KmMark(MarkState.Idle, size = …)`; boşta kalırsa `KMonogram` tanımını `ui/components/Kit.kt`'tan sil.
- Modify: `app/src/main/java/com/tyler/kocamind/ui/components/KmMark.kt` — varsayılan `accent = KmColors.brand`, `ink = KmColors.text` (zaten öyle; yeni paletle otomatik).

- [ ] **Step 1:** Değiştir; `./gradlew testDebugUnitTest assembleDebug` → PASS.
- [ ] **Step 2:** `adb install -r app/build/outputs/apk/debug/app-debug.apk` → `Success`.
- [ ] **Step 3: Cihaz kontrolü** (ekran görüntüleriyle): Ayarlar'dan Açık → sohbet, yan menü, ayarlar okunur, çubuk simgeleri koyu; Koyu → aynı; Sistem → `adb shell cmd uimode night yes/no` ile canlı geçiş; `adb shell settings put system font_scale 1.3` → kesilme yok, sonra `1.0`.
- [ ] **Step 4:** Commit `Canlı işaret her yerde; Aşama 1 tamam`.
