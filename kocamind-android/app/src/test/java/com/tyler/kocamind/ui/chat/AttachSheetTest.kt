package com.tyler.kocamind.ui.chat

import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.isToggleable
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.tyler.kocamind.ui.theme.KocaMindTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

@RunWith(AndroidJUnit4::class)
@Config(qualifiers = "w384dp-h832dp-xxhdpi")
class AttachSheetTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun showsTiles_andDeepThinkSwitch_only() {
        val events = mutableListOf<String>()
        composeRule.setContent {
            KocaMindTheme {
                AttachSheet(
                    visible = true,
                    onClose = { events += "close" },
                    onImage = { events += "image" },
                    onCamera = { events += "camera" },
                    onDocument = { events += "document" },
                    deepThink = false,
                    onDeepThinkChange = { events += "think:$it" },
                )
            }
        }
        composeRule.onNodeWithText("Sohbete ekle").assertExists()
        composeRule.onNodeWithText("Kamera").assertExists()
        composeRule.onNodeWithText("Fotoğraflar").assertExists()
        composeRule.onNodeWithText("Dosyalar").performClick()
        composeRule.onNodeWithText("Model").assertDoesNotExist()
        composeRule.onNodeWithText("Hafıza").assertDoesNotExist()
        composeRule.onNodeWithText("Derin düşünce").assertExists()
        composeRule.onNode(isToggleable()).assertIsOff().performClick()
        composeRule.onNodeWithContentDescription("Kapat").performClick()
        composeRule.runOnIdle {
            assertEquals(listOf("close", "document", "think:true", "close"), events)
        }
    }
}
