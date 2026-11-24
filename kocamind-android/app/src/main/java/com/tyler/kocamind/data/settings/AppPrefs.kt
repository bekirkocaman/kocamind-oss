package com.tyler.kocamind.data.settings

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Ayarlar > Ses: sesli okumanın dili. */
enum class VoiceLang(val tag: String, val label: String) {
    Turkish("tr-TR", "Türkçe"),
    English("en-US", "İngilizce");

    companion object {
        fun parse(raw: String?): VoiceLang = entries.firstOrNull { it.tag == raw } ?: Turkish
    }
}

/** Ayarlar > Ses: sesli okuma hızı seçenekleri. */
val VOICE_RATES = listOf(0.75f to "Yavaş", 0.9f to "Normal", 1.1f to "Hızlı", 1.3f to "Çok hızlı")

/**
 * Klon ayarlarından gelen cihaz tercihleri: yazı tipi stili, dokunsal geri bildirim, ses,
 * bildirimler ve gizlilik. `kocamind` SharedPreferences içinde, tema tercihinin yanında durur.
 */
class AppPrefs(context: Context) {
    private val prefs = context.getSharedPreferences("kocamind", Context.MODE_PRIVATE)

    private fun bool(key: String, default: Boolean) = MutableStateFlow(prefs.getBoolean(key, default))

    private val _replySans = bool(REPLY_SANS, false)

    /** Yazı tipi stili: true ise yanıtlar serif yerine sade arayüz yazısıyla gösterilir. */
    val replySans: StateFlow<Boolean> = _replySans.asStateFlow()
    fun setReplySans(on: Boolean) = save(REPLY_SANS, on, _replySans)

    private val _haptics = bool(HAPTICS, true)

    /** Dokunsal geri bildirim: gönderme, kopyalama ve uzun basmada kısa titreşim. */
    val haptics: StateFlow<Boolean> = _haptics.asStateFlow()
    fun setHaptics(on: Boolean) = save(HAPTICS, on, _haptics)

    private val _voiceRate = MutableStateFlow(prefs.getFloat(VOICE_RATE, 0.9f))
    val voiceRate: StateFlow<Float> = _voiceRate.asStateFlow()
    fun setVoiceRate(rate: Float) {
        prefs.edit().putFloat(VOICE_RATE, rate).apply()
        _voiceRate.value = rate
    }

    private val _voiceLang = MutableStateFlow(VoiceLang.parse(prefs.getString(VOICE_LANG, null)))
    val voiceLang: StateFlow<VoiceLang> = _voiceLang.asStateFlow()
    fun setVoiceLang(lang: VoiceLang) {
        prefs.edit().putString(VOICE_LANG, lang.tag).apply()
        _voiceLang.value = lang
    }

    private val _notifyReplies = bool(NOTIFY_REPLIES, false)

    /** Bildirimler: uygulama arka plandayken yanıt bitince bildirim gösterilir. */
    val notifyReplies: StateFlow<Boolean> = _notifyReplies.asStateFlow()
    fun setNotifyReplies(on: Boolean) = save(NOTIFY_REPLIES, on, _notifyReplies)

    private val _blockScreenshots = bool(BLOCK_SCREENSHOTS, false)

    /** Gizlilik: ekran görüntüsünü ve son uygulamalar önizlemesini engeller (FLAG_SECURE). */
    val blockScreenshots: StateFlow<Boolean> = _blockScreenshots.asStateFlow()
    fun setBlockScreenshots(on: Boolean) = save(BLOCK_SCREENSHOTS, on, _blockScreenshots)

    private fun save(key: String, on: Boolean, state: MutableStateFlow<Boolean>) {
        prefs.edit().putBoolean(key, on).apply()
        state.value = on
    }

    private companion object {
        const val REPLY_SANS = "reply_sans"
        const val HAPTICS = "haptics"
        const val VOICE_RATE = "voice_rate"
        const val VOICE_LANG = "voice_lang"
        const val NOTIFY_REPLIES = "notify_replies"
        const val BLOCK_SCREENSHOTS = "block_screenshots"
    }
}
