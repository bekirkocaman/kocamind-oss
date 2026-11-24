package com.tyler.kocamind.data.sync

import com.tyler.kocamind.data.chat.ChatMessage
import com.tyler.kocamind.data.chat.StoredChat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/** Web'deki chatMerge.test.js ile aynı vakalar. */
class ChatMergeTest {
    private fun m(id: String, t: Long, text: String = "m$id", role: String = "user") = ChatMessage(id, role, text, timestamp = t)
    private fun ids(list: List<ChatMessage>) = list.map { it.id }
    private fun at(ms: Long) = Instant.ofEpochMilli(ms).toString()
    private fun chat(id: String, updated: Long, vararg messages: ChatMessage, title: String = id) =
        StoredChat(id, title, at(updated), messages = messages.toList())

    @Test
    fun withoutBase_newerWins() {
        val out = mergeMessages(listOf(m("1", 10), m("3", 30)), listOf(m("1", 10), m("2", 20)), base = null)
        assertEquals(listOf("1", "3"), ids(out))
    }

    @Test
    fun concurrentAppends_bothKept_inTimeOrder() {
        val out = mergeMessages(
            newer = listOf(m("1", 10), m("2", 20), m("4", 40)),
            older = listOf(m("1", 10), m("2", 20), m("3", 30)),
            base = listOf("1", "2"),
        )
        assertEquals(listOf("1", "2", "3", "4"), ids(out))
    }

    @Test
    fun editTruncation_removesMessagesTheEditorDropped() {
        val out = mergeMessages(
            newer = listOf(m("1", 10), m("9", 90)),
            older = listOf(m("1", 10), m("2", 20), m("3", 30)),
            base = listOf("1", "2", "3"),
        )
        assertEquals(listOf("1", "9"), ids(out))
    }

    @Test
    fun editOnOlderSide_isRespected_andNewerAppendKept() {
        val out = mergeMessages(
            newer = listOf(m("1", 10), m("2", 20), m("3", 30), m("4", 40)),
            older = listOf(m("1", 10), m("5", 50)),
            base = listOf("1", "2", "3"),
        )
        assertEquals(listOf("1", "4", "5"), ids(out))
    }

    @Test
    fun sameId_newerContentWins_andEqualTimesGoAfter() {
        val out = mergeMessages(
            newer = listOf(m("1", 10, "yeni"), m("2", 20)),
            older = listOf(m("1", 10, "eski"), m("3", 20)),
            base = listOf("1"),
        )
        assertEquals(listOf("1", "2", "3"), ids(out))
        assertEquals("yeni", out.first().content)
    }

    @Test
    fun mergeChat_metaFromNewer_messagesMerged_updatedAtMax() {
        val local = chat("c", 100, m("1", 10), m("2", 20), title = "yerel")
        val cloud = chat("c", 200, m("1", 10), m("3", 30), title = "bulut").copy(isPinned = true)
        val out = mergeChat(local, cloud, SyncBase(50, listOf("1")))
        assertEquals("bulut", out.title)
        assertTrue(out.isPinned)
        assertEquals(at(200), out.updatedAt)
        assertEquals(listOf("1", "2", "3"), ids(out.messages))
    }

    @Test
    fun planSync_coversEveryCase() {
        val same = chat("same", 100, m("1", 10))
        val newLocal = chat("newLocal", 100, m("1", 10))
        val goneRemote = chat("goneRemote", 100, m("1", 10))
        val editedLocal = chat("editedLocal", 300, m("1", 10), m("2", 20))
        val newCloud = chat("newCloud", 100, m("1", 10))
        val goneLocal = chat("goneLocal", 100, m("1", 10))
        val editedCloud = chat("editedCloud", 300, m("1", 10), m("2", 20))
        val pendingDel = chat("pendingDel", 100, m("1", 10))
        val bases = mapOf(
            "same" to baseOf(same),
            "goneRemote" to baseOf(goneRemote),
            "editedLocal" to SyncBase(100, listOf("1")),
            "goneLocal" to baseOf(goneLocal),
            "editedCloud" to SyncBase(100, listOf("1")),
        )
        val plan = planSync(
            local = listOf(same, newLocal, goneRemote, editedLocal, pendingDel),
            cloud = listOf(same, newCloud, goneLocal, editedCloud, pendingDel),
            bases = bases,
            pendingDeletes = setOf("pendingDel"),
        )
        assertEquals(setOf("same", "newLocal", "editedLocal", "newCloud", "editedCloud"), plan.chats.map { it.id }.toSet())
        assertEquals(setOf("newLocal", "editedLocal"), plan.upload.toSet())
        assertEquals(setOf("goneLocal", "pendingDel"), plan.deleteCloud.toSet())
        assertEquals(setOf("same", "newCloud", "editedCloud"), plan.agreed.keys)
        assertEquals(setOf("goneRemote"), plan.forget)
    }

    @Test
    fun toCloudChat_keepsWebOnlyFieldsOfExistingMessages() {
        val existing = mapOf(
            "messages" to listOf(mapOf("id" to "1", "role" to "user", "content" to "eski", "timestamp" to 10L, "imageUrl" to "data:x")),
        )
        val out = toCloudChat(chat("c", 100, m("1", 10, "yeni"), m("2", 20)), preserve = existing)
        @Suppress("UNCHECKED_CAST")
        val messages = out["messages"] as List<Map<String, Any>>
        assertEquals("data:x", messages[0]["imageUrl"])
        assertEquals("yeni", messages[0]["content"])
        assertEquals(null, messages[1]["imageUrl"])
    }
}
