package com.tyler.kocamind.data.chat

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import java.io.File
import java.time.Instant

/** Drawer listesi için sohbet özeti. [messagesText] aramada kullanılır. */
data class ChatSummary(
    val id: String,
    val title: String,
    val updatedAt: String,
    val isPinned: Boolean = false,
    val archived: Boolean = false,
    val messagesText: String = "",
)

/** Drawer'ın kullandığı sohbet geçmişi işlemleri. */
interface ChatHistoryRepository {
    /** null = henüz yüklenmedi (drawer iskelet gösterir). */
    val chats: StateFlow<List<ChatSummary>?>
    suspend fun togglePin(id: String)
    suspend fun rename(id: String, title: String)
    suspend fun delete(id: String)
}

/** Sohbetleri okuyup yazan depo. Drawer listesini [chats] üzerinden yayınlar. */
interface ChatStore : ChatHistoryRepository {
    /** Hesap değişince çağrılır: e-posta ya da misafir için null. */
    suspend fun setOwner(email: String?)
    suspend fun get(id: String): StoredChat?
    suspend fun upsert(chat: StoredChat)
    suspend fun all(): List<StoredChat>

    /** Bulut eşitlemesinden sonra tüm listeyi değiştirir. */
    suspend fun replaceAll(chats: List<StoredChat>)
}

/**
 * Her hesap için tek JSON dosyası; içerik eski AsyncStorage `chat_history_<e-posta>` değeriyle aynı biçimde.
 * Böylece eski veri ve bulut eşitlemesi (Plan 3) dönüştürme gerektirmez.
 */
class FileChatHistoryRepository(private val dir: File) : ChatStore {
    private val mutex = Mutex()
    private var owner: String? = null
    private var cache: List<StoredChat> = emptyList()
    private val summaries = MutableStateFlow<List<ChatSummary>?>(null)
    override val chats: StateFlow<List<ChatSummary>?> = summaries

    override suspend fun setOwner(email: String?) = mutex.withLock {
        owner = email
        cache = withContext(Dispatchers.IO) { read() }
        publish()
    }

    override suspend fun get(id: String): StoredChat? = mutex.withLock { cache.firstOrNull { it.id == id } }

    override suspend fun upsert(chat: StoredChat) = mutate { list -> listOf(chat) + list.filter { it.id != chat.id } }

    override suspend fun all(): List<StoredChat> = mutex.withLock { cache }

    override suspend fun replaceAll(chats: List<StoredChat>) = mutate { chats }

    override suspend fun togglePin(id: String) = mutate { list ->
        list.map { if (it.id == id) it.copy(isPinned = !it.isPinned, updatedAt = Instant.now().toString()) else it }
    }

    override suspend fun rename(id: String, title: String) = mutate { list ->
        list.map { if (it.id == id) it.copy(title = title, updatedAt = Instant.now().toString()) else it }
    }

    override suspend fun delete(id: String) = mutate { list -> list.filter { it.id != id } }

    private suspend fun mutate(change: (List<StoredChat>) -> List<StoredChat>) = mutex.withLock {
        cache = change(cache)
        withContext(Dispatchers.IO) { write(cache) }
        publish()
    }

    private fun publish() {
        summaries.value = cache.map { it.toSummary() }
    }

    private fun file(): File = File(dir, fileNameFor(owner))

    /** Çözülemeyen kayıtlar: gösterilmez ama dosyada aynen korunur (bir kayıt bütün geçmişi silmesin). */
    private var unreadable: List<JsonElement> = emptyList()

    private fun read(): List<StoredChat> {
        unreadable = emptyList()
        val f = file()
        if (!f.exists()) return emptyList()
        val array = try {
            json.parseToJsonElement(f.readText()) as? JsonArray ?: throw IllegalStateException("Liste değil")
        } catch (e: Exception) {
            // Dosya bütünüyle bozuksa üzerine yazmadan önce yedeğini al.
            Log.w(TAG, "Sohbet geçmişi okunamadı: ${f.name}", e)
            runCatching { f.copyTo(File(dir, f.name + ".corrupt"), overwrite = true) }
            return emptyList()
        }
        val bad = mutableListOf<JsonElement>()
        val chats = array.mapNotNull { element ->
            try {
                json.decodeFromJsonElement<StoredChat>(element)
            } catch (e: Exception) {
                Log.w(TAG, "Okunamayan sohbet atlandı: ${f.name}", e)
                bad += element
                null
            }
        }
        unreadable = bad
        return chats
    }

    private fun write(list: List<StoredChat>) {
        dir.mkdirs()
        // Yarım yazılmış dosya bırakmamak için önce geçici dosyaya yaz.
        val tmp = File(dir, file().name + ".tmp")
        tmp.writeText(json.encodeToString(JsonArray(list.map { json.encodeToJsonElement(it) } + unreadable)))
        if (!tmp.renameTo(file())) {
            file().delete()
            tmp.renameTo(file())
        }
    }

    companion object {
        private const val TAG = "ChatHistory"
        private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true }

        /** historyStorage.ts `getHistoryKey`: e-posta varsa ona, yoksa misafire özel. */
        fun fileNameFor(email: String?): String {
            val key = if (email.isNullOrBlank()) "chat_history_guest" else "chat_history_$email"
            return key.replace(Regex("[^A-Za-z0-9@._-]"), "_") + ".json"
        }
    }
}
