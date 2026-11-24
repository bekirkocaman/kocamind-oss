package com.tyler.kocamind.ui.markdown

import org.junit.Assert.assertEquals
import org.junit.Test

class MarkdownParserTest {
    @Test
    fun blocks_headingParagraphListCodeQuote() {
        val md = """
            # Başlık
            ## Alt başlık
            İlk satır
            devamı

            - bir
            - **iki**
            1. sıra
            2. sıra iki

            > alıntı

            ```kotlin
            val x = 1
            ```
            ---
        """.trimIndent()
        val blocks = parseMarkdown(md)
        assertEquals(
            listOf(
                MdBlock.Heading(1, "Başlık"),
                MdBlock.Heading(2, "Alt başlık"),
                MdBlock.Paragraph("İlk satır\ndevamı"),
                MdBlock.ListBlock(ordered = false, items = listOf("bir", "**iki**"), start = 1),
                MdBlock.ListBlock(ordered = true, items = listOf("sıra", "sıra iki"), start = 1),
                MdBlock.Quote("alıntı"),
                MdBlock.Code("kotlin", "val x = 1"),
                MdBlock.Rule,
            ),
            blocks,
        )
    }

    @Test
    fun unclosedFence_whileStreaming_isStillCode() {
        assertEquals(listOf(MdBlock.Code("", "print(1)\nprint(2)")), parseMarkdown("```\nprint(1)\nprint(2)"))
    }

    @Test
    fun table_parsed() {
        val md = "| Ad | Yaş |\n|---|---|\n| Ali | 3 |\n| Ayşe | 5 |"
        assertEquals(
            listOf(MdBlock.Table(header = listOf("Ad", "Yaş"), rows = listOf(listOf("Ali", "3"), listOf("Ayşe", "5")))),
            parseMarkdown(md),
        )
    }

    @Test
    fun inline_boldItalicCodeLink() {
        val spans = parseInline("a **kalın** ve *eğik* ile `kod` [link](https://x.com) son")
        assertEquals(
            listOf(
                MdInline.Text("a "),
                MdInline.Bold(listOf(MdInline.Text("kalın"))),
                MdInline.Text(" ve "),
                MdInline.Italic(listOf(MdInline.Text("eğik"))),
                MdInline.Text(" ile "),
                MdInline.Code("kod"),
                MdInline.Text(" "),
                MdInline.Link(listOf(MdInline.Text("link")), "https://x.com"),
                MdInline.Text(" son"),
            ),
            spans,
        )
    }

    @Test
    fun inline_unclosedMarkers_stayLiteral() {
        assertEquals(listOf(MdInline.Text("2 * 3 = 6 ve **yarım")), parseInline("2 * 3 = 6 ve **yarım"))
    }

    @Test
    fun inline_underscoreInsideWord_isLiteral() {
        assertEquals(listOf(MdInline.Text("snake_case_isim")), parseInline("snake_case_isim"))
    }
}
