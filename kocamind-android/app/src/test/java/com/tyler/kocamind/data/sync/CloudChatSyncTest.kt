package com.tyler.kocamind.data.sync

import com.tyler.kocamind.data.chat.ChatMessage
import com.tyler.kocamind.data.chat.FileChatHistoryRepository
import com.tyler.kocamind.data.chat.StoredChat
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

@OptIn(ExperimentalCoroutinesApi::class)
class CloudChatSyncTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private val cloud = FakeCloudChatApi()
    private val pending = MemoryPendingOps()
    private val bases = MemorySyncBaseStore()
    private val sync = CloudChatSync(cloud, pending, bases)

    private fun chat(id: String, at: String, text: String = "mesaj") =
        StoredChat(id, id, at, messages = listOf(ChatMessage("1", "user", text)))

    private suspend fun localStore() = FileChatHistoryRepository(tmp.root).apply { setOwner("a@b.com") }

    @Suppress("UNCHECKED_CAST")
    private fun cloudContents(id: String) =
        (cloud.docsOf("u1")[id]!!["messages"] as List<Map<String, Any>>).map { it["content"] }

    @Test
    fun push_success_writesDoc_andRemembersBase() = runTest {
        assertEquals("c1", sync.push("u1", chat("c1", "2025-10-07T10:00:00Z"))?.id)
        assertEquals("c1", cloud.docsOf("u1")["c1"]!!["title"])
        assertTrue(pending.load("u1").upserts.isEmpty())
        assertEquals(listOf("1"), bases.load("u1")["c1"]!!.ids)
    }

    @Test
    fun push_failure_isRememberedAndRetriedOnSync() = runTest {
        val local = localStore()
        local.upsert(chat("c1", "2025-10-07T10:00:00Z"))
        cloud.failWrites = true
        assertNull(sync.push("u1", local.get("c1")!!))
        assertEquals(listOf("c1"), pending.load("u1").upserts)
        cloud.failWrites = false
        sync.sync("u1", local)
        assertTrue(cloud.docsOf("u1").containsKey("c1"))
        assertTrue(pending.load("u1").upserts.isEmpty())
    }

    @Test
    fun push_mergesWithMessagesAnotherDeviceAdded() = runTest {
        val first = StoredChat("c1", "c1", "2025-10-07T10:00:00Z", messages = listOf(ChatMessage("1", "user", "soru", timestamp = 1)))
        sync.push("u1", first)
        // Web aynı sohbete bir mesaj ekledi; telefon da kendi mesajını ekleyip yazıyor.
        cloud.docsOf("u1")["c1"] = toCloudChat(first.copy(updatedAt = "2025-10-07T11:00:00Z", messages = first.messages + ChatMessage("2", "model", "webden", timestamp = 2)))
        val phone = first.copy(updatedAt = "2025-10-07T12:00:00Z", messages = first.messages + ChatMessage("3", "user", "telefondan", timestamp = 3))
        val merged = sync.push("u1", phone)!!
        assertEquals(listOf("soru", "webden", "telefondan"), merged.messages.map { it.content })
        assertEquals(listOf("soru", "webden", "telefondan"), cloudContents("c1"))
    }

    @Test
    fun delete_failure_keepsChatDeletedAfterSync() = runTest {
        cloud.docsOf("u1")["c1"] = toCloudChat(chat("c1", "2025-10-07T10:00:00Z"))
        cloud.failWrites = true
        assertFalse(sync.deleteCloud("u1", "c1"))
        cloud.failWrites = false
        val local = localStore()
        sync.sync("u1", local)
        assertNull(local.get("c1"))
        assertFalse(cloud.docsOf("u1").containsKey("c1"))
        assertTrue(pending.load("u1").deletes.isEmpty())
    }

    @Test
    fun sync_mergesBothWays() = runTest {
        cloud.docsOf("u1").putAll(
            mapOf(
                "webde" to toCloudChat(chat("webde", "2025-10-08T10:00:00Z", "webden geldi")),
                "ortak" to toCloudChat(chat("ortak", "2025-10-01T10:00:00Z", "eski")),
            ),
        )
        val local = localStore()
        local.upsert(chat("ortak", "2025-10-05T10:00:00Z", "yeni"))
        local.upsert(chat("telefonda", "2025-10-06T10:00:00Z"))
        sync.sync("u1", local)
        assertEquals("webden geldi", local.get("webde")!!.messages.single().content)
        assertEquals("yeni", local.get("ortak")!!.messages.single().content)
        assertTrue(cloud.docsOf("u1").containsKey("telefonda"))
        assertEquals(listOf("yeni"), cloudContents("ortak"))
    }

    @Test
    fun chatDeletedOnAnotherDevice_isNotResurrected() = runTest {
        val local = localStore()
        local.upsert(chat("c1", "2025-10-07T10:00:00Z"))
        sync.sync("u1", local)
        assertTrue(cloud.docsOf("u1").containsKey("c1"))
        // Web sohbeti sildi; telefon eşitleyince geri yüklemez, kendinden de siler.
        cloud.docsOf("u1").remove("c1")
        sync.sync("u1", local)
        assertNull(local.get("c1"))
        assertFalse(cloud.docsOf("u1").containsKey("c1"))
    }

    @Test
    fun listener_appliesRemoteChanges_untilClosed() = runTest {
        val local = localStore()
        val watch = sync.listen("u1", local, this)
        cloud.remoteWrite("u1", "w1", toCloudChat(chat("w1", "2025-10-07T10:00:00Z", "web")))
        advanceUntilIdle()
        assertEquals("web", local.get("w1")!!.messages.single().content)
        cloud.remoteDelete("u1", "w1")
        advanceUntilIdle()
        assertNull(local.get("w1"))
        watch.close()
        assertEquals(0, cloud.listenerCount("u1"))
    }

    @Test
    fun accountChanged_localStoreUntouched() = runTest {
        cloud.docsOf("u1")["c1"] = toCloudChat(chat("c1", "2025-10-07T10:00:00Z"))
        val local = localStore()
        sync.sync("u1", local) { false }
        assertNull(local.get("c1"))
    }

    @Test
    fun deleteAll_removesEveryCloudChatPendingAndBase() = runTest {
        cloud.docsOf("u1").putAll(mapOf("a" to toCloudChat(chat("a", "2025-10-07T10:00:00Z")), "b" to toCloudChat(chat("b", "2025-10-07T10:00:00Z"))))
        pending.save("u1", PendingOps(upserts = listOf("a"), deletes = listOf("z")))
        bases.save("u1", mapOf("a" to SyncBase(1, listOf("1"))))
        sync.deleteAll("u1")
        assertTrue(cloud.docsOf("u1").isEmpty())
        assertEquals(PendingOps(), pending.load("u1"))
        assertTrue(bases.load("u1").isEmpty())
    }
}
