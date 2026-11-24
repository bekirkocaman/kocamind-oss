package com.tyler.kocamind.ui.theme

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ThemePrefsTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun parse_unknownOrNull_isSystem() {
        assertEquals(ThemeMode.System, ThemeMode.parse(null))
        assertEquals(ThemeMode.System, ThemeMode.parse("mavi"))
        assertEquals(ThemeMode.System, ThemeMode.parse(""))
        assertEquals(ThemeMode.Dark, ThemeMode.parse("dark"))
        assertEquals(ThemeMode.Light, ThemeMode.parse("light"))
    }

    @Test
    fun resolveDark_followsSystemOnlyInSystemMode() {
        assertTrue(resolveDark(ThemeMode.System, systemDark = true))
        assertFalse(resolveDark(ThemeMode.System, systemDark = false))
        assertFalse(resolveDark(ThemeMode.Light, systemDark = true))
        assertTrue(resolveDark(ThemeMode.Dark, systemDark = false))
    }

    @Test
    fun prefs_persistAndEmit() {
        val prefs = ThemePrefs(context)
        assertEquals(ThemeMode.System, prefs.mode.value)
        prefs.set(ThemeMode.Dark)
        assertEquals(ThemeMode.Dark, prefs.mode.value)
        assertEquals(ThemeMode.Dark, ThemePrefs(context).mode.value)
    }

    @Test
    fun reduceMotion_defaultsOff_andPersists() {
        val prefs = ThemePrefs(context)
        assertFalse(prefs.reduceMotion.value)
        prefs.setReduceMotion(true)
        assertTrue(prefs.reduceMotion.value)
        assertTrue(ThemePrefs(context).reduceMotion.value)
    }
}
