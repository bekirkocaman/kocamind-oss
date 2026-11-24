package com.tyler.kocamind.data.sync

import android.content.Context
import android.util.Log
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.MetadataChanges
import com.tyler.kocamind.data.chat.ChatStore
import com.tyler.kocamind.data.chat.StoredChat
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.tasks.await
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** `users/{uid}/chats` koleksiyonu (testte sahtesi kullanılır). */
interface CloudChatApi {
    suspend fun list(uid: String): List<Pair<String, Map<String, Any?>>>
    suspend fun delete(uid: String, chatId: String)

    /**
     * Belgeyi işlem içinde okur ve [update]'in döndürdüğünü yazar (null: yazma). Başka bir cihaz arada
     * yazarsa işlem yeniden denenir; böylece kimse ötekinin yazdığını ezemez. Çevrimdışıyken hata verir.
     */
    suspend fun transact(uid: String, chatId: String, update: (Map<String, Any?>?) -> Map<String, Any?>?)

    /** Koleksiyonun sunucudan gelen her yeni hâlini bildirir. */
    fun listen(uid: String, onChange: (List<Pair<String, Map<String, Any?>>>) -> Unit): AutoCloseable
}

class FirestoreCloudChatApi(private val db: FirebaseFirestore) : CloudChatApi {
    private fun chats(uid: String) = db.collection("users").document(uid).collection("chats")
    override suspend fun list(uid: String) = chats(uid).get().await().documents.map { it.id to (it.data ?: emptyMap()) }
    override suspend fun delete(uid: String, chatId: String) {
        chats(uid).document(chatId).delete().await()
    }

    override suspend fun transact(uid: String, chatId: String, update: (Map<String, Any?>?) -> Map<String, Any?>?) {
        val ref = chats(uid).document(chatId)
        db.runTransaction { tx ->
            val snap = tx.get(ref)
            update(if (snap.exists()) snap.data else null)?.let { tx.set(ref, it) }
            null
        }.await()
    }

    override fun listen(uid: String, onChange: (List<Pair<String, Map<String, Any?>>>) -> Unit): AutoCloseable {
        val registration = chats(uid).addSnapshotListener(MetadataChanges.INCLUDE) { snap, error ->
            if (error != null) Log.w(TAG, "Sohbet dinleyicisi hata verdi", error)
            // Önbellekten gelen hâl eski olabilir; silinmiş sohbeti geri getirmesin diye yalnız sunucu hâli işlenir.
            if (snap == null || snap.metadata.isFromCache || snap.metadata.hasPendingWrites()) return@addSnapshotListener
            onChange(snap.documents.map { it.id to (it.data ?: emptyMap()) })
        }
        return AutoCloseable { registration.remove() }
    }

    private companion object {
        const val TAG = "CloudChatApi"
    }
}

/** Bulut yazılamadığında sonra denenecek işlemler (AsyncStorage `chat_sync_pending_<uid>`). */
@Serializable
data class PendingOps(val upserts: List<String> = emptyList(), val deletes: List<String> = emptyList())

interface PendingOpsStore {
    fun load(uid: String): PendingOps
    fun save(uid: String, ops: PendingOps)
}

class PrefsPendingOpsStore(context: Context) : PendingOpsStore {
    private val prefs = context.getSharedPreferences("kocamind_sync", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }
    override fun load(uid: String): PendingOps =
        prefs.getString("chat_sync_pending_$uid", null)?.let { runCatching { json.decodeFromString<PendingOps>(it) }.getOrNull() } ?: PendingOps()
    override fun save(uid: String, ops: PendingOps) {
        prefs.edit().putString("chat_sync_pending_$uid", json.encodeToString(ops)).apply()
    }
}

/** Her sohbetin bulutla en son anlaşılan hâli ([SyncBase]); üç yönlü birleştirmenin tabanı. */
interface SyncBaseStore {
    fun load(uid: String): Map<String, SyncBase>
    fun save(uid: String, bases: Map<String, SyncBase>)
}

class PrefsSyncBaseStore(context: Context) : SyncBaseStore {
    private val prefs = context.getSharedPreferences("kocamind_sync", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }
    override fun load(uid: String): Map<String, SyncBase> =
        prefs.getString("chat_sync_base_$uid", null)?.let { runCatching { json.decodeFromString<Map<String, SyncBase>>(it) }.getOrNull() }
            ?: emptyMap()
    override fun save(uid: String, bases: Map<String, SyncBase>) {
        prefs.edit().putString("chat_sync_base_$uid", json.encodeToString(bases)).apply()
    }
}

class MemorySyncBaseStore : SyncBaseStore {
    private val map = mutableMapOf<String, Map<String, SyncBase>>()
    override fun load(uid: String) = map[uid].orEmpty()
    override fun save(uid: String, bases: Map<String, SyncBase>) { map[uid] = bases }
}

/**
 * chatCloudSync.ts: işlemle yazma, silme, üç yönlü birleştirme ve dinleme
 * (docs/superpowers/specs/2026-10-18-sohbet-esitleme-design.md).
 */
