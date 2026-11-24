package com.tyler.kocamind.data.sync

import com.tyler.kocamind.data.chat.ChatMessage
import com.tyler.kocamind.data.chat.StoredChat
import java.time.Instant

/*
 * chatCloudSync.ts ile aynı, web ile ortak Firestore şeması:
 * users/{uid}/chats/{chatId}: { title, messages, pinned, archived, createdAt, updatedAt }
 * Mesajlar: { id, role: 'user' | 'ai', content, timestamp }; zamanlar milisaniye.
 */

private val MESSAGE_FIELDS = setOf("id", "role", "content", "timestamp")

fun toMillis(value: Any?): Long = when (value) {
    is Long -> value
    is Int -> value.toLong()
    is Double -> if (value.isFinite()) value.toLong() else 0L
    is Number -> value.toLong()
    is String -> runCatching { Instant.parse(value).toEpochMilli() }.getOrDefault(0L)
    else -> 0L
}

private fun chatCreatedAt(chat: StoredChat): Long {
    chat.createdAt?.takeIf { it > 0 }?.let { return it }
    chat.id.removePrefix("chat_").toLongOrNull()?.takeIf { it > 0 }?.let { return it }
    return toMillis(chat.updatedAt).takeIf { it > 0 } ?: System.currentTimeMillis()
}

/**
 * [preserve]: buluttaki mevcut belge. Aynı kimlikli mesajın bu uygulamanın bilmediği alanları
 * (web'in `imageUrl`, `agentSteps` gibi) korunur; böylece Android bir web sohbetini güncelleyince
 * o alanlar silinmez.
 */
fun toCloudChat(chat: StoredChat, preserve: Map<String, Any?>? = null): Map<String, Any> {
    val createdAt = chatCreatedAt(chat)
    val existing = (preserve?.get("messages") as? List<*>).orEmpty()
        .mapNotNull { it as? Map<*, *> }
        .associateBy { it["id"]?.toString() }
    val messages = chat.messages
        .filter { !it.streaming && it.role != "system" && it.content.isNotBlank() }
        .map { m ->
            val extra = existing[m.id].orEmpty()
                .filterKeys { it is String && it !in MESSAGE_FIELDS }
                .filterValues { it != null }
                .mapKeys { it.key as String }
                .mapValues { it.value as Any }
            extra + mapOf(
                "id" to m.id,
                "role" to if (m.isUser) "user" else "ai",
                "content" to m.content,
                "timestamp" to (m.timestamp?.takeIf { it > 0 } ?: m.id.toLongOrNull() ?: createdAt),
            )
        }
    return mapOf(
        "title" to chat.title.ifBlank { "Yeni sohbet" },
        "messages" to messages,
        "pinned" to chat.isPinned,
        "archived" to chat.archived,
        "createdAt" to createdAt,
        "updatedAt" to (toMillis(chat.updatedAt).takeIf { it > 0 } ?: createdAt),
    )
}

fun fromCloudChat(id: String, data: Map<String, Any?>): StoredChat {
    val createdAt = toMillis(data["createdAt"]).takeIf { it > 0 } ?: id.removePrefix("chat_").toLongOrNull() ?: 0L
    val updatedAt = toMillis(data["updatedAt"]).takeIf { it > 0 } ?: createdAt
    val messages = (data["messages"] as? List<*>).orEmpty().withIndex().mapNotNull { (index, raw) ->
        val m = raw as? Map<*, *> ?: return@mapNotNull null
        val content = m["content"]?.toString().orEmpty()
        if (m["ephemeral"] == true || m["source"] == "gmail" || content.isBlank()) return@mapNotNull null
        val timestamp = toMillis(m["timestamp"]).takeIf { it > 0 }
        ChatMessage(
            // Kimliği olmayan eski web mesajı: web'deki chatSchema.js ile aynı, her eşitlemede aynı kimlik.
            id = m["id"]?.toString()?.takeIf { it.isNotBlank() } ?: "${timestamp ?: createdAt}-$index",
            role = if (m["role"] == "user") "user" else "model",
            content = content,
            timestamp = timestamp ?: createdAt.takeIf { it > 0 },
        )
    }
    return StoredChat(
        id = id,
        title = data["title"]?.toString()?.takeIf { it.isNotBlank() } ?: "Yeni sohbet",
        updatedAt = Instant.ofEpochMilli(updatedAt).toString(),
        isPinned = data["pinned"] == true,
        archived = data["archived"] == true,
        createdAt = createdAt.takeIf { it > 0 },
        messages = messages,
    )
}

/** Yeni olan kazanır; silinmiş kimlikler buluttan geri gelmez. En yeni önde. */
fun mergeChatLists(local: List<StoredChat>, cloud: List<StoredChat>, deletedIds: Set<String> = emptySet()): List<StoredChat> {
    val merged = LinkedHashMap<String, StoredChat>()
    cloud.filter { it.id !in deletedIds }.forEach { merged[it.id] = it }
    local.filter { it.id !in deletedIds }.forEach { chat ->
        val existing = merged[chat.id]
        if (existing == null || toMillis(chat.updatedAt) >= toMillis(existing.updatedAt)) merged[chat.id] = chat
    }
    return merged.values.sortedByDescending { toMillis(it.updatedAt) }
}
