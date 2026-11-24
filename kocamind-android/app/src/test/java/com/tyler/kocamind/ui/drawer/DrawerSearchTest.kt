package com.tyler.kocamind.ui.drawer

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.tyler.kocamind.data.chat.ChatSummary
import com.tyler.kocamind.ui.theme.KocaMindTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

@RunWith(AndroidJUnit4::class)
@Config(qualifiers = "w384dp-h832dp-xxhdpi")
class DrawerSearchTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun noMatches_saysSo_andClearBringsListBack() {
        val chats = listOf(ChatSummary("1", "merhaba", "2026-10-11"))
        composeRule.setContent {
            KocaMindTheme {
                AppDrawer(null, false, "free", chats, {}, {}, {}, {}, {}, {}, {}, {}, { _, _ -> }, {})
            }
        }
        composeRule.onNodeWithContentDescription("Ara").performClick()
        composeRule.onNodeWithContentDescription("Sohbetlerde ara").performTextInput("xyzq")
        composeRule.onNodeWithText("“xyzq” için sohbet bulunamadı").assertExists()
        composeRule.onNodeWithContentDescription("Aramayı temizle").performClick()
        composeRule.onNodeWithText("merhaba").assertExists()
    }
}
