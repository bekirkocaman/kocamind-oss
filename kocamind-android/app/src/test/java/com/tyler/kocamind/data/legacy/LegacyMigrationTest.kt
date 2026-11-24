package com.tyler.kocamind.data.legacy

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.tyler.kocamind.data.chat.FileChatHistoryRepository
import com.tyler.kocamind.data.chat.SharedPrefsChatPrefs
import com.tyler.kocamind.data.media.LibraryStore
import com.tyler.kocamind.data.offline.SharedPrefsOfflinePrefs
import com.tyler.kocamind.data.queue.FileOfflineQueue
import com.tyler.kocamind.data.sync.PrefsPendingOpsStore
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class LegacyMigrationTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val chatsDir get() = File(context.filesDir, "chats")

    @Before
    fun clean() {
        context.deleteDatabase("RKStorage")
        chatsDir.deleteRecursively()
        context.getSharedPreferences("kocamind", Context.MODE_PRIVATE).edit().clear().commit()
        context.getSharedPreferences("kocamind_offline", Context.MODE_PRIVATE).edit().clear().commit()
    }

    /** Eski Expo uygulamasının AsyncStorage veritabanı. */
    private fun seed(vararg entries: Pair<String, String>) {
        val db = SQLiteDatabase.openOrCreateDatabase(context.getDatabasePath("RKStorage").apply { parentFile?.mkdirs() }, null)
        db.execSQL("CREATE TABLE IF NOT EXISTS catalystLocalStorage (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        entries.forEach { (k, v) -> db.execSQL("INSERT INTO catalystLocalStorage (key, value) VALUES (?, ?)", arrayOf(k, v)) }
        db.close()
    }

    private fun migration() = LegacyMigration(context, chatsDir)

    @Test
    fun migratesChatsPrefsLibraryQueueAndOfflineSettings() = runTest {
        seed(
            "chat_history_a@b.com" to """[{"id":"chat_1","title":"Eski sohbet","updatedAt":"2026-09-01T10:00:00.000Z","messages":[{"id":"1","role":"user","content":"selam"}]}]""",
            "chat_history_device-123" to """[{"id":"chat_2","title":"Misafir","updatedAt":"2026-09-02T10:00:00.000Z","messages":[]}]""",
            "custom_instructions_a@b.com" to "Kısa yaz",
            "kocamind_mobile_model" to "kocamind-local:qwen3.5-2b",
            "kocamind_mobile_mode" to "agent",
            "library_images" to """[{"uri":"file:///data/x.jpg","date":"2026-09-01"}]""",
            "offline_selected_model" to "qwen3.5-2b",
            "offline_auto_model" to "false",
            "offline_model_performance_qwen3.5-2b" to """{"modelId":"qwen3.5-2b","tokensPerSecond":9.1,"promptTokensPerSecond":40,"comfortScore":9,"sampleCount":2,"measuredAt":"x"}""",
            "offline_model_in_use" to "qwen3.5-2b",
            "offline_message_queue" to """[{"id":"q_1","content":"bekleyen","timestamp":5,"ownerId":"u1","chatId":"chat_1","image":{"uri":"x","base64":"y","mimeType":"z"}}]""",
            "chat_sync_pending_u1" to """{"upserts":["chat_1"],"deletes":[]}""",
        )
        val report = migration().runOnce()
        assertTrue(report.migrated)

        val userChats = FileChatHistoryRepository(chatsDir).apply { setOwner("a@b.com") }
        assertEquals("Eski sohbet", userChats.get("chat_1")!!.title)
        val guestChats = FileChatHistoryRepository(chatsDir).apply { setOwner(null) }
        assertEquals("Misafir", guestChats.get("chat_2")!!.title)

        val prefs = SharedPrefsChatPrefs(context)
        assertEquals("Kısa yaz", prefs.customInstructions("a@b.com"))
        assertEquals("kocamind-local:qwen3.5-2b", prefs.selectedModelId)
        assertEquals("agent", prefs.assistantMode)

        assertEquals(listOf("file:///data/x.jpg"), LibraryStore(context.filesDir).images.value.map { it.uri })

        val offline = SharedPrefsOfflinePrefs(context)
        assertEquals("qwen3.5-2b", offline.get("offline_selected_model"))
        assertEquals("false", offline.get("offline_auto_model"))
        assertTrue(offline.get("offline_model_performance_qwen3.5-2b")!!.contains("9.1"))
        // Yarım kalmış "kullanımda" işareti taşınmaz (yanlışlıkla çökme sayılmasın).
        assertNull(offline.get("offline_model_in_use"))

        assertEquals("bekleyen", FileOfflineQueue(context.filesDir).all().single().content)
        assertEquals(listOf("chat_1"), PrefsPendingOpsStore(context).load("u1").upserts)
    }

    @Test
    fun runsOnlyOnce_andNeverOverwritesNewerData() = runTest {
        seed("chat_history_a@b.com" to """[{"id":"chat_1","title":"Eski","updatedAt":"2026-09-01T10:00:00.000Z"}]""")
        val repo = FileChatHistoryRepository(chatsDir).apply { setOwner("a@b.com") }
        repo.upsert(com.tyler.kocamind.data.chat.StoredChat("chat_1", "Yeni", "2026-10-01T10:00:00Z"))
        assertTrue(migration().runOnce().migrated)
        assertEquals("Yeni", FileChatHistoryRepository(chatsDir).apply { setOwner("a@b.com") }.get("chat_1")!!.title)
        assertFalse(migration().runOnce().migrated)
    }

    @Test
    fun withoutLegacyDatabase_doesNothing() = runTest {
        val report = migration().runOnce()
        assertFalse(report.migrated)
        assertFalse(File(chatsDir, FileChatHistoryRepository.fileNameFor(null)).exists())
    }
}
