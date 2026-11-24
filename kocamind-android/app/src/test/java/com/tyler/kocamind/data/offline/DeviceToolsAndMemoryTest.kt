package com.tyler.kocamind.data.offline

import com.tyler.kocamind.data.chat.ChatMessage
import com.tyler.kocamind.data.chat.StoredChat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDateTime

class DeviceToolsAndMemoryTest {
    private val now = LocalDateTime.of(2026, 10, 8, 9, 5)

    @Test
    fun timeAndDate() {
        assertEquals("Cihazının saatine göre şu an saat 09:05.", answerFromDeviceTools("Saat kaç?", now))
        assertEquals("Cihazının tarihine göre bugün 8 Ekim 2026 Perşembe.", answerFromDeviceTools("bugün hangi gün", now))
        assertEquals(
            "Cihaz saatine göre şu an: 8 Ekim 2026 Perşembe, saat 09:05. Tarih ve saat için yalnızca bu bilgiyi kullan.",
            deviceContextLine(now),
        )
    }

    @Test
    fun arithmetic() {
        assertEquals("12 + 30 = 42", answerFromDeviceTools("12 artı 30 kaç eder?", now))
        assertEquals("7 × 8 = 56", answerFromDeviceTools("7x8", now))
        assertEquals("2 ^ 10 = 1.024", answerFromDeviceTools("2^10 nedir", now))
        assertEquals("10 ÷ 4 = 2,5", answerFromDeviceTools("10 bölü 4", now))
        assertEquals(-1.0, evaluateArithmetic("2-(3)"), 0.0)
        assertNull(answerFromDeviceTools("5 / 0", now))
        assertNull(answerFromDeviceTools("Kotlin nedir?", now))
        assertNull(answerFromDeviceTools("42", now))
    }

    @Test
    fun unitConversion() {
        assertEquals("5 km = 3,106856 mil", answerFromDeviceTools("5 km kaç mil", now))
        assertEquals("100 °C = 212 °F", answerFromDeviceTools("100 c kaç f", now))
        assertEquals("2 kg = 4,409245 lb", answerFromDeviceTools("2 kg'ı lb'ye çevir", now))
        assertNull(answerFromDeviceTools("5 km kaç kg", now))
    }

    @Test
    fun memory_findsRelevantPastUserMessages() {
        val chats = listOf(
            StoredChat(
                "c1", "Kedi bakımı", "2026-10-01T10:00:00Z",
                messages = listOf(
                    ChatMessage("1", "user", "Kedim Pamuk mama yemiyor ne yapmalıyım"),
                    ChatMessage("2", "model", "Veterinere götürmelisin."),
                ),
            ),
            StoredChat(
                "c2", "Kotlin", "2026-10-02T10:00:00Z",
                messages = listOf(ChatMessage("3", "user", "Kotlin coroutine nedir"), ChatMessage("4", "model", "Hafif iş parçacığı.")),
            ),
            StoredChat("current", "Şu an", "2026-10-08T10:00:00Z", messages = listOf(ChatMessage("5", "user", "Pamuk kedim hakkında"))),
        )
        val memories = ChatMemoryIndex(chats, nowMillis = 1_791_400_000_000).retrieve("Pamuk adlı kedim yine mama yemiyor", currentChatId = "current", limit = 2)
        assertEquals(listOf("c1"), memories.map { it.chatId })
        val prompt = formatChatMemoriesForPrompt(memories)
        assertEquals("[Geçmiş 1 — Kedi bakımı]\nKullanıcı: Kedim Pamuk mama yemiyor ne yapmalıyım", prompt)
        assertTrue(ChatMemoryIndex(chats, 0).retrieve("ve ile de", null).isEmpty())
    }
}
