package com.tyler.kocamind.data.queue

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File
import kotlin.random.Random

/** offlineQueue.ts `QueuedMessage`: hangi hesaba ve hangi sohbete ait olduğu bellidir. */
@Serializable
data class QueuedMessage(
    val id: String,
    val content: String,
    val timestamp: Long,
    val ownerId: String,
    val chatId: String,
)

/** İnternet yokken gönderilemeyen mesajlar. Bağlantı gelince sohbet ekranı sırayla gönderir. */
interface OfflineQueue {
    /** Kuyruk her değiştiğinde artar; sayaçları yenilemek için. */
    val version: StateFlow<Int>
    suspend fun all(): List<QueuedMessage>
    suspend fun enqueue(content: String, ownerId: String, chatId: String, now: Long): QueuedMessage
    suspend fun dequeue(id: String)
    suspend fun count(ownerId: String?): Int = if (ownerId == null) 0 else all().count { it.ownerId == ownerId }
}

open class InMemoryOfflineQueue : OfflineQueue {
    protected val lock = Mutex()
    protected var items: List<QueuedMessage> = emptyList()
    private val changes = MutableStateFlow(0)
    override val version: StateFlow<Int> = changes

    override suspend fun all(): List<QueuedMessage> = lock.withLock { items }

    override suspend fun enqueue(content: String, ownerId: String, chatId: String, now: Long): QueuedMessage {
        val item = QueuedMessage(
            id = "q_${now}_${Random.nextInt(0, Int.MAX_VALUE).toString(36).take(6)}",
            content = content,
            timestamp = now,
            ownerId = ownerId,
            chatId = chatId,
        )
        lock.withLock {
            items = items + item
            persist(items)
        }
        changes.value++
        return item
    }

    override suspend fun dequeue(id: String) {
        lock.withLock {
            items = items.filter { it.id != id }
            persist(items)
        }
        changes.value++
    }

    protected open suspend fun persist(list: List<QueuedMessage>) = Unit
}

/** AsyncStorage `offline_message_queue` karşılığı; uygulama kapansa da kuyruk kalır. */
class FileOfflineQueue(dir: File) : InMemoryOfflineQueue() {
    private val file = File(dir, "offline_message_queue.json")
    private val json = Json { ignoreUnknownKeys = true }

    init {
        items = runCatching { json.decodeFromString<List<QueuedMessage>>(file.readText()) }
            .getOrDefault(emptyList())
            // Hesaba ya da sohbete bağlı olmayan eski kayıtlar gönderilmez.
            .filter { it.ownerId.isNotBlank() && it.chatId.isNotBlank() }
    }

    override suspend fun persist(list: List<QueuedMessage>) = withContext(Dispatchers.IO) {
        file.parentFile?.mkdirs()
        file.writeText(json.encodeToString(list))
    }
}
