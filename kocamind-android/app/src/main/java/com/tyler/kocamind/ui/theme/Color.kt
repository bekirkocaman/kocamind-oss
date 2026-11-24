package com.tyler.kocamind.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/** KocaMind renk paleti; açık ve koyu tema aynı adları taşır. */
data class KmPalette(
    val bg: Color,
    val surface: Color,
    val surfaceElevated: Color,
    val surfaceSunken: Color,
    val border: Color,
    val borderStrong: Color,
    val text: Color,
    val textSecondary: Color,
    val textMuted: Color,
    val textOnBrand: Color,
    val brand: Color,
    val brandPressed: Color,
    val brandSoft: Color,
    val brandMuted: Color,
    val success: Color,
    val successMuted: Color,
    val warning: Color,
    val warningMuted: Color,
    val danger: Color,
    val dangerMuted: Color,
    val info: Color,
    val infoMuted: Color,
    val overlay: Color,
    val pressed: Color,
)

// Klon tasarımı: Claude Android 1.261005.20 ekranlarından ölçülen sıcak griler ve turuncu vurgu
// (claude-mobil-klon/analiz/TASARIM.md). Kod ve fontlar kopyalanmadı; yalnız renk değerleri ölçüldü.
// Soluk metin ve marka üstü yazı, 4.5:1 okunabilirlik eşiği için ölçülen değerden biraz koyulaştırıldı.
val LightPalette = KmPalette(
    bg = Color(0xFFF9F9F7),
    surface = Color(0xFFFFFFFF),
    surfaceElevated = Color(0xFFE7E6E1),
    surfaceSunken = Color(0xFFF0EFEC),
    border = Color(0xFFE2E1DC),
    borderStrong = Color(0xFFCFCEC8),
    text = Color(0xFF131313),
    textSecondary = Color(0xFF5E5D59),
    textMuted = Color(0xFF666561),
    textOnBrand = Color(0xFFFFFFFF),
    brand = Color(0xFFB5532F),
    brandPressed = Color(0xFFA0482A),
    brandSoft = Color(0xFFC6613F),
    brandMuted = Color(0xFFF5E6DF),
    success = Color(0xFF3B7D4F),
    successMuted = Color(0xFFE4EFE6),
    warning = Color(0xFFA8670F),
    warningMuted = Color(0xFFF7EDDC),
    danger = Color(0xFFC2412D),
    dangerMuted = Color(0xFFF8E4DF),
    info = Color(0xFF2C6BD1),
    infoMuted = Color(0xFFE3EBF7),
    overlay = Color(0x8C000000),
    pressed = Color(0x0F131313),
)

val DarkPalette = KmPalette(
    bg = Color(0xFF151515),
    surface = Color(0xFF20201F),
    surfaceElevated = Color(0xFF2C2C2A),
    surfaceSunken = Color(0xFF111111),
    border = Color(0xFF2A2A29),
    borderStrong = Color(0xFF353533),
    text = Color(0xFFF9F9F7),
    textSecondary = Color(0xFFA6A5A0),
    textMuted = Color(0xFF95948F),
    textOnBrand = Color(0xFF1A1A19),
    brand = Color(0xFFD97757),
    brandPressed = Color(0xFFC6613F),
    brandSoft = Color(0xFFE08E72),
    brandMuted = Color(0xFF3A2620),
    success = Color(0xFF6DBA82),
    successMuted = Color(0xFF1B2A1F),
    warning = Color(0xFFE2A64F),
    warningMuted = Color(0xFF2E2416),
    danger = Color(0xFFE5675A),
    dangerMuted = Color(0xFF34201D),
    info = Color(0xFF6FA8F5),
    infoMuted = Color(0xFF1A2433),
    overlay = Color(0x8C000000),
    pressed = Color(0x0FFFFFFF),
)

val LocalKmPalette = staticCompositionLocalOf { DarkPalette }

/** Etkin temanın renkleri. Adlar eski sabit paletle aynı, değerler temaya göre değişir. */
object KmColors {
    val bg: Color @Composable @ReadOnlyComposable get() = LocalKmPalette.current.bg
    val surface: Color @Composable @ReadOnlyComposable get() = LocalKmPalette.current.surface
    val surfaceElevated: Color @Composable @ReadOnlyComposable get() = LocalKmPalette.current.surfaceElevated
    val surfaceSunken: Color @Composable @ReadOnlyComposable get() = LocalKmPalette.current.surfaceSunken
    val border: Color @Composable @ReadOnlyComposable get() = LocalKmPalette.current.border
    val borderStrong: Color @Composable @ReadOnlyComposable get() = LocalKmPalette.current.borderStrong
    val text: Color @Composable @ReadOnlyComposable get() = LocalKmPalette.current.text
    val textSecondary: Color @Composable @ReadOnlyComposable get() = LocalKmPalette.current.textSecondary
    val textMuted: Color @Composable @ReadOnlyComposable get() = LocalKmPalette.current.textMuted
    val textOnBrand: Color @Composable @ReadOnlyComposable get() = LocalKmPalette.current.textOnBrand
    val brand: Color @Composable @ReadOnlyComposable get() = LocalKmPalette.current.brand
    val brandPressed: Color @Composable @ReadOnlyComposable get() = LocalKmPalette.current.brandPressed
    val brandSoft: Color @Composable @ReadOnlyComposable get() = LocalKmPalette.current.brandSoft
    val brandMuted: Color @Composable @ReadOnlyComposable get() = LocalKmPalette.current.brandMuted
    val success: Color @Composable @ReadOnlyComposable get() = LocalKmPalette.current.success
    val successMuted: Color @Composable @ReadOnlyComposable get() = LocalKmPalette.current.successMuted
    val warning: Color @Composable @ReadOnlyComposable get() = LocalKmPalette.current.warning
    val warningMuted: Color @Composable @ReadOnlyComposable get() = LocalKmPalette.current.warningMuted
    val danger: Color @Composable @ReadOnlyComposable get() = LocalKmPalette.current.danger
    val dangerMuted: Color @Composable @ReadOnlyComposable get() = LocalKmPalette.current.dangerMuted
    val info: Color @Composable @ReadOnlyComposable get() = LocalKmPalette.current.info
    val infoMuted: Color @Composable @ReadOnlyComposable get() = LocalKmPalette.current.infoMuted
    val overlay: Color @Composable @ReadOnlyComposable get() = LocalKmPalette.current.overlay
    val pressed: Color @Composable @ReadOnlyComposable get() = LocalKmPalette.current.pressed
}
