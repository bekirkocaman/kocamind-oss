package com.tyler.kocamind.data.settings

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AppPrefsTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun defaults_serifHapticsOnTurkishNormal_noNotifyNoSecure() {
        val p = AppPrefs(context)
        assertFalse(p.replySans.value)
        assertTrue(p.haptics.value)
        assertEquals(VoiceLang.Turkish, p.voiceLang.value)
        assertEquals(0.9f, p.voiceRate.value)
        assertFalse(p.notifyReplies.value)
        assertFalse(p.blockScreenshots.value)
    }

    @Test
    fun changes_surviveNewInstance() {
        AppPrefs(context).apply {
            setReplySans(true)
            setHaptics(false)
            setVoiceLang(VoiceLang.English)
            setVoiceRate(1.3f)
            setNotifyReplies(true)
            setBlockScreenshots(true)
        }
        val p = AppPrefs(context)
        assertTrue(p.replySans.value)
        assertFalse(p.haptics.value)
        assertEquals(VoiceLang.English, p.voiceLang.value)
        assertEquals(1.3f, p.voiceRate.value)
        assertTrue(p.notifyReplies.value)
        assertTrue(p.blockScreenshots.value)
    }

    @Test
    fun unknownLanguage_fallsBackToTurkish() {
        assertEquals(VoiceLang.Turkish, VoiceLang.parse("xx-YY"))
        assertEquals(VoiceLang.Turkish, VoiceLang.parse(null))
    }
}
