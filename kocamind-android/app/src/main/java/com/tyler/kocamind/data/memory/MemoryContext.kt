package com.tyler.kocamind.data.memory

import com.tyler.kocamind.data.chat.ChatMessage
import kotlinx.serialization.Serializable
import java.util.Locale

/** Backend'deki kullanıcı hafızası (`/memory/list`). Kategori: kisisel, tercih, is, saglik, proje, genel. */
@Serializable
data class Memory(val key: String, val value: String, val category: String? = null)

/** Başka uygulamadan içe aktarmanın sonucu. */
data class ImportResult(val saved: Int, val skippedForLimit: Int, val from: String? = null)

/** Yapay zekânın sohbetlere ve hafızaya dayanan objektif yorumu; [text] null ise yorum için yeterli veri yok. */
data class MemoryInsight(val text: String?, val basedOn: Int, val chats: Int = 0)

/** `/memory/summarize` isteğindeki mesaj. */
data class SummaryMessage(val role: String, val content: String)

/** Sohbet bağlamı planı: özetlenecek eski kısım ve modele olduğu gibi gidecek son mesajlar. */
data class ConversationPlan(
    val summary: String,
    val needsSummary: Boolean,
    val toSummarize: List<ChatMessage>,
    val newSummaryIndex: Int,
    val recent: List<ChatMessage>,
)

// kocamind-web/src/lib/memoryContext.js ile aynı sınırlar.
private const val MAX_PROMPT_MEMORIES = 20
private val ALWAYS_INCLUDED_CATEGORIES = setOf("kisisel", "tercih", "saglik")
private const val RECENT_BUDGET_CHARS = 120000
private const val SMALL_RECENT_BUDGET_CHARS = 12000
private val SMALL_CONTEXT_PROVIDERS = setOf("groq", "local")
private const val RECENT_MIN_MESSAGES = 6
private const val SUMMARIZE_AFTER_CHARS = 6000
private const val SUMMARIZE_AFTER_MESSAGES = 12
private const val SUMMARY_MESSAGE_CHARS = 6000

private val TR = Locale.forLanguageTag("tr")
private val SPLIT = Regex("[^\\p{L}\\p{N}]+")

private fun terms(text: String): List<String> =
    text.lowercase(TR).split(SPLIT).filter { it.length >= 3 }.map { it.take(5) }

/** Hafıza azsa hepsi; çoksa soruyla kelime örtüşenler ve çekirdek kategoriler önce. */
fun selectRelevantMemories(memories: List<Memory>, text: String, limit: Int = MAX_PROMPT_MEMORIES): List<Memory> {
    if (memories.size <= limit) return memories
    val query = terms(text).toSet()
    return memories.withIndex()
        .map { (index, memory) ->
            val overlap = terms("${memory.key} ${memory.value}").count { it in query }
            val core = if (memory.category in ALWAYS_INCLUDED_CATEGORIES) 1 else 0
            Triple(memory, index, overlap * 3 + core)
        }
        .sortedWith(compareByDescending<Triple<Memory, Int, Int>> { it.third }.thenBy { it.second })
        .take(limit)
        .map { it.first }
}

fun formatMemoriesForPrompt(memories: List<Memory>): String {
    if (memories.isEmpty()) return ""
    return "\n\nKullanıcı hakkında hafızandaki bilgiler (yalnızca konuyla ilgiliyse doğal biçimde kullan, her cevapta tekrar etme):\n" +
        memories.joinToString("\n") { "- ${it.key}: ${it.value}" }
}

/** Geniş bağlamlı bulut modellerinde büyük, Groq ve cihaz içi modelde küçük bütçe. */
fun contextBudgetChars(provider: String?): Int =
    if (provider in SMALL_CONTEXT_PROVIDERS) SMALL_RECENT_BUDGET_CHARS else RECENT_BUDGET_CHARS

/** Son özetten sonraki mesajlardan bütçeye sığanları tutar, kalan eski kısım büyükse özetlenmek üzere ayırır. */
fun planConversationContext(history: List<ChatMessage>, budgetChars: Int = RECENT_BUDGET_CHARS): ConversationPlan {
    var summaryIndex = -1
    var summary = ""
    history.forEachIndexed { index, message ->
        if (!message.contextSummary.isNullOrEmpty()) {
            summaryIndex = index
            summary = message.contextSummary
        }
    }
    val uncovered = history.drop(summaryIndex + 1)
    var start = uncovered.size
    var recentChars = 0
    while (start > 0) {
        val size = uncovered[start - 1].content.length
        if (uncovered.size - start >= RECENT_MIN_MESSAGES && recentChars + size > budgetChars) break
        recentChars += size
        start -= 1
    }
    val older = uncovered.take(start)
    val olderChars = older.sumOf { it.content.length }
    val needsSummary = older.isNotEmpty() && (olderChars >= SUMMARIZE_AFTER_CHARS || older.size >= SUMMARIZE_AFTER_MESSAGES)
    return ConversationPlan(
        summary = summary,
        needsSummary = needsSummary,
        toSummarize = if (needsSummary) older else emptyList(),
        newSummaryIndex = if (needsSummary) summaryIndex + older.size else summaryIndex,
        recent = if (needsSummary) uncovered.drop(start) else uncovered,
    )
}

fun toSummaryMessages(messages: List<ChatMessage>): List<SummaryMessage> =
    messages.map { SummaryMessage(if (it.role == "user") "user" else "ai", it.content.take(SUMMARY_MESSAGE_CHARS)) }

/**
 * Özet modele verilirken başına eklenir; backend memoryAssist.js ile aynı metin. Kullanıcının
 * söyledikleri bilgi kabul edilir, asistanın eski cevapları doğrulanmamış sayılır.
 */
const val SUMMARY_HEADER = "BU SOHBETİN ÖNCEKİ KISMININ ÖZETİ (eski mesajlar yer kazanmak için özetlendi). \"Kullanıcının söyledikleri\" bölümünü kullanıcının verdiği bilgi olarak kabul et. \"Asistanın önceki cevapları\" bölümü senin eski cevaplarındır; doğrulanmış bilgi değildir ve yanlış olabilir: kesin bilgi gibi tekrarlama, gerekirse kontrol edip düzelt."
