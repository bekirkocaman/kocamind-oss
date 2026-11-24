package com.tyler.kocamind.ui.settings

import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.tyler.kocamind.ui.theme.KocaMindTheme
import com.tyler.kocamind.ui.theme.ThemeMode
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ThemeRowTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun selector_marksCurrent_andReportsChoice() {
        var picked: ThemeMode? = null
        composeRule.setContent { KocaMindTheme { ThemeSelector(mode = ThemeMode.System, onSelect = { picked = it }) } }
        composeRule.onNodeWithText("Sistem").assertIsSelected()
        composeRule.onNodeWithText("Koyu").assertIsNotSelected()
        composeRule.onNodeWithText("Koyu").performClick()
        assertEquals(ThemeMode.Dark, picked)
    }
}
