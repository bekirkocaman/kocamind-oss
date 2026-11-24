package com.tyler.kocamind.ui.settings

import com.tyler.kocamind.data.chat.ChatMessage
import com.tyler.kocamind.data.chat.StoredChat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime

class ExportFormatsTest {
    private val now = ZonedDateTime.of(2026, 10, 11, 21, 5, 0, 0, ZoneId.of("Europe/Istanbul"))
    private val chat = StoredChat(
        id = "c1", title = "Özdeğer", updatedAt = "x",
        messages = listOf(
            ChatMessage("1", "user", "Özdeğeri anlat <lütfen>"),
            ChatMessage("2", "model", "## Kısaca\n\nBir **vektör** yönünü korur.\n\n- bir\n- iki\n\n```kotlin\nval a = 1\n```", thinking = "gizli düşünce"),
            ChatMessage("3", "model", ""),
        ),
    )

    @Test fun markdown_hasTitleSpeakersAndKeepsMarkdown() {
        val md = buildExport(ExportFormat.Markdown, listOf(chat), now)
        assertTrue(md.startsWith("# Özdeğer\n"))
        assertTrue(md.contains("_KocaMind · 11 Ekim 2026 21:05 · 2 mesaj_"))
        assertTrue(md.contains("**Sen:** Özdeğeri anlat <lütfen>"))
        assertTrue(md.contains("**KocaMind:**\n\n## Kısaca"))
        assertFalse("düşünce dışa aktarılmaz", md.contains("gizli düşünce"))
    }

    @Test fun text_stripsMarkdown() {
        val txt = buildExport(ExportFormat.Text, listOf(chat), now)
        assertTrue(txt.contains("Sen:\nÖzdeğeri anlat <lütfen>"))
        assertTrue(txt.contains("Bir vektör yönünü korur."))
        assertTrue(txt.contains("• bir"))
        assertTrue(txt.contains("KISACA"))
        assertTrue(txt.contains("    val a = 1"))
        assertFalse(txt.contains("**"))
    }

    @Test fun html_isEscapedStandaloneDocument() {
        val html = buildExport(ExportFormat.Html, listOf(chat), now)
        assertTrue(html.startsWith("<!doctype html>"))
        assertTrue(html.contains("Özdeğeri anlat &lt;lütfen&gt;"))
        assertTrue(html.contains("<strong>vektör</strong>"))
        assertTrue(html.contains("<li>bir</li>"))
        assertTrue(html.contains("<pre><code>val a = 1</code></pre>"))
        assertFalse(html.contains("<lütfen>"))
    }

    @Test fun multipleChats_haveSectionTitlesAndCountTitle() {
        val other = chat.copy(id = "c2", title = "İkinci")
        val md = buildExport(ExportFormat.Markdown, listOf(chat, other), now)
        assertTrue(md.startsWith("# 2 sohbet\n"))
        assertTrue(md.contains("## İkinci"))
        assertTrue(md.contains("4 mesaj"))
    }

    @Test fun json_isBackupOfStoredChats() {
        val json = buildExport(ExportFormat.Json, listOf(chat), now)
        assertTrue(json.contains("\"id\":\"c1\""))
    }

    @Test fun messageCount_skipsEmpty() {
        assertEquals(2, exportMessageCount(listOf(chat)))
    }

    @Test fun fileName_dependsOnCountAndFormat() {
        assertEquals("kocamind-sohbet-2026-10-11.html", exportFileName(ExportFormat.Html, 1, now.toLocalDate()))
        assertEquals("kocamind-sohbetler-2026-10-11.md", exportFileName(ExportFormat.Markdown, 3, now.toLocalDate()))
    }
}
