package com.tyler.kocamind.ui.theme

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Görünüm tercihi. Varsayılan sistemi izlemektir. */
enum class ThemeMode {
    System, Light, Dark;

    companion object {
        /** Bilinmeyen ya da boş değer sistem sayılır. */
        fun parse(raw: String?): ThemeMode = entries.firstOrNull { it.name.equals(raw, ignoreCase = true) } ?: System
    }
}

/** Tercihe ve sistemin koyu modda olup olmadığına göre koyu tema kullanılır mı. */
fun resolveDark(mode: ThemeMode, systemDark: Boolean): Boolean = when (mode) {
    ThemeMode.System -> systemDark
    ThemeMode.Light -> false
    ThemeMode.Dark -> true
}

/** Tema tercihini `kocamind` SharedPreferences içinde `theme_mode` anahtarıyla saklar. */
class ThemePrefs(context: Context) {
    private val prefs = context.getSharedPreferences("kocamind", Context.MODE_PRIVATE)
    private val state = MutableStateFlow(ThemeMode.parse(prefs.getString(KEY, null)))
    val mode: StateFlow<ThemeMode> = state.asStateFlow()

    fun set(mode: ThemeMode) {
        prefs.edit().putString(KEY, mode.name.lowercase()).apply()
        state.value = mode
    }

    private val reduce = MutableStateFlow(prefs.getBoolean(REDUCE_KEY, false))

    /** Ayarlar > Azaltılmış hareket; sistem ayarına ek olarak animasyonları kısar. */
    val reduceMotion: StateFlow<Boolean> = reduce.asStateFlow()

    fun setReduceMotion(on: Boolean) {
        prefs.edit().putBoolean(REDUCE_KEY, on).apply()
        reduce.value = on
    }

    private companion object {
        const val KEY = "theme_mode"
        const val REDUCE_KEY = "reduce_motion"
    }
}
