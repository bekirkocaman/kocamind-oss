package com.tyler.kocamind.ui.chat

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertEquals
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.tyler.kocamind.data.chat.ChatMessage
import com.tyler.kocamind.ui.theme.KocaMindTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MessageListTest {
    @get:Rule
    val composeRule = createComposeRule()

    private val actions = MessageActions({}, {}, {}, {}, {}, { _, _ -> })

    private fun messages(count: Int) = (1..count).map { ChatMessage(id = "m$it", role = "user", content = "mesaj $it") }

    @Test
    fun newMessages_followToBottom() {
        var state by mutableStateOf(ChatUiState(messages = messages(2)))
        composeRule.setContent { KocaMindTheme { MessageList(state, mutableSetOf(), actions) } }
        composeRule.waitForIdle()
        state = state.copy(messages = messages(40))
        composeRule.waitForIdle()
        composeRule.onNodeWithText("mesaj 40").assertIsDisplayed()
    }

    @Test
    fun streamingText_keepsFollowing() {
        var state by mutableStateOf(ChatUiState(messages = messages(40)))
        composeRule.setContent { KocaMindTheme { MessageList(state, mutableSetOf(), actions) } }
        composeRule.waitForIdle()
        for (i in 1..3) {
            state = state.copy(messages = state.messages + ChatMessage(id = "s$i", role = "user", content = "akış $i"))
            composeRule.waitForIdle()
        }
        composeRule.onNodeWithText("akış 3").assertIsDisplayed()
    }

    @Test
    fun errorReply_showsRetryCard_withoutFeedbackActions() {
        var retried: ChatMessage? = null
        val withRetry = MessageActions({}, {}, {}, {}, { retried = it }, { _, _ -> })
        val error = ChatMessage(id = "e1", role = "model", content = "Yapay zekâ servisine şu anda ulaşılamıyor.", isError = true)
        composeRule.setContent { KocaMindTheme { MessageList(ChatUiState(messages = listOf(error)), mutableSetOf(), withRetry) } }
        composeRule.onNodeWithText("Yapay zekâ servisine şu anda ulaşılamıyor.").assertIsDisplayed()
        composeRule.onAllNodesWithContentDescription("Beğendim").assertCountEquals(0)
        composeRule.onNodeWithText("Tekrar dene").performClick()
        assertEquals("e1", retried?.id)
    }
}
