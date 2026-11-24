package com.tyler.kocamind.ui.drawer

import com.tyler.kocamind.data.chat.ChatSummary
import java.util.Locale

/** Büyük/küçük harf ve Türkçe i/ı/İ/I farkını yok sayan arama anahtarı. */
private fun fold(s: String): String =
    s.lowercase(Locale.ROOT).replace("i̇", "i").replace('ı', 'i')

/** Arşivlenmemişler; önce sabitlenenler, sonra en yeni. Arama başlıkta ve mesajlarda (CustomDrawerContent.tsx). */
fun drawerChats(chats: List<ChatSummary>, query: String): List<ChatSummary> {
    val q = fold(query.trim())
    return chats
        .filter { !it.archived }
        .filter { q.isEmpty() || fold(it.title).contains(q) || fold(it.messagesText).contains(q) }
        .sortedWith(compareByDescending<ChatSummary> { it.isPinned }.thenByDescending { it.updatedAt })
}

/** displayName → e-postanın @ öncesi → "Kullanıcı". */
fun drawerDisplayName(displayName: String?, email: String?): String =
    displayName?.takeIf { it.isNotBlank() }
        ?: email?.substringBefore('@')?.takeIf { it.isNotBlank() }
        ?: "Kullanıcı"

/**
 * Claude'daki gibi tarih başlıkları: Sabitlenenler, Bugün, Dün, Son 7 gün, Son 30 gün, Daha eski.
 * Sıra [drawerChats]'tan gelir; boş bölüm gösterilmez, tarihi okunamayan sohbet en eskiye düşer.
 */
fun chatSections(
    chats: List<ChatSummary>,
    now: java.time.Instant = java.time.Instant.now(),
    zone: java.time.ZoneId = java.time.ZoneId.systemDefault(),
): List<Pair<String, List<ChatSummary>>> {
    val today = now.atZone(zone).toLocalDate()
    fun section(chat: ChatSummary): String {
        if (chat.isPinned) return "Sabitlenenler"
        val day = runCatching { java.time.Instant.parse(chat.updatedAt).atZone(zone).toLocalDate() }.getOrNull()
            ?: return "Daha eski"
        val days = java.time.temporal.ChronoUnit.DAYS.between(day, today)
        return when {
            days <= 0 -> "Bugün"
            days == 1L -> "Dün"
            days < 7 -> "Son 7 gün"
            days < 30 -> "Son 30 gün"
            else -> "Daha eski"
        }
    }
    val order = listOf("Sabitlenenler", "Bugün", "Dün", "Son 7 gün", "Son 30 gün", "Daha eski")
    val grouped = chats.groupBy(::section)
    return order.mapNotNull { title -> grouped[title]?.let { title to it } }
}
