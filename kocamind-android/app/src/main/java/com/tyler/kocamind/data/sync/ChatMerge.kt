package com.tyler.kocamind.data.sync

import com.tyler.kocamind.data.chat.ChatMessage
import com.tyler.kocamind.data.chat.StoredChat
import kotlinx.serialization.Serializable
import java.time.Instant

/*
 * Üç yönlü sohbet birleştirme (docs/superpowers/specs/2026-10-18-sohbet-esitleme-design.md).
 * Web karşılığı: kocamind-web/src/lib/chatMerge.js; iki taraf aynı test vakalarını geçer.
 */

/** Bir sohbetin bulutla en son anlaşılan hâli: zaman ve buluttaki mesaj kimlikleri. */
@Serializable
data class SyncBase(val updatedAt: Long, val ids: List<String>)

/** Buluta giden mesaj kimlikleri (akan, sistem ve boş mesajlar buluta gitmez). */
fun cloudMessageIds(chat: StoredChat): List<String> =
    chat.messages.filter { !it.streaming && it.role != "system" && it.content.isNotBlank() }.map { it.id }

fun baseOf(chat: StoredChat) = SyncBase(toMillis(chat.updatedAt), cloudMessageIds(chat))

/** Sohbet tabandan bu yana hiç değişmemiş mi (zaman ve mesajlar birebir aynı). */
fun unchangedSince(chat: StoredChat, base: SyncBase): Boolean =
    toMillis(chat.updatedAt) == base.updatedAt && cloudMessageIds(chat) == base.ids

/** Mesaj zamanı; eski mobil mesajlarda kimlik zamandır. */
private fun timeOf(m: ChatMessage): Long = m.timestamp ?: m.id.toLongOrNull() ?: 0L

/**
 * [newer] sırası korunur. Tabanda olup bir tarafta olmayan mesaj o tarafta silinmiştir, sonuca girmez.
 * [older]'daki yeni mesajlar zamanına göre araya yerleşir. Taban yoksa [newer] kazanır.
 */
fun mergeMessages(newer: List<ChatMessage>, older: List<ChatMessage>, base: Collection<String>?): List<ChatMessage> {
    if (base == null) return newer
    val newerIds = newer.mapTo(HashSet()) { it.id }
    val olderIds = older.mapTo(HashSet()) { it.id }
    val removed = base.filterTo(HashSet()) { it !in newerIds || it !in olderIds }
    val result = newer.filterTo(ArrayList()) { it.id !in removed }
    val present = result.mapTo(HashSet()) { it.id }
    for (m in older) {
        if (m.id in removed || m.id in present) continue
        val at = result.indexOfLast { timeOf(it) <= timeOf(m) } + 1
        result.add(at, m)
        present += m.id
    }
    return result
}

/** Aynı sohbetin iki hâli: başlık/sabitleme/arşiv yeni olandan, mesajlar üç yönlü birleşir. */
fun mergeChat(local: StoredChat, cloud: StoredChat, base: SyncBase?): StoredChat {
    val localAt = toMillis(local.updatedAt)
    val cloudAt = toMillis(cloud.updatedAt)
    val (newer, older) = if (localAt >= cloudAt) local to cloud else cloud to local
    return newer.copy(
        messages = mergeMessages(newer.messages, older.messages, base?.ids),
        updatedAt = Instant.ofEpochMilli(maxOf(localAt, cloudAt)).toString(),
        createdAt = local.createdAt ?: cloud.createdAt,
    )
}

/** Bulutta yazılacak içerik aynı mı (yazmaya gerek var mı). */
fun sameInCloud(a: StoredChat, b: StoredChat): Boolean = toCloudChat(a) == toCloudChat(b)

/**
 * Tam eşitleme planı.
 * - [chats]: yereldeki yeni liste (en yeni önde).
 * - [upload]: bulutta farklı olan, işlemle yazılacak sohbetler.
 * - [deleteCloud]: buluttan silinecekler (bu cihazda silinmiş).
 * - [agreed]: bulutla zaten aynı olanların yeni tabanı. [forget]: tabandan çıkacaklar.
 */
data class SyncPlan(
    val chats: List<StoredChat>,
    val upload: List<String>,
    val deleteCloud: List<String>,
    val agreed: Map<String, SyncBase>,
    val forget: Set<String>,
)

fun planSync(
    local: List<StoredChat>,
    cloud: List<StoredChat>,
    bases: Map<String, SyncBase>,
    pendingDeletes: Set<String> = emptySet(),
): SyncPlan {
    val localById = local.associateBy { it.id }
    val cloudById = cloud.associateBy { it.id }
    val chats = mutableListOf<StoredChat>()
    val upload = mutableListOf<String>()
    val deleteCloud = mutableListOf<String>()
    val agreed = mutableMapOf<String, SyncBase>()
    val forget = mutableSetOf<String>()
    for (id in (localById.keys + cloudById.keys)) {
        val l = localById[id]
        val c = cloudById[id]
        val base = bases[id]
        if (id in pendingDeletes) {
            if (c != null) deleteCloud += id else forget += id
            continue
        }
        when {
            l != null && c != null -> {
                val merged = mergeChat(l, c, base)
                chats += merged
                if (sameInCloud(merged, c)) agreed[id] = baseOf(merged) else upload += id
            }
            l != null -> when {
                // Başka cihazda silinmiş ve burada sonradan değişmemiş.
                base != null && unchangedSince(l, base) -> forget += id
                else -> { chats += l; upload += id }
            }
            c != null -> when {
                // Bu cihazda silinmiş (silme buluta ulaşamamış) ve bulutta sonradan değişmemiş.
                base != null && unchangedSince(c, base) -> deleteCloud += id
                else -> { chats += c; agreed[id] = baseOf(c) }
            }
        }
    }
    return SyncPlan(chats.sortedByDescending { toMillis(it.updatedAt) }, upload, deleteCloud, agreed, forget)
}
