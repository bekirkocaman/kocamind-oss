package com.tyler.kocamind.ui.theme

import android.graphics.drawable.ColorDrawable
import androidx.activity.ComponentActivity
import androidx.activity.compose.LocalActivity
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import com.tyler.kocamind.ui.components.LocalAppReduceMotion
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import com.tyler.kocamind.data.settings.AppPrefs
import kotlinx.coroutines.flow.MutableStateFlow
import androidx.compose.ui.graphics.toArgb

private fun KmPalette.scheme(dark: Boolean): ColorScheme {
    val base = if (dark) darkColorScheme() else lightColorScheme()
    return base.copy(
        primary = brand,
        onPrimary = textOnBrand,
        background = bg,
        onBackground = text,
        surface = surface,
        onSurface = text,
        surfaceVariant = surfaceElevated,
        onSurfaceVariant = textMuted,
        outline = borderStrong,
        outlineVariant = border,
        error = danger,
    )
}

private val KmTypography = Typography(
    displaySmall = KmType.display,
    titleLarge = KmType.title,
    titleMedium = KmType.headline,
    bodyLarge = KmType.body,
    bodyMedium = KmType.callout,
    labelLarge = KmType.subhead,
    bodySmall = KmType.footnote,
    labelMedium = KmType.caption,
    labelSmall = KmType.overline,
)

/** Açık ya da koyu KocaMind teması; varsayılan sistemi izler. */
@Composable
fun KocaMindTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val palette = if (dark) DarkPalette else LightPalette
    CompositionLocalProvider(LocalKmPalette provides palette) {
        MaterialTheme(colorScheme = palette.scheme(dark), typography = KmTypography, content = content)
    }
}

/**
 * Kayıtlı tema tercihini dinler ve uygular. Sistem modunda telefonun teması değişince
 * anında geçer; durum ve gezinme çubuğu simgelerini temaya göre koyu ya da açık yapar.
 */
@Composable
fun ThemeHost(prefs: ThemePrefs, appPrefs: AppPrefs? = null, content: @Composable () -> Unit) {
    val mode by prefs.mode.collectAsState()
    val dark = resolveDark(mode, isSystemInDarkTheme())
    val activity = LocalActivity.current as? ComponentActivity
    LaunchedEffect(activity, dark) { activity?.applyWindowTheme(dark) }
    val reduceMotion by prefs.reduceMotion.collectAsState()
    val replySans by (appPrefs?.replySans ?: remember { MutableStateFlow(false) }).collectAsState()
    val haptics by (appPrefs?.haptics ?: remember { MutableStateFlow(true) }).collectAsState()
    CompositionLocalProvider(
        LocalAppReduceMotion provides reduceMotion,
        LocalReplySans provides replySans,
        LocalHaptics provides haptics,
    ) {
        KocaMindTheme(dark = dark, content = content)
    }
}

/** Ayarlar > Yazı tipi stili: true ise yapay zekâ yanıtı serif yerine sade yazıyla. */
val LocalReplySans = staticCompositionLocalOf { false }

/** Ayarlar > Dokunsal geri bildirim. */
val LocalHaptics = staticCompositionLocalOf { true }

/** Pencere zeminini ve sistem çubuğu simge rengini temaya göre ayarlar. */
fun ComponentActivity.applyWindowTheme(dark: Boolean) {
    val bg = (if (dark) DarkPalette else LightPalette).bg.toArgb()
    val style = if (dark) SystemBarStyle.dark(bg) else SystemBarStyle.light(bg, bg)
    enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
    window.setBackgroundDrawable(ColorDrawable(bg))
}
