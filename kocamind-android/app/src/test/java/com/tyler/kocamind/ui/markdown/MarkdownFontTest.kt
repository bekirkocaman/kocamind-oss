package com.tyler.kocamind.ui.markdown

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.text.TextStyle
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.tyler.kocamind.ui.theme.KmReplyFont
import com.tyler.kocamind.ui.theme.KocaMindTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MarkdownFontTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun replyText_usesSerifReplyFont_likeClaude() {
        val styles = mutableListOf<TextStyle>()
        composeRule.setContent { KocaMindTheme { styles += listOf(MdStyle.body, MdStyle.h1, MdStyle.h2, MdStyle.h3, MdStyle.h4) } }
        composeRule.runOnIdle { styles.forEach { assertEquals(KmReplyFont, it.fontFamily) } }
    }
}
