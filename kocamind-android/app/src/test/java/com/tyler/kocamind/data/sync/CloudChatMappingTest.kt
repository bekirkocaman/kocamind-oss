package com.tyler.kocamind.data.sync

import com.tyler.kocamind.data.chat.ChatMessage
import com.tyler.kocamind.data.chat.StoredChat
import org.junit.Assert.assertEquals
import org.junit.Test

class CloudChatMappingTest {
    @Test
    fun toMillis_handlesNumbersAndIsoStrings() {
        assertEquals(1000L, toMillis(1000L))
        assertEquals(1000L, toMillis(1000.0))
        assertEquals(1759831200000L, toMillis("2025-10-07T10:00:00Z"))
        assertEquals(0L, toMillis("bozuk"))
        assertEquals(0L, toMillis(null))
    }

    @Test
    fun toCloud_dropsStreamingSystemAndBlank_mapsRoles() {
        val chat = StoredChat(
            id = "chat_1700000000000",
            title = "Başlık",
            updatedAt = "2025-10-07T10:00:00Z",
            isPinned = true,
            messages = listOf(
                ChatMessage("1700000000001", "user", "soru", timestamp = 1700000000001),
                ChatMessage("1700000000002", "model", "cevap"),
                ChatMessage("x", "model", "", isStreaming = false),
                ChatMessage("y", "model", "yarım", isStreaming = true),
                ChatMessage("z", "system", "sistem"),
            ),
        )
        val cloud = toCloudChat(chat)
        assertEquals("Başlık", cloud["title"])
        assertEquals(true, cloud["pinned"])
        assertEquals(false, cloud["archived"])
        assertEquals(1700000000000L, cloud["createdAt"])
        assertEquals(1759831200000L, cloud["updatedAt"])
        @Suppress("UNCHECKED_CAST")
        val messages = cloud["messages"] as List<Map<String, Any>>
        assertEquals(listOf("user", "ai"), messages.map { it["role"] })
        assertEquals(listOf(1700000000001L, 1700000000002L), messages.map { it["timestamp"] })
    }

    @Test
    fun fromCloud_skipsEphemeralAndGmail_mapsAiToModel() {
        val data = mapOf(
            "title" to "Bulut",
            "pinned" to true,
            "updatedAt" to 1759831200000L,
            "messages" to listOf(
                mapOf("id" to "1", "role" to "user", "content" to "merhaba", "timestamp" to 5L),
                mapOf("id" to "2", "role" to "ai", "content" to "selam"),
                mapOf("id" to "3", "role" to "ai", "content" to "geçici", "ephemeral" to true),
                mapOf("id" to "4", "role" to "ai", "content" to "posta", "source" to "gmail"),
            ),
        )
        val chat = fromCloudChat("chat_5", data)
        assertEquals("Bulut", chat.title)
        assertEquals(true, chat.isPinned)
        assertEquals("2025-10-07T10:00:00Z", chat.updatedAt)
        assertEquals(listOf("user" to "merhaba", "model" to "selam"), chat.messages.map { it.role to it.content })
    }

    @Test
    fun fromCloud_webMessagesWithoutIdOrTime_getStableIdsLikeWeb() {
        // Eski web kaydı: sohbet kimliği önek almaz, mesajlarda id ve timestamp yoktur.
        val data = mapOf(
            "title" to "Web",
            "createdAt" to 1700L,
            "messages" to listOf(
                mapOf("role" to "user", "content" to "soru"),
                mapOf("role" to "ai", "content" to "cevap", "timestamp" to 1800L),
            ),
        )
        val first = fromCloudChat("1700", data)
        // chatSchema.js normalizeMessages ile aynı kural: `<zaman>-<sıra>`.
        assertEquals(listOf("1700-0", "1800-1"), first.messages.map { it.id })
        assertEquals(listOf(1700L, 1800L), first.messages.map { it.timestamp })
        assertEquals(first, fromCloudChat("1700", data))
        @Suppress("UNCHECKED_CAST")
        val back = toCloudChat(first)["messages"] as List<Map<String, Any>>
        assertEquals(listOf("1700-0", "1800-1"), back.map { it["id"] })
        assertEquals(listOf(1700L, 1800L), back.map { it["timestamp"] })
    }

    @Test
    fun merge_newerWins_deletedExcluded_sortedNewestFirst() {
        fun c(id: String, at: String) = StoredChat(id, id, at)
        val local = listOf(c("a", "2025-10-07T10:00:00Z"), c("b", "2025-10-01T10:00:00Z"), c("d", "2025-10-09T10:00:00Z"))
        val cloud = listOf(c("a", "2025-10-05T10:00:00Z"), c("b", "2025-10-03T10:00:00Z"), c("c", "2025-10-08T10:00:00Z"))
        val merged = mergeChatLists(local, cloud, deletedIds = setOf("d"))
        assertEquals(listOf("c", "a", "b"), merged.map { it.id })
        assertEquals("2025-10-07T10:00:00Z", merged.first { it.id == "a" }.updatedAt)
        assertEquals("2025-10-03T10:00:00Z", merged.first { it.id == "b" }.updatedAt)
    }
}
