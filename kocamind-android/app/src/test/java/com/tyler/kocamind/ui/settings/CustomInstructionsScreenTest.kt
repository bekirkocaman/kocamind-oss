package com.tyler.kocamind.ui.settings

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.tyler.kocamind.ui.theme.KocaMindTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CustomInstructionsScreenTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun back_withUnsavedText_asksFirst() {
        var backs = 0
        var saved: String? = null
        composeRule.setContent { KocaMindTheme { CustomInstructionsScreen("", onSave = { saved = it }, onBack = { backs++ }) } }
        composeRule.onNodeWithContentDescription("Talimatlar").performTextInput("Kısa yaz")
        composeRule.onNodeWithText("8 / 600").assertExists()
        composeRule.runOnUiThread { composeRule.activity.onBackPressedDispatcher.onBackPressed() }
        composeRule.onNodeWithText("Değişiklikler kaydedilmedi").assertExists()
        assertEquals(0, backs)
        composeRule.onNodeWithText("Kaydetmeden çık").performClick()
        assertEquals(1, backs)
        assertEquals(null, saved)
    }

    @Test
    fun back_withoutChanges_leavesDirectly() {
        var backs = 0
        composeRule.setContent { KocaMindTheme { CustomInstructionsScreen("eski", onSave = {}, onBack = { backs++ }) } }
        composeRule.onNodeWithContentDescription("Geri dön").performClick()
        assertEquals(1, backs)
    }
}
