package com.tyler.kocamind.data.memory

import com.tyler.kocamind.data.chat.ChatMessage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MemoryContextTest {
    private var n = 0
    private fun msg(role: String, size: Int, summary: String? = null) =
        ChatMessage(id = "m${n++}", role = role, content = "x".repeat(size), contextSummary = summary)

    @Test fun fewMemories_allReturned() {
        val memories = listOf(Memory("isim", "Bekir"))
        assertEquals(memories, selectRelevantMemories(memories, "selam"))
    }

    @Test fun manyMemories_pickTopicAndCore() {
        val memories = (0 until 30).map { Memory("not $it", "rastgele $it", "genel") } +
            Memory("alerji", "Fıstık alerjisi var", "saglik") +
            Memory("araba", "Kırmızı bir Toyota kullanıyor", "genel")
        val selected = selectRelevantMemories(memories, "Toyota arabam için bakım önerisi", 5)
        assertEquals(5, selected.size)
        assertEquals("araba", selected[0].key)
        assertTrue(selected.any { it.key == "alerji" })
    }

    @Test fun prompt_emptyWithoutMemories() {
        assertEquals("", formatMemoriesForPrompt(emptyList()))
        assertTrue(formatMemoriesForPrompt(listOf(Memory("isim", "Bekir"))).contains("- isim: Bekir"))
    }

    @Test fun shortChat_needsNoSummary() {
        val history = listOf(msg("user", 100), msg("model", 100))
        val plan = planConversationContext(history)
        assertFalse(plan.needsSummary)
        assertEquals(history, plan.recent)
        assertEquals("", plan.summary)
    }

    @Test fun longChat_splitsOlderPartForSummary() {
        val history = (0 until 20).map { msg(if (it % 2 == 1) "model" else "user", 2000) }
        val plan = planConversationContext(history, contextBudgetChars("groq"))
        assertTrue(plan.needsSummary)
        assertEquals(6, plan.recent.size)
        assertEquals(14, plan.toSummarize.size)
        assertEquals(13, plan.newSummaryIndex)
    }

    @Test fun wideContextModel_keepsLast120kChars() {
        val history = (0 until 80).map { msg(if (it % 2 == 1) "model" else "user", 2000) }
        val plan = planConversationContext(history, contextBudgetChars("deepseek"))
        assertTrue(plan.needsSummary)
        assertEquals(60, plan.recent.size)
        assertEquals(20, plan.toSummarize.size)
        assertEquals(12000, contextBudgetChars("local"))
    }

    @Test fun existingSummary_usesOnlyWhatFollows() {
        val history = listOf(msg("user", 3000), msg("model", 3000, "- önceki özet"), msg("user", 100), msg("model", 100))
        val plan = planConversationContext(history)
        assertEquals("- önceki özet", plan.summary)
        assertFalse(plan.needsSummary)
        assertEquals(history.drop(2), plan.recent)
    }

    @Test fun summaryMessages_normalizeRoleAndTrim() {
        val first = toSummaryMessages(listOf(ChatMessage("a", "model", "y".repeat(9000)))).single()
        assertEquals("ai", first.role)
        assertEquals(6000, first.content.length)
    }
}
