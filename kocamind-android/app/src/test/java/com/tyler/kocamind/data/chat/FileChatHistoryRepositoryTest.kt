package com.tyler.kocamind.data.chat

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class FileChatHistoryRepositoryTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private fun repo() = FileChatHistoryRepository(tmp.root)

    private fun chat(id: String, title: String, updatedAt: String, vararg contents: String) = StoredChat(
        id = id,
        title = title,
        updatedAt = updatedAt,
        messages = contents.mapIndexed { i, c -> ChatMessage(id = "$id-$i", role = if (i % 2 == 0) "user" else "model", content = c) },
    )

    @Test
    fun upsertAndGet_roundTrip() = runTest {
        val r = repo()
        r.setOwner("a@b.com")
        r.upsert(chat("c1", "Merhaba", "2026-10-07T10:00:00Z", "selam", "aleyküm selam"))
        assertEquals("aleyküm selam", r.get("c1")!!.messages[1].content)
        // Yeni bir örnek aynı dosyayı okur.
        val again = repo().apply { setOwner("a@b.com") }
        assertEquals("Merhaba", again.get("c1")!!.title)
    }

    @Test
    fun summaries_includeMessagesForSearch() = runTest {
        val r = repo()
        r.setOwner("a@b.com")
        r.upsert(chat("c1", "Başlık", "2026-10-07T10:00:00Z", "kotlin nedir"))
        val summary = r.chats.value!!.single()
        assertEquals("c1", summary.id)
        assertTrue(summary.messagesText.contains("kotlin nedir"))
    }

    @Test
    fun owners_areIsolated() = runTest {
        val r = repo()
        r.setOwner("a@b.com")
        r.upsert(chat("c1", "A sohbeti", "2026-10-07T10:00:00Z"))
        r.setOwner("b@c.com")
        assertEquals(emptyList<ChatSummary>(), r.chats.value)
        assertNull(r.get("c1"))
        r.setOwner("a@b.com")
        assertEquals(listOf("c1"), r.chats.value!!.map { it.id })
    }

    @Test
    fun pinRenameDelete() = runTest {
        val r = repo()
        r.setOwner(null)
        r.upsert(chat("c1", "Eski ad", "2026-10-07T10:00:00Z"))
        r.togglePin("c1")
        assertTrue(r.get("c1")!!.isPinned)
        r.rename("c1", "Yeni ad")
        assertEquals("Yeni ad", r.get("c1")!!.title)
        r.delete("c1")
        assertNull(r.get("c1"))
        assertEquals(emptyList<ChatSummary>(), r.chats.value)
    }

    @Test
    fun readsLegacyAsyncStorageJson() = runTest {
        // Eski uygulamanın AsyncStorage biçimi (bilinmeyen alanlar yok sayılır).
        tmp.root.resolve(FileChatHistoryRepository.fileNameFor("a@b.com")).writeText(
            """[{"id":"chat_1","title":"Eski","updatedAt":"2026-09-01T10:00:00.000Z","isPinned":true,"cloudSyncedAt":"x",
              "messages":[{"id":"1","role":"user","content":"hey","timestamp":1},{"id":"2","role":"model","content":"selam","isStreaming":false}]}]""",
        )
        val r = repo().apply { setOwner("a@b.com") }
        val loaded = r.get("chat_1")!!
        assertTrue(loaded.isPinned)
        assertEquals(listOf("hey", "selam"), loaded.messages.map { it.content })
    }

    @Test
    fun oneUnreadableChat_doesNotWipeTheOthers() = runTest {
        val file = java.io.File(tmp.root, FileChatHistoryRepository.fileNameFor("a@b.com"))
        file.writeText(
            """[{"id":"iyi","title":"İyi","updatedAt":"2026-10-01T10:00:00Z","messages":[]},""" +
                """{"id":"bozuk","title":"Bozuk","updatedAt":"2026-10-01T10:00:00Z","messages":[{"id":"1","role":"model","content":"x","agentSteps":[{"name":"web","result":{"obje":1}}]}]}]""",
        )
        val r = repo().apply { setOwner("a@b.com") }
        assertEquals("İyi", r.get("iyi")!!.title)
        r.upsert(chat("yeni", "Yeni", "2026-10-08T10:00:00Z", "selam"))
        // Okunamayan kayıt silinmez, dosyada aynen kalır.
        val text = file.readText()
        assertTrue(text.contains("\"bozuk\""))
        assertTrue(text.contains("\"iyi\""))
        assertTrue(text.contains("\"yeni\""))
    }

    @Test
    fun unparseableFile_isBackedUpBeforeOverwrite() = runTest {
        val file = java.io.File(tmp.root, FileChatHistoryRepository.fileNameFor("a@b.com"))
        file.writeText("[{bozuk json")
        val r = repo().apply { setOwner("a@b.com") }
        r.upsert(chat("yeni", "Yeni", "2026-10-08T10:00:00Z", "selam"))
        val backup = java.io.File(tmp.root, file.name + ".corrupt")
        assertTrue(backup.exists())
        assertEquals("[{bozuk json", backup.readText())
    }
}
