package com.tyler.kocamind.ui.drawer

import com.tyler.kocamind.data.chat.ChatSummary
import com.tyler.kocamind.data.backend.planFromBillingStatus
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test

class DrawerLogicTest {
    private fun chat(id: String, title: String, updatedAt: String, pinned: Boolean = false, archived: Boolean = false, text: String = "") =
        ChatSummary(id = id, title = title, updatedAt = updatedAt, isPinned = pinned, archived = archived, messagesText = text)

    @Test
    fun pinnedFirstThenNewest_archivedHidden() {
        val chats = listOf(
            chat("a", "Eski", "2026-10-01T10:00:00Z"),
            chat("b", "Yeni", "2026-10-05T10:00:00Z"),
            chat("c", "Sabit", "2026-09-01T10:00:00Z", pinned = true),
            chat("d", "Arşiv", "2026-10-06T10:00:00Z", archived = true),
        )
        assertEquals(listOf("c", "b", "a"), drawerChats(chats, "").map { it.id })
    }

    @Test
    fun search_matchesTitleOrMessages_caseInsensitive() {
        val chats = listOf(
            chat("a", "Kotlin dersi", "2026-10-01T10:00:00Z"),
            chat("b", "Tatil", "2026-10-02T10:00:00Z", text = "kotlin ile uygulama"),
            chat("c", "Yemek", "2026-10-03T10:00:00Z"),
        )
        assertEquals(listOf("b", "a"), drawerChats(chats, "  KOTLIN ").map { it.id })
    }

    @Test
    fun turkishCaseInsensitiveSearch() {
        val chats = listOf(chat("a", "İstanbul gezisi", "2026-10-01T10:00:00Z"))
        assertEquals(listOf("a"), drawerChats(chats, "istanbul").map { it.id })
    }

    @Test
    fun plan_proOnlyWhenActive() {
        fun plan(body: String) = planFromBillingStatus(Json.parseToJsonElement(body))
        assertEquals("pro", plan("""{"billing":{"plan":"pro","status":"active"}}"""))
        assertEquals("free", plan("""{"billing":{"plan":"pro","status":"canceled"}}"""))
        assertEquals("free", plan("""{"billing":{"plan":"free","status":"active"}}"""))
        assertEquals("free", plan("""{}"""))
    }

    @Test
    fun displayName_fallsBackToEmailPrefix() {
        assertEquals("Ali", drawerDisplayName("Ali", "a@b.com"))
        assertEquals("bekir", drawerDisplayName(null, "bekir@gmail.com"))
        assertEquals("bekir", drawerDisplayName("  ", "bekir@gmail.com"))
        assertEquals("Kullanıcı", drawerDisplayName(null, null))
    }

    @Test
    fun sections_groupByDay_pinnedOnTop_emptySectionsSkipped() {
        val now = java.time.Instant.parse("2026-10-12T09:00:00Z")
        val zone = java.time.ZoneId.of("Europe/Istanbul")
        val chats = drawerChats(
            listOf(
                chat("bugun", "a", "2026-10-12T06:00:00Z"),
                chat("dun", "b", "2026-10-11T08:00:00Z"),
                chat("hafta", "c", "2026-10-08T08:00:00Z"),
                chat("ay", "d", "2026-09-20T08:00:00Z"),
                chat("eski", "e", "2026-06-01T08:00:00Z"),
                chat("sabit", "f", "2026-01-01T08:00:00Z", pinned = true),
                chat("bozuk", "g", "tarih-yok"),
            ),
            "",
        )
        val sections = chatSections(chats, now, zone)
        assertEquals(
            listOf("Sabitlenenler", "Bugün", "Dün", "Son 7 gün", "Son 30 gün", "Daha eski"),
            sections.map { it.first },
        )
        assertEquals(listOf("sabit"), sections[0].second.map { it.id })
        assertEquals(listOf("bugun"), sections[1].second.map { it.id })
        assertEquals(setOf("eski", "bozuk"), sections.last().second.map { it.id }.toSet())
    }
}
