package com.tyler.kocamind.ui.theme

import androidx.compose.ui.text.font.FontListFontFamily
import androidx.compose.ui.text.font.ResourceFont
import com.tyler.kocamind.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TypeFontTest {
    private fun resources(family: androidx.compose.ui.text.font.FontFamily) =
        (family as FontListFontFamily).fonts.map { (it as ResourceFont).resId }.toSet()

    /** Klon düzeni: arayüz sade (Inter), yapay zekâ cevabı serifli (Newsreader). */
    @Test
    fun uiIsInter_replyIsNewsreader() {
        assertEquals(setOf(R.font.inter_regular, R.font.inter_medium, R.font.inter_semibold), resources(KmFont))
        assertTrue(R.font.newsreader in resources(KmReplyFont))
        listOf(KmType.display, KmType.title, KmType.headline, KmType.body, KmType.callout, KmType.subhead, KmType.footnote, KmType.caption, KmType.overline)
            .forEach { assertEquals(KmFont, it.fontFamily) }
        assertEquals(KmReplyFont, KmType.reply.fontFamily)
    }
}
