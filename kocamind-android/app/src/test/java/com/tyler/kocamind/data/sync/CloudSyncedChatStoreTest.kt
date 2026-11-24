package com.tyler.kocamind.data.sync

import com.tyler.kocamind.data.chat.ChatMessage
import com.tyler.kocamind.data.chat.FileChatHistoryRepository
import com.tyler.kocamind.data.chat.StoredChat
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

@OptIn(ExperimentalCoroutinesApi::class)
class CloudSyncedChatStoreTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private val cloud = FakeCloudChatApi()
    private val sync = CloudChatSync(cloud, MemoryPendingOps(), MemorySyncBaseStore())

    private fun chat(streaming: Boolean) = StoredChat(
        "c1", "Başlık", "2025-10-07T10:00:00Z",
        messages = listOf(ChatMessage("1", "user", "soru"), ChatMessage("2", "model", "cevap", isStreaming = streaming)),
    )

    @Test
    fun upsert_uploadsOnlyFinishedChats_whenSignedIn() = runTest {
        var uid: String? = "u1"
        val store = CloudSyncedChatStore(FileChatHistoryRepository(tmp.root), sync, this) { uid }
        store.setOwner("a@b.com")
        store.upsert(chat(streaming = true)); advanceUntilIdle()
        assertFalse(cloud.docsOf("u1").containsKey("c1"))
        store.upsert(chat(streaming = false)); advanceUntilIdle()
        assertTrue(cloud.docsOf("u1").containsKey("c1"))
        uid = null
        store.rename("c1", "Misafir değişikliği"); advanceUntilIdle()
        assertEquals("Başlık", cloud.docsOf("u1")["c1"]!!["title"])
    }

    @Test
    fun pinRenameDelete_reachCloud() = runTest {
        val store = CloudSyncedChatStore(FileChatHistoryRepository(tmp.root), sync, this) { "u1" }
        store.setOwner("a@b.com")
        store.upsert(chat(streaming = false)); advanceUntilIdle()
        store.togglePin("c1"); advanceUntilIdle()
        assertEquals(true, cloud.docsOf("u1")["c1"]!!["pinned"])
        store.rename("c1", "Yeni"); advanceUntilIdle()
        assertEquals("Yeni", cloud.docsOf("u1")["c1"]!!["title"])
        store.delete("c1"); advanceUntilIdle()
        assertFalse(cloud.docsOf("u1").containsKey("c1"))
    }

    @Test
    fun upsert_bringsInMessagesAnotherDeviceAdded() = runTest {
        val store = CloudSyncedChatStore(FileChatHistoryRepository(tmp.root), sync, this) { "u1" }
        store.setOwner("a@b.com")
        val first = chat(streaming = false)
        store.upsert(first); advanceUntilIdle()
        cloud.docsOf("u1")["c1"] = toCloudChat(
            first.copy(updatedAt = "2025-10-07T11:00:00Z", messages = first.messages + ChatMessage("9", "model", "webden", timestamp = 9)),
        )
        store.upsert(first.copy(updatedAt = "2025-10-07T12:00:00Z", messages = first.messages + ChatMessage("10", "user", "telefondan", timestamp = 10)))
        advanceUntilIdle()
        assertEquals(listOf("soru", "cevap", "webden", "telefondan"), store.get("c1")!!.messages.map { it.content })
    }
}