class CloudChatSync(
    private val api: CloudChatApi,
    private val pending: PendingOpsStore,
    private val bases: SyncBaseStore,
) {
    /** Bekleyen işlem ve taban kayıtlarını korur. */
    private val lock = Mutex()
    /** Yazma ve eşitlemeleri sıraya koyar: biri bitmeden öbürü tabanı okumasın. */
    private val syncLock = Mutex()

    private suspend fun updatePending(uid: String, change: (PendingOps) -> PendingOps) = lock.withLock {
        val next = change(pending.load(uid))
        pending.save(uid, PendingOps(next.upserts.distinct(), next.deletes.distinct()))
    }

    private suspend fun updateBases(uid: String, change: (Map<String, SyncBase>) -> Map<String, SyncBase>) = lock.withLock {
        bases.save(uid, change(bases.load(uid)))
    }

    /**
     * Sohbeti buluttaki hâliyle işlem içinde birleştirip yazar. Başarılıysa birleşik hâli döndürür;
     * yerel kopya buna güncellenmeli (başka cihazdan gelen mesajlar). Başarısızsa null; sonra yeniden denenir.
     */
    suspend fun push(uid: String, chat: StoredChat): StoredChat? = syncLock.withLock { pushLocked(uid, chat) }

    private suspend fun pushLocked(uid: String, chat: StoredChat): StoredChat? = try {
        val base = bases.load(uid)[chat.id]
        var merged = chat
        api.transact(uid, chat.id) { raw ->
            val cloud = raw?.let { fromCloudChat(chat.id, it) }
            merged = if (cloud == null) chat else mergeChat(chat, cloud, base)
            if (cloud != null && sameInCloud(merged, cloud)) null else toCloudChat(merged, preserve = raw)
        }
        updateBases(uid) { it + (chat.id to baseOf(merged)) }
        updatePending(uid) { it.copy(upserts = it.upserts - chat.id) }
        merged
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        Log.w(TAG, "Sohbet buluta yazılamadı, sonra tekrar denenecek", e)
        updatePending(uid) { it.copy(upserts = it.upserts + chat.id) }
        null
    }

    suspend fun deleteCloud(uid: String, chatId: String): Boolean = syncLock.withLock { deleteCloudLocked(uid, chatId) }

    private suspend fun deleteCloudLocked(uid: String, chatId: String): Boolean {
        updatePending(uid) { PendingOps(it.upserts - chatId, it.deletes + chatId) }
        return try {
            api.delete(uid, chatId)
            updatePending(uid) { it.copy(deletes = it.deletes - chatId) }
            updateBases(uid) { it - chatId }
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(TAG, "Sohbet buluttan silinemedi, sonra tekrar denenecek", e)
            false
        }
    }

    /** Ayarlar > Sohbet Geçmişini Temizle: buluttaki bütün sohbetleri siler. */
    suspend fun deleteAll(uid: String) = syncLock.withLock {
        api.list(uid).forEach { (id, _) -> api.delete(uid, id) }
        lock.withLock {
            pending.save(uid, PendingOps())
            bases.save(uid, emptyMap())
        }
    }

    /**
     * Bekleyen silmeleri dener, bulutla yereli üç yönlü birleştirir ve farklı olanları yazar.
     * [stillOwner] false dönerse (hesap değişti) yerel depoya dokunulmaz.
     */
    suspend fun sync(uid: String, local: ChatStore, stillOwner: () -> Boolean = { true }) = syncLock.withLock {
        pending.load(uid).deletes.forEach { deleteCloudLocked(uid, it) }
        applyLocked(uid, local, api.list(uid), stillOwner)
    }

    /** Dinleyiciden gelen koleksiyonu yerelle birleştirir. */
    suspend fun applyRemote(uid: String, local: ChatStore, docs: List<Pair<String, Map<String, Any?>>>, stillOwner: () -> Boolean = { true }) =
        syncLock.withLock { applyLocked(uid, local, docs, stillOwner) }

    /** Giriş yapılıyken bulut değişikliklerini dinler; kapatılınca durur. */
    fun listen(uid: String, local: ChatStore, scope: CoroutineScope, stillOwner: () -> Boolean = { true }): AutoCloseable =
        api.listen(uid) { docs ->
            scope.launch {
                try {
                    applyRemote(uid, local, docs, stillOwner)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Log.w(TAG, "Uzaktan gelen sohbetler işlenemedi", e)
                }
            }
        }

    private suspend fun applyLocked(uid: String, local: ChatStore, docs: List<Pair<String, Map<String, Any?>>>, stillOwner: () -> Boolean) {
        if (!stillOwner()) return
        val before = local.all()
        val plan = planSync(before, docs.map { (id, data) -> fromCloudChat(id, data) }, bases.load(uid), pending.load(uid).deletes.toSet())
        plan.deleteCloud.forEach { deleteCloudLocked(uid, it) }
        val finals = plan.chats.map { chat -> if (chat.id in plan.upload) pushLocked(uid, chat) ?: chat else chat }
        updateBases(uid) { it - plan.forget + plan.agreed }
        updatePending(uid) { it.copy(upserts = it.upserts - plan.agreed.keys) }
        if (!stillOwner()) return
        // Ağ işlemleri sürerken kullanıcının yaptığı değişiklik korunur; kendi yazması onu birleştirir.
        val now = local.all()
        val beforeById = before.associateBy { it.id }
        val nowById = now.associateBy { it.id }
        val finalIds = finals.mapTo(HashSet()) { it.id }
        val result = mutableListOf<StoredChat>()
        for (chat in finals) {
            val was = beforeById[chat.id]
            val current = nowById[chat.id]
            when {
                was != null && current == null -> Unit // bu arada silindi
                current != null && current != was -> result += current
                else -> result += chat
            }
        }
        for (current in now) {
            val was = beforeById[current.id]
            if (current.id !in finalIds && (was == null || current != was)) result += current
        }
        if (result.toSet() != now.toSet()) local.replaceAll(result.sortedByDescending { toMillis(it.updatedAt) })
    }

    private companion object {
        const val TAG = "CloudChatSync"
    }
}
