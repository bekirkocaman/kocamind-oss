package com.tyler.kocamind.data.memory

import android.content.Context
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import java.io.File

/** Backend hafıza uçları (BackendClient uygular). */
interface MemoryApi {
    suspend fun listMemories(): List<Memory>
    suspend fun extractMemories(message: String): ExtractResult
    suspend fun deleteMemory(key: String?)
    suspend fun summarizeConversation(previous: String?, messages: List<SummaryMessage>): String?
    suspend fun importMemories(text: String): ImportResult
    suspend fun memoryInsight(refresh: Boolean): MemoryInsight
}

/** `/memory/extract` sonucu: yeni kaydedilen anahtarlar ve unutulan kayıt sayısı. */
/** [savedKeys] yalnızca yeni kayıtlar ("Geri al" bunları siler); [updated] var olanı değiştirilen kayıt sayısı. */
data class ExtractResult(val savedKeys: List<String>, val forgotten: Int, val updated: Int = 0)

/** Sohbet ekranının hafızadan kullandığı kısım. */
interface ChatMemorySource {
    /** Soruyla ilgili hafızaların sistem istemine eklenecek metni; hafıza kapalıysa boş. */
    fun promptFor(text: String): String

    /** Mesajdaki kişisel bilgiyi arka planda hafızaya alır; yeni kayıt olursa [onSaved] anahtarlarla çağrılır. */
    fun rememberInBackground(text: String, onSaved: (List<String>) -> Unit = {})

    /** "Geri al": kayıtları siler; biri silinemezse false. */
    suspend fun forget(keys: List<String>): Boolean = false

    /** Sohbetin eski kısmının özeti; alınamazsa null. */
    suspend fun summarize(previous: String?, messages: List<SummaryMessage>): String?
}

object NoChatMemory : ChatMemorySource {
    override fun promptFor(text: String) = ""
    override fun rememberInBackground(text: String, onSaved: (List<String>) -> Unit) = Unit
    override suspend fun summarize(previous: String?, messages: List<SummaryMessage>): String? = null
}

/** Ayarlar > Hafıza anahtarları. Web ile aynı adlar: `memory_enabled`, `auto_memory`. */
class MemoryPrefs(context: Context) {
    private val prefs = context.getSharedPreferences("kocamind", Context.MODE_PRIVATE)
    private val enabledState = MutableStateFlow(prefs.getBoolean(ENABLED, true))
    private val autoState = MutableStateFlow(prefs.getBoolean(AUTO, true))

    /** Hafıza cevaplarda kullanılsın mı. */
    val enabled: StateFlow<Boolean> = enabledState.asStateFlow()

    /** Yeni bilgiler mesajlardan otomatik hatırlansın mı. */
    val autoSave: StateFlow<Boolean> = autoState.asStateFlow()

    fun setEnabled(on: Boolean) {
        prefs.edit().putBoolean(ENABLED, on).apply()
        enabledState.value = on
    }

    fun setAutoSave(on: Boolean) {
        prefs.edit().putBoolean(AUTO, on).apply()
        autoState.value = on
    }

    private companion object {
        const val ENABLED = "memory_enabled"
        const val AUTO = "auto_memory"
    }
}

/**
 * Firestore `users/{uid}/memories` listesinin cihazdaki kopyası. İnternet yokken (yerel model) ve
 * uygulama yeniden açıldığında hafıza buradan gelir; doğru kaynak her zaman buluttur.
 */
interface MemoryCache {
    suspend fun load(uid: String): List<Memory>?
    suspend fun save(uid: String, memories: List<Memory>)
    suspend fun delete(uid: String)
}

object NoMemoryCache : MemoryCache {
    override suspend fun load(uid: String): List<Memory>? = null
    override suspend fun save(uid: String, memories: List<Memory>) = Unit
    override suspend fun delete(uid: String) = Unit
}

/** Kullanıcı başına uygulamanın özel klasöründe bir JSON dosyası. */
class FileMemoryCache(private val dir: File) : MemoryCache {
    private val json = Json { ignoreUnknownKeys = true }
    private fun file(uid: String) = File(dir, "memories_${uid.replace(Regex("[^A-Za-z0-9_-]"), "_")}.json")

