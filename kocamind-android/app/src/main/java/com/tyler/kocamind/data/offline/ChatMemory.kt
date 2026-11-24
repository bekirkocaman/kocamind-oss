package com.tyler.kocamind.data.offline

import com.tyler.kocamind.data.chat.StoredChat
import com.tyler.kocamind.data.sync.toMillis
import java.text.Normalizer
import java.util.Locale
import kotlin.math.ln

/*
 * localChatMemory.ts: geçmiş sohbetlerden soruyla ilgili kullanıcı mesajlarını bulan
 * küçük TF-IDF arama. Yerel model bu bağlamla "önceki konuşmamıza göre" cevap verebilir.
 */

data class RetrievedChatMemory(val chatId: String, val title: String, val userText: String, val assistantText: String, val score: Double)

private val STOP_WORDS = setOf(
    "acaba", "ama", "artık", "ben", "bana", "beni", "benim", "bir", "biz", "bu", "bunu",
    "çok", "da", "daha", "de", "diye", "en", "gibi", "hem", "için", "ile", "ise", "ki",
    "kim", "mı", "mi", "mu", "mü", "nasıl", "ne", "neden", "o", "olan", "olarak", "onu",
    "şey", "şimdi", "şu", "ve", "veya", "ya", "yani", "yok", "var", "miyim", "misin",
)

private val TR = Locale.forLanguageTag("tr-TR")

private fun normalizeWord(value: String): String =
    Normalizer.normalize(value.lowercase(TR), Normalizer.Form.NFKD).replace(Regex("[\\u0300-\\u036f]"), "")

/** Kelimeler + Türkçe ekleri tolere etmek için 5 harflik kökler (~kelim). */
private fun tokenize(value: String): List<String> {
    val words = normalizeWord(value)
        .replace(Regex("[^a-z0-9çğıöşü]+"), " ")
        .split(Regex("\\s+"))
        .filter { it.length >= 2 && it !in STOP_WORDS }
    return buildList {
        words.forEach { word ->
            add(word)
            if (word.length >= 5) add("~${word.take(5)}")
        }
    }
}

private fun truncate(value: String, max: Int) = if (value.length <= max) value else value.take(max).trimEnd() + "…"

private class MemoryDocument(
    val chatId: String,
    val title: String,
    val updatedAt: Long,
    val userText: String,
    val assistantText: String,
    val titleTerms: Map<String, Int>,
    val userTerms: Map<String, Int>,
    val assistantTerms: Map<String, Int>,
)

private fun counts(terms: List<String>): Map<String, Int> = terms.groupingBy { it }.eachCount()

class ChatMemoryIndex(chats: List<StoredChat>, private val nowMillis: Long = System.currentTimeMillis()) {
    private val documents: List<MemoryDocument>
    private val documentFrequency: Map<String, Int>

    init {
        val docs = mutableListOf<MemoryDocument>()
        chats.forEach { chat ->
            if (chat.id.isBlank()) return@forEach
            val title = chat.title.trim().ifEmpty { "Geçmiş sohbet" }
            val updatedAt = toMillis(chat.updatedAt)
            chat.messages.forEachIndexed { index, message ->
                if (message.role != "user") return@forEachIndexed
                val userText = message.content.trim()
                if (userText.isEmpty()) return@forEachIndexed
                val answers = mutableListOf<String>()
                for (j in index + 1 until chat.messages.size) {
                    val answer = chat.messages[j]
                    if (answer.role == "user") break
                    val text = answer.content.trim()
                    if (text.isNotEmpty() && (answer.role == "model" || answer.role == "assistant")) answers += text
                }
                docs += MemoryDocument(
                    chatId = chat.id,
                    title = title,
                    updatedAt = updatedAt,
                    userText = userText,
                    assistantText = answers.joinToString("\n"),
                    titleTerms = counts(tokenize(title)),
                    userTerms = counts(tokenize(userText)),
                    assistantTerms = counts(tokenize(answers.joinToString(" "))),
                )
            }
        }
        documents = docs
        documentFrequency = buildMap {
            docs.forEach { doc ->
                (doc.titleTerms.keys + doc.userTerms.keys + doc.assistantTerms.keys).forEach { term -> put(term, (get(term) ?: 0) + 1) }
            }
        }
    }

    private fun score(query: String, queryTerms: Set<String>, doc: MemoryDocument): Double {
        var score = 0.0
        queryTerms.forEach { term ->
            val idf = ln(1 + (documents.size + 1.0) / ((documentFrequency[term] ?: 0) + 1))
            score += idf * ((doc.titleTerms[term] ?: 0) * 3 + (doc.userTerms[term] ?: 0) * 2.4 + (doc.assistantTerms[term] ?: 0) * 1.15)
        }
        val normalizedQuery = normalizeWord(query).trim()
        if (normalizedQuery.length >= 5) {
            if (normalizeWord(doc.title).contains(normalizedQuery)) score += 10
            if (normalizeWord(doc.userText).contains(normalizedQuery)) score += 8
            if (normalizeWord(doc.assistantText).contains(normalizedQuery)) score += 4
        }
        if (score > 0 && doc.updatedAt > 0) {
            val ageDays = maxOf(0.0, (nowMillis - doc.updatedAt) / 86_400_000.0)
            score += maxOf(0.0, 1.25 - ageDays / 180)
        }
        return score
    }

    fun retrieve(query: String, currentChatId: String?, limit: Int = 4): List<RetrievedChatMemory> {
        val queryTerms = tokenize(query).toSet()
        if (queryTerms.isEmpty()) return emptyList()
        val ranked = documents
            .filter { it.chatId != currentChatId }
            .map { it to score(query, queryTerms, it) }
            .filter { it.second >= 2.5 }
            .sortedWith(compareByDescending<Pair<MemoryDocument, Double>> { it.second }.thenByDescending { it.first.updatedAt })
        val selected = mutableListOf<RetrievedChatMemory>()
        val perChat = mutableMapOf<String, Int>()
        for ((doc, score) in ranked) {
            if ((perChat[doc.chatId] ?: 0) >= 2) continue
            selected += RetrievedChatMemory(doc.chatId, doc.title, truncate(doc.userText, 520), truncate(doc.assistantText, 720), score)
            perChat[doc.chatId] = (perChat[doc.chatId] ?: 0) + 1
            if (selected.size >= limit) break
        }
        return selected
    }
}

/** Yalnız kullanıcının kendi söyledikleri verilir; modelin eski cevapları doğrulanmış bilgi değildir. */
fun formatChatMemoriesForPrompt(memories: List<RetrievedChatMemory>): String =
    memories.mapIndexed { i, m -> "[Geçmiş ${i + 1} — ${m.title}]\nKullanıcı: ${m.userText}" }.joinToString("\n\n")
