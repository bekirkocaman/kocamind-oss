package com.tyler.kocamind.data.sync

/** Bellek içi `users/{uid}/chats`. [failWrites] ağ yokmuş gibi yazma/silmeyi düşürür. */
class FakeCloudChatApi : CloudChatApi {
    val docs = mutableMapOf<String, MutableMap<String, Map<String, Any?>>>()
    var failWrites = false
    private val listeners = mutableMapOf<String, MutableList<(List<Pair<String, Map<String, Any?>>>) -> Unit>>()

    fun docsOf(uid: String): MutableMap<String, Map<String, Any?>> = docs.getOrPut(uid) { mutableMapOf() }

    override suspend fun list(uid: String) = docs[uid].orEmpty().map { it.key to it.value }

    override suspend fun delete(uid: String, chatId: String) {
        if (failWrites) throw RuntimeException("ağ yok")
        docs[uid]?.remove(chatId)
    }

    override suspend fun transact(uid: String, chatId: String, update: (Map<String, Any?>?) -> Map<String, Any?>?) {
        if (failWrites) throw RuntimeException("ağ yok")
        update(docs[uid]?.get(chatId))?.let { docsOf(uid)[chatId] = it }
    }

    override fun listen(uid: String, onChange: (List<Pair<String, Map<String, Any?>>>) -> Unit): AutoCloseable {
        listeners.getOrPut(uid) { mutableListOf() } += onChange
        return AutoCloseable { listeners[uid]?.remove(onChange) }
    }

    /** Başka bir cihaz yazmış gibi belgeyi değiştirir ve dinleyicilere bildirir. */
    fun remoteWrite(uid: String, chatId: String, data: Map<String, Any?>) {
        docsOf(uid)[chatId] = data
        emit(uid)
    }

    fun remoteDelete(uid: String, chatId: String) {
        docs[uid]?.remove(chatId)
        emit(uid)
    }

    fun emit(uid: String) {
        val snapshot = snapshotOf(uid)
        listeners[uid].orEmpty().toList().forEach { it(snapshot) }
    }

    private fun snapshotOf(uid: String) = docs[uid].orEmpty().map { it.key to it.value }

    fun listenerCount(uid: String) = listeners[uid]?.size ?: 0
}

class MemoryPendingOps : PendingOpsStore {
    val map = mutableMapOf<String, PendingOps>()
    override fun load(uid: String) = map[uid] ?: PendingOps()
    override fun save(uid: String, ops: PendingOps) { map[uid] = ops }
}
