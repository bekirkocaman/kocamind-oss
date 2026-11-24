package com.tyler.kocamind.data.legacy

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.util.Log
import com.tyler.kocamind.data.chat.FileChatHistoryRepository
import com.tyler.kocamind.data.chat.SharedPrefsChatPrefs
import com.tyler.kocamind.data.chat.StoredChat
import com.tyler.kocamind.data.media.LibraryImage
import com.tyler.kocamind.data.media.LibraryStore
import com.tyler.kocamind.data.offline.SharedPrefsOfflinePrefs
import com.tyler.kocamind.data.queue.QueuedMessage
import com.tyler.kocamind.data.sync.PendingOps
import com.tyler.kocamind.data.sync.PrefsPendingOpsStore
import com.tyler.kocamind.data.sync.mergeChatLists
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import java.io.File

data class MigrationReport(val migrated: Boolean, val chats: Int = 0, val keys: Int = 0)

/**
 * Eski Expo uygulamasının verisini taşır. Yeni uygulama aynı paket adı ve imzayla eskisinin
 * üzerine kurulunca uygulama klasörü korunur; AsyncStorage `databases/RKStorage`
 * (`catalystLocalStorage` tablosu) içindeki anahtarlar bir kez okunur. Yeni veri ezilmez.
 * İndirilmiş modeller zaten aynı yolda (`files/offline-models/`).
 */
class LegacyMigration(private val context: Context, private val chatsDir: File) {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    private val flags = context.getSharedPreferences("kocamind", Context.MODE_PRIVATE)

    suspend fun runOnce(): MigrationReport = withContext(Dispatchers.IO) {
        if (flags.getBoolean(DONE_KEY, false)) return@withContext MigrationReport(false)
        val dbFile = context.getDatabasePath("RKStorage")
        if (!dbFile.exists()) return@withContext MigrationReport(false)
        val entries = try {
            readAsyncStorage(dbFile)
        } catch (e: Exception) {
            Log.w(TAG, "Eski veri okunamadı", e)
            return@withContext MigrationReport(false)
        }
        var chats = 0
        entries.forEach { (key, value) ->
            try {
                when {
                    key.startsWith("chat_history_") -> chats += migrateChats(key.removePrefix("chat_history_"), value)
                    key.startsWith("custom_instructions_") -> migrateInstructions(key.removePrefix("custom_instructions_"), value)
                    key == "kocamind_mobile_model" -> SharedPrefsChatPrefs(context).let { if (it.selectedModelId == null) it.selectedModelId = value }
                    key == "kocamind_mobile_mode" -> SharedPrefsChatPrefs(context).let { if (it.assistantMode == null) it.assistantMode = value }
                    key == "library_images" -> migrateLibrary(value)
                    key == "offline_message_queue" -> migrateQueue(value)
                    key.startsWith("chat_sync_pending_") -> migratePending(key.removePrefix("chat_sync_pending_"), value)
                    key == "offline_model_in_use" -> Unit // yarım işaret taşınmaz
                    key.startsWith("offline_") -> SharedPrefsOfflinePrefs(context).let { if (it.get(key) == null) it.set(key, value) }
                }
            } catch (e: Exception) {
                Log.w(TAG, "$key taşınamadı", e)
            }
        }
        flags.edit().putBoolean(DONE_KEY, true).commit()
        Log.i(TAG, "Eski veri taşındı: ${entries.size} anahtar, $chats sohbet")
        MigrationReport(true, chats, entries.size)
    }

    private fun readAsyncStorage(file: File): List<Pair<String, String>> {
        val db = SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READONLY)
        return db.use {
            it.rawQuery("SELECT key, value FROM catalystLocalStorage", null).use { c ->
                buildList { while (c.moveToNext()) add(c.getString(0) to c.getString(1)) }
            }
        }
    }

    /** `chat_history_<e-posta>` hesaba, `chat_history_<deviceId>` misafire gider; yeni olan kazanır. */
    private suspend fun migrateChats(owner: String, value: String): Int {
        val legacy = json.decodeFromString<List<StoredChat>>(value)
        val email = owner.takeIf { it.contains('@') }
        val repo = FileChatHistoryRepository(chatsDir).apply { setOwner(email) }
        repo.replaceAll(mergeChatLists(local = repo.all(), cloud = legacy))
        return legacy.size
    }

    private fun migrateInstructions(owner: String, value: String) {
        val prefs = SharedPrefsChatPrefs(context)
        val email = owner.takeIf { it != "guest" }
        if (prefs.customInstructions(email).isEmpty()) prefs.setCustomInstructions(email, value)
    }

    private suspend fun migrateLibrary(value: String) {
        val store = LibraryStore(context.filesDir)
        json.decodeFromString<List<LibraryImage>>(value).forEach { store.add(it) }
    }

    private fun migrateQueue(value: String) {
        val file = File(context.filesDir, "offline_message_queue.json")
        val existing = runCatching { json.decodeFromString<List<QueuedMessage>>(file.readText()) }.getOrDefault(emptyList())
        val legacy = json.decodeFromString<List<QueuedMessage>>(value).filter { it.ownerId.isNotBlank() && it.chatId.isNotBlank() }
        val merged = existing + legacy.filter { l -> existing.none { it.id == l.id } }
        file.writeText(json.encodeToString(merged))
    }

    private fun migratePending(uid: String, value: String) {
        val store = PrefsPendingOpsStore(context)
        if (store.load(uid) == PendingOps()) store.save(uid, json.decodeFromString<PendingOps>(value))
    }

    companion object {
        private const val TAG = "LegacyMigration"
        const val DONE_KEY = "legacy_migrated_v1"
    }
}