    override suspend fun load(uid: String): List<Memory>? = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
        runCatching { json.decodeFromString<List<Memory>>(file(uid).readText()) }.getOrNull()
    }

    override suspend fun save(uid: String, memories: List<Memory>) = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
        dir.mkdirs()
        val tmp = File(dir, file(uid).name + ".tmp")
        tmp.writeText(json.encodeToString(memories))
        if (!tmp.renameTo(file(uid))) {
            file(uid).delete()
            tmp.renameTo(file(uid))
        }
        Unit
    }

    override suspend fun delete(uid: String) = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
        file(uid).delete()
        Unit
    }
}

/** Kullanıcı hafızasının önbelleği ve işlemleri. Hata kullanıcıyı engellemez; hafıza sessizce devre dışı kalır. */
class MemoryRepository(
    private val api: MemoryApi,
    val prefs: MemoryPrefs,
    private val scope: CoroutineScope,
    private val cache: MemoryCache = NoMemoryCache,
) : ChatMemorySource {
    private val state = MutableStateFlow<List<Memory>?>(null)
    private val lock = Mutex()
    /** Listenin ait olduğu kullanıcı; önbelleğe yalnız onun adına yazılır. */
    @Volatile private var owner: String? = null

    /** null: henüz yüklenmedi. */
    val memories: StateFlow<List<Memory>?> = state.asStateFlow()

    /**
     * Oturum değişti: önceki kullanıcının hafızası unutulur, yeninin cihazdaki kopyası hemen yüklenir,
     * sonra buluttan yenilenir (çevrimdışıysa cihazdaki kopya kalır).
     */
    suspend fun switchUser(uid: String?) {
        lock.withLock {
            owner = uid
            state.value = uid?.let { cache.load(it) }
        }
        if (uid != null) refresh()
    }

    /** Hesap silindi: cihazdaki kopya da silinir. */
    suspend fun forget(uid: String) {
        lock.withLock {
            cache.delete(uid)
            if (owner == uid) state.value = null
        }
    }

    private suspend fun publish(uid: String?, list: List<Memory>) = lock.withLock {
        if (uid != owner) return@withLock
        state.value = list
        uid?.let { cache.save(it, list) }
    }

    /** Listeyi backend'den yeniler; başarısızsa eldeki liste korunur ve false döner. */
    suspend fun refresh(): Boolean {
        val uid = owner
        return try {
            publish(uid, api.listMemories())
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            false
        }
    }

    suspend fun delete(key: String) {
        val uid = owner
        api.deleteMemory(key)
        publish(uid, state.value.orEmpty().filterNot { it.key == key })
    }

    suspend fun deleteAll() {
        val uid = owner
        api.deleteMemory(null)
        publish(uid, emptyList())
    }

    /** Başka uygulamadan kopyalanan dökümü içe aktarır ve listeyi yeniler. Hata çağırana iletilir. */
    suspend fun importText(text: String): ImportResult {
        val result = api.importMemories(text)
        refresh()
        return result
    }

    /** Hafızaya dayanan objektif yorum; alınamazsa null. */
    suspend fun insight(refresh: Boolean): MemoryInsight? = try {
        api.memoryInsight(refresh)
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        null
    }

    /** Bellekteki listeyi unutur (cihazdaki kopya kalır). */
    fun clear() {
        state.value = null
    }

    override fun promptFor(text: String): String {
        if (!prefs.enabled.value) return ""
        return formatMemoriesForPrompt(selectRelevantMemories(state.value.orEmpty(), text))
    }

    override fun rememberInBackground(text: String, onSaved: (List<String>) -> Unit) {
        if (!prefs.enabled.value || !prefs.autoSave.value || text.isBlank()) return
        scope.launch {
            val result = try {
                api.extractMemories(text)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                null
            } ?: return@launch
            if (result.savedKeys.isEmpty() && result.forgotten == 0 && result.updated == 0) return@launch
            refresh()
            if (result.savedKeys.isNotEmpty()) onSaved(result.savedKeys)
        }
    }

    override suspend fun forget(keys: List<String>): Boolean = try {
        keys.forEach { delete(it) }
        true
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        false
    }

    override suspend fun summarize(previous: String?, messages: List<SummaryMessage>): String? = try {
        api.summarizeConversation(previous, messages)
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        null
    }
}
