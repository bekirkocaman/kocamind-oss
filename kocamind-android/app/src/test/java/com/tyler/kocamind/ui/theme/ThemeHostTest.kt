package com.tyler.kocamind.ui.theme

import android.content.Context
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ThemeHostTest {
    @get:Rule
    val composeRule = createComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun themeHost_switchesPaletteWhenPrefChanges() {
        val prefs = ThemePrefs(context)
        prefs.set(ThemeMode.Light)
        var bg = Color.Unspecified
        composeRule.setContent { ThemeHost(prefs) { bg = LocalKmPalette.current.bg } }
        composeRule.runOnIdle { assertEquals(Color(0xFFF9F9F7), bg) }
        composeRule.runOnIdle { prefs.set(ThemeMode.Dark) }
        composeRule.runOnIdle { assertEquals(Color(0xFF151515), bg) }
    }
}
