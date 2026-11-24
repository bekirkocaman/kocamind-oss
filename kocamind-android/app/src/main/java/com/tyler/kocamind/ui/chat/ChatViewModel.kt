package com.tyler.kocamind.ui.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.tyler.kocamind.data.auth.AuthRepository
import com.tyler.kocamind.data.auth.AuthUser
import com.tyler.kocamind.data.backend.AgentCallbacks
import com.tyler.kocamind.data.backend.AgentRequest
import com.tyler.kocamind.data.backend.ChatBackend
import com.tyler.kocamind.data.backend.ChatHistoryItem
import com.tyler.kocamind.data.backend.ChatStreamRequest
import com.tyler.kocamind.data.backend.FeedbackRequest
import com.tyler.kocamind.data.backend.RemoteModel
import com.tyler.kocamind.data.chat.ChatCommand
import com.tyler.kocamind.data.chat.ChatCommands
import com.tyler.kocamind.data.chat.ChatMessage
import com.tyler.kocamind.data.chat.ChatStore
import com.tyler.kocamind.data.chat.StoredChat
import com.tyler.kocamind.data.memory.ChatMemorySource
import com.tyler.kocamind.data.memory.NoChatMemory
import com.tyler.kocamind.data.memory.SUMMARY_HEADER
import com.tyler.kocamind.data.memory.contextBudgetChars
import com.tyler.kocamind.data.memory.planConversationContext
import com.tyler.kocamind.data.memory.toSummaryMessages
import com.tyler.kocamind.data.backend.QuotaExceededException
import com.tyler.kocamind.data.backend.QuotaState
import com.tyler.kocamind.data.offline.ChatMemoryIndex
import com.tyler.kocamind.data.offline.OfflineModel
import com.tyler.kocamind.data.offline.formatChatMemoriesForPrompt
import com.tyler.kocamind.data.queue.InMemoryOfflineQueue
import com.tyler.kocamind.data.queue.OfflineQueue
import com.tyler.kocamind.data.sync.mergeMessages
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChangedBy
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.job
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Instant

/** Kalıcı sohbet tercihleri (AsyncStorage `kocamind_mobile_model`, `kocamind_mobile_mode`, `custom_instructions_<e-posta>`). */
interface ChatPrefs {
    var selectedModelId: String?
    var assistantMode: String?
    fun customInstructions(email: String?): String
}

/** Seçilen ya da üretilen dosyalar (galeri, kamera, belge, kitaplık). */
interface MediaFiles {
    suspend fun read(uri: String): ByteArray
    /** Üretilen görseli uygulama klasörüne yazar, dosya adresini döner. */
    suspend fun saveGeneratedImage(base64: String, mimeType: String, timestamp: Long): String
    /** Kitaplık ekranında görünsün diye kaydeder (AsyncStorage `library_images`). */
    suspend fun addToLibrary(uri: String, prompt: String?, generated: Boolean)
}

object NoMediaFiles : MediaFiles {
    override suspend fun read(uri: String) = ByteArray(0)
    override suspend fun saveGeneratedImage(base64: String, mimeType: String, timestamp: Long) = ""
    override suspend fun addToLibrary(uri: String, prompt: String?, generated: Boolean) = Unit
}

/** Telefondaki yerel model (gerçeği: OfflineAiService). */
interface LocalAi {
    /** İndirme / silme / seçim değiştikçe artar. */
    val changes: StateFlow<Int>
    fun downloadedModels(): List<OfflineModel>
    fun selectedModelId(): String
    suspend fun select(id: String, preserveAutoMode: Boolean = false)
    suspend fun generate(history: List<Pair<String, String>>, onPartial: (String) -> Unit, customInstructions: String?, memoryContext: String?): String
    fun stop()
}

object NoLocalAi : LocalAi {
    override val changes: StateFlow<Int> = MutableStateFlow(0)
    override fun downloadedModels() = emptyList<OfflineModel>()
    override fun selectedModelId() = ""
    override suspend fun select(id: String, preserveAutoMode: Boolean) = Unit
    override suspend fun generate(history: List<Pair<String, String>>, onPartial: (String) -> Unit, customInstructions: String?, memoryContext: String?) =
        throw IllegalStateException("OFFLINE_MODEL_NOT_READY")
    override fun stop() = Unit
}

/** chatTypes.ts `AssistantMode` + `MODE_INFO`. */
enum class AssistantMode(val id: String, val title: String, val subtitle: String) {
    Chat("chat", "Normal sohbet", "Hızlı cevap ve gerektiğinde gerçek web araması"),
    DeepResearch("deep_research", "Derin araştırma", "Birden fazla kaynağı karşılaştırıp raporlar"),
    Agent("agent", "Agent modu", "Görevi planlar ve araçlarla adım adım tamamlar");

    companion object {
        fun fromId(id: String?) = entries.firstOrNull { it.id == id } ?: Chat
    }
}

enum class MediaKind { Image, Video }

/** Seçilen fotoğraf ya da dosya. */
data class Attachment(val uri: String, val mimeType: String, val name: String)

enum class Feedback { Up, Down }

enum class ChatAlertAction { OpenOfflineModels }

sealed interface ChatEvent {
    data class Alert(val title: String, val message: String, val action: ChatAlertAction? = null) : ChatEvent
    data class Toast(val text: String) : ChatEvent

    /** Hafızaya yeni bilgi kaydedildi; ekran "Geri al" eylemli bildirim gösterir. */
    data class MemorySaved(val keys: List<String>) : ChatEvent

    /** Agent bir işlem için onay istiyor; [answer] tamamlanınca devam eder. */
}

data class ChatUiState(
    val messages: List<ChatMessage> = emptyList(),
    /** Agent'ın onay beklediği işlem (soru metni); ekran yeniden oluşsa da korunur. */
    val approval: String? = null,
    val chatId: String? = null,
    val isLoading: Boolean = false,
    val models: List<RemoteModel> = emptyList(),
    val selectedModel: RemoteModel? = null,
    val userName: String = "",
    val signedIn: Boolean = false,
    val feedbacks: Map<String, Feedback> = emptyMap(),
    val pendingFeedback: FeedbackRequest? = null,
    val isOnline: Boolean = true,
    /** Bu hesabın kuyrukta bekleyen mesaj sayısı. */
    val queuedCount: Int = 0,
    val mode: AssistantMode = AssistantMode.Chat,
    val selectedImage: Attachment? = null,
    val selectedDocument: Attachment? = null,
    /** Boş ekran karşılamasını yeniden canlandırmak için (yeni sohbet). */
    val emptyEpoch: Int = 0,
    /** "+" panelindeki Derin düşünce anahtarı; bulut modellerinde geçerli. */
    val deepThink: Boolean = false,
    /** Son bulut cevabındaki kalan günlük hak (mesaj kutusunun üstündeki satır). */
    val quota: QuotaState? = null,
    /** Günlük hak bitti; bu ana (UTC gece yarısı, epoch ms) kadar hata balonu yerine geri sayım gösterilir. */
    val quotaExhaustedUntil: Long? = null,
    /** Gizli sohbet: yalnızca yerel model, kayıt/eşitleme/hafıza çıkarımı yok. Yalnızca boş sohbette açılır. */
    val privateChat: Boolean = false,
) {
    fun canSend(input: String) = input.isNotBlank() || selectedImage != null || selectedDocument != null

    val isLocalSelected: Boolean get() = selectedModel?.provider == "local"

    val quotaExhausted: Boolean get() = quotaExhaustedUntil != null
}

/** Kota UTC gece yarısı yenilenir; [nowMs] sonrasındaki ilk gece yarısı (epoch ms). */
fun nextUtcMidnight(nowMs: Long): Long = (nowMs / 86_400_000L + 1) * 86_400_000L

/** Web `prompts.js` HONESTY_RULE ile aynı metin: emin olmadığında söyle, uydurma. */
const val HONESTY_RULE =
    "Bilmediğin ya da emin olmadığın bir konuda bunu açıkça söyle (\"Emin değilim\" de), tahmini tahmin olarak belirt; kaynak, rakam, tarih veya alıntı uydurma."

/** chatModels.ts `LOCAL_MODEL_PLACEHOLDER`: yerel model indirilmemişken listede görünür. */
val LOCAL_MODEL_PLACEHOLDER = RemoteModel(
    id = "kocamind-local",
    provider = "local",
    providerName = "Bu cihaz",
    label = "Yerel AI",
    badge = "Model indir",
    available = false,
)

const val LEGACY_LOCAL_MODEL_ID = "kocamind-local"
const val LOCAL_MODEL_PREFIX = "$LEGACY_LOCAL_MODEL_ID:"

/** chatModels.ts `toLocalModelOption`. */
fun toLocalModelOption(model: OfflineModel) = RemoteModel(
    id = LOCAL_MODEL_PREFIX + model.id,
    provider = "local",
    providerName = "Bu cihaz",
    label = model.name,
    badge = "Telefonda hazır",
    available = true,
)

fun offlineModelIdOf(model: RemoteModel): String? = model.id.takeIf { it.startsWith(LOCAL_MODEL_PREFIX) }?.removePrefix(LOCAL_MODEL_PREFIX)

/** chatModels.ts `resolveSelectedModel`. */
fun resolveSelectedModel(
    options: List<RemoteModel>,
    remote: List<RemoteModel>,
    storedId: String?,
    selectedOfflineId: String = "",
): RemoteModel? {
    options.firstOrNull { it.id == storedId }?.takeIf { it.available }?.let { return it }
    val selectedLocal = options.firstOrNull { it.id == LOCAL_MODEL_PREFIX + selectedOfflineId }
    if (storedId == LEGACY_LOCAL_MODEL_ID && selectedLocal != null) return selectedLocal
    return remote.firstOrNull { it.isDefault }
        ?: remote.firstOrNull()
        ?: selectedLocal
        ?: options.firstOrNull { it.provider == "local" && it.available }
}

/** kocamind-mobil/src/app/index.tsx ekran mantığı. */
class ChatViewModel(
    private val auth: AuthRepository,
    private val backend: ChatBackend,
    private val store: ChatStore,
    private val commands: ChatCommands,
    private val prefs: ChatPrefs,
    private val network: StateFlow<Boolean> = MutableStateFlow(true),
    private val queue: OfflineQueue = InMemoryOfflineQueue(),
    /** Bulut eşitlemesi (chatCloudSync.ts `syncChatsWithCloud`). */
    private val cloudSync: suspend (uid: String) -> Unit = {},
    /** Giriş yapılıyken başka cihazlardan gelen sohbet değişikliklerini dinler; kapatılınca durur. */
    private val cloudWatch: (uid: String) -> AutoCloseable? = { null },
    private val media: MediaFiles = NoMediaFiles,
    private val localAi: LocalAi = NoLocalAi,
    /** Bulut hafızası: ilgili bilgiler isteme eklenir, yeni bilgiler sessizce kaydedilir, uzun sohbet özetlenir. */
    private val memory: ChatMemorySource = NoChatMemory,
    private val now: () -> Long = System::currentTimeMillis,
    /** Sohbet değişirken / ekran kapanırken yapılan son kayıt bu kapsamda yaşar (uygulama kapsamı). */
    saveScope: CoroutineScope? = null,
) : ViewModel() {
    private val saveScope: CoroutineScope = saveScope ?: viewModelScope

    private val _state = MutableStateFlow(ChatUiState(mode = AssistantMode.Chat))
    val state: StateFlow<ChatUiState> = _state

    private val _input = MutableStateFlow("")
    val input: StateFlow<String> = _input

    private val _events = Channel<ChatEvent>(Channel.BUFFERED)
    val events: Flow<ChatEvent> = _events.receiveAsFlow()

    private var user: AuthUser? = null
    /** Ekrandaki süren işlem (gönderme, üretim, kuyruktan gönderme). Durdur yalnız bunu keser. */
    private var streamJob: Job? = null
    private var flushJob: Job? = null
    private var saveJob: Job? = null
    private var approvalAnswer: CompletableDeferred<Boolean>? = null
    private val persistedIds = mutableSetOf<String>()
    private val uid = MutableStateFlow<String?>(null)
    private val feedbackSendLock = Mutex()
    private var feedbackAccountJob: Job? = null
    private var cloudWatcher: AutoCloseable? = null
    /**
     * Açık sohbetin depodaki hâlinden bilinen mesaj kimlikleri. Ekran kaydederken depoda olup ekranın
     * hiç görmediği mesajlar (başka cihazdan gelen) korunur, ekranın kaldırdıkları silinir.
     */
    private var openBase: Set<String>? = null

    init {
        viewModelScope.launch {
            auth.currentUser.distinctUntilChangedBy { it?.takeIf { u -> u.emailVerified }?.uid }.collect { current ->
                val verified = current?.takeIf { it.emailVerified }
                if (verified?.uid != uid.value) {
                    leaveAccount()
                    feedbackAccountJob = verified?.let { Job(viewModelScope.coroutineContext.job) }
                }
                user = verified
                uid.value = verified?.uid
                _state.update {
                    it.copy(
                        signedIn = verified != null,
                        userName = verified?.let { u -> u.displayName?.takeIf { n -> n.isNotBlank() } ?: u.email?.substringBefore('@') } ?: "",
                    )
                }
                store.setOwner(verified?.email)
                cloudWatcher = verified?.let { cloudWatch(it.uid) }
                loadModels()
            }
        }
        viewModelScope.launch {
            queue.version.combine(uid) { _, owner -> owner }.collect { owner ->
                _state.update { it.copy(queuedCount = queue.count(owner)) }
            }
        }
        viewModelScope.launch {
            // Bağlantı gelince (ya da çevrimiçiyken giriş yapılınca) önce bulutu eşitle, sonra kuyruğu gönder.
            network.combine(uid) { online, owner -> online to owner }.collect { (online, owner) ->
                _state.update { it.copy(isOnline = online) }
                // Ayrı işte: gönderim sürerken bağlantı durumu güncellenmeye devam etsin.
                if (online && owner != null && flushJob?.isActive != true) {
                    flushJob = viewModelScope.launch { syncAndFlush(owner) }
                }
            }
        }
        viewModelScope.launch {
            _state.map { it.chatId }.distinctUntilChanged().collect { commands.setOpenChat(it) }
        }
        viewModelScope.launch {
            commands.commands.collect { command ->
                when (command) {
                    ChatCommand.NewChat -> clearChat()
                    is ChatCommand.LoadChat -> loadChat(command.id)
                }
            }
        }
        viewModelScope.launch {
            // offlineAI.ts `offline_model_changed`: indirme/silme sonrası yerel seçenekleri yenile.
            localAi.changes.drop(1).collect { refreshLocalModels() }
        }
        viewModelScope.launch {
            store.chats.collect { list ->
                val id = _state.value.chatId ?: return@collect
                // Açık sohbet drawer'dan silindiyse ekranı temizle (eski `chat_deleted` olayı).
                if (list != null && id in persistedIds && list.none { it.id == id }) {
                    persistedIds -= id
                    clearChat()
                    return@collect
                }
                // Açık sohbet depoda dışarıdan değiştiyse (başka cihaz) ekrana yansıt.
                if (list?.any { it.id == id } == true) absorbStoredChat(id)
            }
        }
    }

    // ------------------------------------------------------------------ giriş alanı, mod, ekler

    fun setInput(value: String) {
        _input.value = value
    }

    fun setMode(mode: AssistantMode) {
        _state.update { it.copy(mode = mode) }
        prefs.assistantMode = mode.id
    }

    fun attachImage(attachment: Attachment) {
        _state.update { it.copy(selectedImage = attachment) }
        viewModelScope.launch { media.addToLibrary(attachment.uri, prompt = null, generated = false) }
    }

    fun attachDocument(attachment: Attachment) {
        _state.update { it.copy(selectedDocument = attachment) }
    }

    fun removeImage() = _state.update { it.copy(selectedImage = null) }

    fun removeDocument() = _state.update { it.copy(selectedDocument = null) }

    /** Ses kaydını yazıya çevirip giriş alanına ekler. */
    fun transcribe(audio: ByteArray) {
        viewModelScope.launch {
            try {
                val text = backend.transcribeAudio(audio, "audio/m4a")
                if (text.isNotEmpty()) _input.update { if (it.isEmpty()) text else "$it $text" }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _events.trySend(ChatEvent.Alert("Ses çözülemedi", e.message ?: "Ses kaydı işlenemedi."))
            }
        }
    }

    // ------------------------------------------------------------------ modeller

    private suspend fun loadModels() {
        val remote = if (user != null) {
            try {
                backend.getRemoteModels()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                emptyList()
            }
        } else {
            emptyList()
        }
        val local = localAi.downloadedModels().map(::toLocalModelOption)
        val options = local.ifEmpty { listOf(LOCAL_MODEL_PLACEHOLDER) } + remote.filter { it.provider != "local" }
        val selected = resolveSelectedModel(options, remote, prefs.selectedModelId, localAi.selectedModelId())
        _state.update { it.copy(models = options, selectedModel = selected) }
        // Otomatik seçilen yerel modeli yansıtmak otomatik modu kapatmamalı.
        selected?.let(::offlineModelIdOf)?.let { localAi.select(it, preserveAutoMode = true) }
    }

    private fun refreshLocalModels() {
        val local = localAi.downloadedModels().map(::toLocalModelOption)
        val nextLocal = local.firstOrNull { it.id == LOCAL_MODEL_PREFIX + localAi.selectedModelId() } ?: local.firstOrNull()
        _state.update { s ->
            val selected = when {
                s.selectedModel?.provider != "local" -> s.selectedModel
                nextLocal == null -> null.also { prefs.selectedModelId = null }
                else -> nextLocal.also { prefs.selectedModelId = it.id }
            }
            s.copy(
                models = local.ifEmpty { listOf(LOCAL_MODEL_PLACEHOLDER) } + s.models.filter { it.provider != "local" },
                selectedModel = selected,
            )
        }
    }

    fun setDeepThink(on: Boolean) {
        _state.update { it.copy(deepThink = on) }
    }

    fun selectModel(model: RemoteModel) {
        if (model.provider == "local" && !model.available) {
            _events.trySend(
                ChatEvent.Alert(
                    "Önce yerel modeli indir",
                    "İnternetsiz kullanmak istediğin modeli önce telefona indir.",
                    ChatAlertAction.OpenOfflineModels,
                ),
            )
            return
        }
        offlineModelIdOf(model)?.let { id ->
            viewModelScope.launch { localAi.select(id) }
            if (_state.value.mode != AssistantMode.Chat) setMode(AssistantMode.Chat)
        }
        _state.update { it.copy(selectedModel = model) }
        prefs.selectedModelId = model.id
    }

    // ------------------------------------------------------------------ gönderme

    /** Gizli sohbet anahtarı; yerel model yoksa indirme ekranına yönlendirir. */
    fun setPrivateChat(on: Boolean) {
        if (!on) {
            _state.update { it.copy(privateChat = false) }
            return
        }
        if (_state.value.messages.isNotEmpty()) return
        if (localAi.downloadedModels().isEmpty()) {
            _events.trySend(
                ChatEvent.Alert("Yerel model gerekli", "Gizli sohbet telefondaki modelle çalışır. Önce bir model indir.", ChatAlertAction.OpenOfflineModels),
            )
            return
        }
        _state.update { it.copy(privateChat = true) }
    }

    fun send() {
        val s = _state.value
        val text = _input.value.trim()
        if (!s.canSend(text) || s.isLoading) return
        val current = user
        val image = s.selectedImage
        val document = s.selectedDocument
        if (s.isLocalSelected || s.privateChat) {
            if ((!s.privateChat && s.selectedModel?.available != true) || localAi.downloadedModels().isEmpty()) {
                _events.trySend(ChatEvent.Alert("Yerel model hazır değil", "Ayarlar bölümünden bir yerel model indirip seçmelisin."))
                return
            }
            if (image != null || document != null || s.mode != AssistantMode.Chat) {
                _events.trySend(
                    ChatEvent.Alert(
                        "Yerel AI metin sohbeti içindir",
                        "Fotoğraf, dosya, Derin Araştırma ve Agent özellikleri internet bağlantılı modellerle çalışır.",
                    ),
                )
                return
            }
            _input.value = ""
            startOp { sendToOffline(text) }
            return
        }
        if (network.value) {
            if (current == null) {
                _events.trySend(ChatEvent.Alert("Giriş gerekli", "Güvenli sohbet, web arama ve agent özellikleri için hesabına giriş yapmalısın."))
                return
            }
            // Araç seçimi mesajdan: "görsel çiz" fotoğraf, "detaylı araştır" derin araştırma, link/kod agent.
            val routed = if (image == null && document == null) routeIntent(text) else RoutedIntent.Chat
            if (routed is RoutedIntent.Media) {
                _input.value = ""
                generateMedia(routed.kind, text, routed.aspectRatio, userText = text)
                return
            }
            val mode = (routed as? RoutedIntent.Mode)?.mode ?: s.mode
            _input.value = ""
            _state.update { it.copy(selectedImage = null, selectedDocument = null) }
            startOp { sendToCloud(text, image = image, document = document, mode = mode) }
            return
        }
        if (current == null) {
            _events.trySend(ChatEvent.Alert("Giriş gerekli", "İnternet yokken mesajı daha sonra göndermek için hesabına giriş yapmış olmalısın."))
            return
        }
        if (image != null || document != null) {
            _events.trySend(ChatEvent.Alert("İnternet gerekli", "Fotoğraf ve dosyalar yalnızca internet varken gönderilebilir."))
            return
        }
        _input.value = ""
        val ts = now()
        val chatId = _state.value.chatId ?: "chat_$ts"
        _state.update { it.copy(chatId = chatId) }
        viewModelScope.launch {
            queue.enqueue(content = text, ownerId = current.uid, chatId = chatId, now = ts)
            appendMessage(
                ChatMessage(id = "queued_$ts", role = "model", content = "İnternet yok. Mesajın kuyruğa alındı; bağlantı gelince gönderilecek."),
            )
            scheduleSave()
        }
    }

    /** Bulutu eşitler, sonra bu hesabın bekleyen mesajlarını kendi sohbetlerinde sırayla gönderir. */
    private suspend fun syncAndFlush(owner: String) {
        try {
            cloudSync(owner)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // Eşitleme başarısızsa kuyruk yine gönderilmeye çalışılır.
        }
        val pending = queue.all().filter { it.ownerId == owner }
        if (pending.isEmpty()) return
        var sent = 0
        for (message in pending) {
            // Kullanıcının süren cevabı bitmeden açık sohbeti değiştirme.
            _state.first { !it.isLoading }
            if (uid.value != owner || !network.value) break
            openChat(message.chatId)
            val attemptIds = listOf(message.timestamp.toString(), (message.timestamp + 1).toString())
            if (_state.value.messages.none { it.id == attemptIds[0] }) {
                var ok = false
                // Durdur bu gönderimi de kesebilsin diye izlenen işlem olarak çalışır.
                val op = startOp { ok = sendToCloud(message.content, timestamp = message.timestamp, model = queueModel()) }
                op.join()
                if (op.isCancelled) break
                if (!ok) {
                    _state.update { s -> s.copy(messages = s.messages.filter { it.id !in attemptIds }) }
                    break
                }
            }
            queue.dequeue(message.id)
            sent++
        }
        if (sent > 0 && queue.count(owner) == 0) _events.trySend(ChatEvent.Toast("Bekleyen mesajlar gönderildi"))
    }

    /** Kuyruktaki mesaj sunucuya gider; yerel model seçiliyse varsayılan bulut modeli kullanılır. */
    private fun queueModel(): RemoteModel? {
        val s = _state.value
        val cloud = s.models.filter { it.provider != "local" && it.available }
        return s.selectedModel?.takeIf { it.provider != "local" } ?: cloud.firstOrNull { it.isDefault } ?: cloud.firstOrNull()
    }

    private suspend fun openChat(chatId: String) {
        if (_state.value.chatId == chatId) return
        saveNow()
        val chat = store.get(chatId)
        _state.value.pendingFeedback?.let { submitFeedback(it) }
        openBase = chat?.messages?.mapTo(HashSet()) { it.id }
        _state.update { it.copy(chatId = chatId, messages = finishStreaming(chat?.messages ?: emptyList()), privateChat = false) }
    }

    /** İşlemi izlenen iş olarak başlatır: Durdur, sohbet değişimi ve ekran kapanması bunu keser. */
    private fun startOp(block: suspend () -> Unit): Job {
        // LAZY: iş hemen bitse bile [finishOp] kendini streamJob olarak görebilsin.
        val job = viewModelScope.launch(start = CoroutineStart.LAZY) { block() }
        streamJob = job
        job.start()
        return job
    }

    /**
     * İşlem bitince yükleniyor durumunu kapatır ve kaydeder. Durdurulmuş ya da yerini yenisi almış
     * eski bir iş (kesilemeyen bir ağ çağrısından geç dönen) yeni işlemi bitmiş saymasın diye hiçbir şey yapmaz.
     */
    private suspend fun finishOp() {
        if (streamJob !== currentCoroutineContext().job) return
        streamJob = null
        _state.update { it.copy(isLoading = false) }
        scheduleSave()
    }

    /** Süren işlemi keser; yerel model native döngüde olabilir, onu da durdurur. */
    private fun cancelOp() {
        streamJob?.let {
            localAi.stop()
            it.cancel()
        }
        streamJob = null
    }

    /**
     * Mesajı gönderip cevabı akıtır (sohbet ya da agent). Başarılıysa true;
     * hata metni cevap balonunda gösterilir.
     */
    private suspend fun sendToCloud(
        text: String,
        timestamp: Long? = null,
        image: Attachment? = null,
        document: Attachment? = null,
        model: RemoteModel? = _state.value.selectedModel,
        mode: AssistantMode = _state.value.mode,
    ): Boolean {
        val live = currentCoroutineContext().job
        val ts = timestamp ?: now()
        val content = text.ifEmpty { if (document != null) "${document.name} dosyasını analiz et." else "Bu fotoğrafı analiz et." }
        val userMessage = ChatMessage(id = ts.toString(), role = "user", content = content, image = image?.uri, timestamp = ts)
        val assistantId = (ts + 1).toString()
        val prior = _state.value.messages.filter { it.content.isNotBlank() && it.role != "system" && it.isError != true }
        val chatId = _state.value.chatId ?: "chat_$ts"
        _state.update {
            it.copy(
                chatId = chatId,
                isLoading = true,
                messages = it.messages + userMessage + ChatMessage(
                    id = assistantId,
                    role = "model",
                    isStreaming = true,
                    agentStatus = if (mode == AssistantMode.Chat) null else "Görev planlanıyor…",
                    agentSteps = emptyList(),
                ),
            )
        }
        scheduleSave()
        memory.rememberInBackground(content) { keys -> _events.trySend(ChatEvent.MemorySaved(keys)) }
        try {
            val (history, historySummary) = conversationContext(prior, assistantId, model?.provider)
            var prompt = content
            if (image != null) {
                updateMessage(assistantId) { it.copy(agentStatus = "Görsel inceleniyor…") }
                val ext = if (image.mimeType.contains("png")) "png" else "jpg"
                val analysis = backend.uploadForAnalysis(media.read(image.uri), image.mimeType, "mobile-upload.$ext", "Görsel işlenemedi.")
                prompt += "\n\nGörsel incelemesinden çıkarılan bilgi:\n$analysis"
            }
            if (document != null) {
                updateMessage(assistantId) { it.copy(agentStatus = "Dosya okunuyor…") }
                val extracted = backend.uploadForAnalysis(media.read(document.uri), document.mimeType, document.name, "Dosya işlenemedi.")
                prompt += "\n\n${document.name} dosyasından çıkarılan içerik:\n${extracted.take(60000)}"
            }
            if (mode == AssistantMode.Chat) {
                if (image != null || document != null) updateMessage(assistantId) { it.copy(agentStatus = null) }
                val startedAt = now()
                var thoughtFor: Long? = null
                val final = backend.streamChat(
                    ChatStreamRequest(
                        message = prompt,
                        history = history,
                        instructions = buildInstructions(content),
                        webSearch = true,
                        provider = model?.provider,
                        model = model?.id,
                        historySummary = historySummary,
                        deepThink = _state.value.deepThink,
                    ),
                    onReasoning = { thought -> if (live.isActive) updateMessage(assistantId) { m -> m.copy(thinking = thought, isStreaming = true) } },
                ) { partial ->
                    if (thoughtFor == null) thoughtFor = (now() - startedAt).coerceAtLeast(0)
                    if (live.isActive) updateMessage(assistantId) { m -> m.copy(content = partial, isStreaming = true, thinkingMs = thoughtFor) }
                }
                val latencyMs = (now() - startedAt).coerceAtLeast(0)
                val answeredBy = backend.lastAnsweredBy ?: model?.let { "${it.provider}/${it.id}" }
                updateMessage(assistantId) {
                    it.copy(
                        content = final.ifEmpty { "Cevap alınamadı." },
                        isStreaming = false,
                        agentStatus = null,
                        thinkingMs = it.thinkingMs ?: latencyMs,
                        answeredBy = answeredBy,
                        latencyMs = latencyMs,
                    )
                }
            } else {
                val result = backend.runAgent(
                    AgentRequest(
                        mode = mode.id,
                        message = prompt,
                        history = history,
                        // Agent ucu özeti ayrı almıyor; istemin sonuna eklenir.
                        instructions = buildInstructions(content) + summaryPrompt(historySummary),
                        model = if (model?.provider == "openai") model.id else null,
                    ),
                    AgentCallbacks(
                        onText = { partial -> if (live.isActive) updateMessage(assistantId) { m -> m.copy(content = partial, isStreaming = true) } },
                        onStatus = { status -> if (live.isActive) updateMessage(assistantId) { m -> m.copy(agentStatus = status) } },
                        onSteps = { steps -> if (live.isActive) updateMessage(assistantId) { m -> m.copy(agentSteps = steps) } },
                        onApproval = { approval ->
                            val answer = CompletableDeferred<Boolean>()
                            approvalAnswer = answer
                            _state.update { it.copy(approval = approval.message ?: "${approval.name ?: "Bu işlem"} uygulansın mı?") }
                            try {
                                answer.await()
                            } finally {
                                approvalAnswer = null
                                _state.update { it.copy(approval = null) }
                            }
                        },
                    ),
                )
                updateMessage(assistantId) {
                    it.copy(content = result.finalText.ifEmpty { "Görev tamamlandı." }, isStreaming = false, agentStatus = null, agentSteps = result.steps)
                }
            }
            _state.update { it.copy(quota = backend.lastQuota, quotaExhaustedUntil = null) }
            return true
        } catch (e: CancellationException) {
            throw e
        } catch (e: QuotaExceededException) {
            _state.update { s ->
                s.copy(messages = s.messages.filterNot { it.id == assistantId }, quota = backend.lastQuota, quotaExhaustedUntil = nextUtcMidnight(now()))
            }
            return false
        } catch (e: Exception) {
            updateMessage(assistantId) { it.copy(content = e.message ?: "Bir sorun oluştu.", isStreaming = false, agentStatus = null, isError = true) }
            return false
        } finally {
            finishOp()
        }
    }

    /** index.tsx `sendToOfflineModel`: telefondaki modelle, yerel sohbet hafızasıyla cevap. */
    private suspend fun sendToOffline(text: String) {
        val live = currentCoroutineContext().job
        val ts = now()
        val chatId = _state.value.chatId ?: "chat_$ts"
        val userMessage = ChatMessage(id = ts.toString(), role = "user", content = text, timestamp = ts)
        val assistantId = (ts + 1).toString()
        val history = (_state.value.messages + userMessage).filter { it.isError != true }.map { it.role to it.content }
        _state.update {
            it.copy(
                chatId = chatId,
                isLoading = true,
                messages = it.messages + userMessage + ChatMessage(id = assistantId, role = "model", isStreaming = true),
            )
        }
        scheduleSave()
        try {
            // Bulut hafızasından (cihazdaki kopya) kullanıcı bilgileri + geçmiş sohbetlerden ilgili mesajlar.
            val recall = try {
                formatChatMemoriesForPrompt(ChatMemoryIndex(store.all()).retrieve(text, chatId, limit = 2))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                ""
            }
            val memoryContext = listOf(memory.promptFor(text).trim(), recall).filter { it.isNotBlank() }.joinToString("\n\n")
            val final = localAi.generate(
                history,
                // Native döngüden gelir; durdurulduktan sonra gelen parça bitmiş mesajı açmasın.
                onPartial = { partial -> if (live.isActive) updateMessage(assistantId) { m -> m.copy(content = partial, isStreaming = true) } },
                customInstructions = prefs.customInstructions(user?.email),
                memoryContext = memoryContext,
            )
            // "local/" öneki MessageRow'da "Telefonda üretildi · hak harcamaz" notunu açar.
            updateMessage(assistantId) { it.copy(content = final, isStreaming = false, answeredBy = "local/${localAi.selectedModelId()}") }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            updateMessage(assistantId) { it.copy(content = "Çevrimdışı model çalıştırılamadı: ${e.message ?: "Bilinmeyen hata"}", isStreaming = false, isError = true) }
        } finally {
            finishOp()
        }
    }

    // ------------------------------------------------------------------ görsel / video üretimi

    /** [userText] verilirse sohbette kullanıcının yazdığı metin olduğu gibi görünür (mesajdan anlaşılan istek). */
    fun generateMedia(kind: MediaKind, prompt: String, aspectRatio: String, userText: String? = null) {
        if (_state.value.isLoading) {
            _events.trySend(ChatEvent.Alert("Bir işlem devam ediyor", "Önce mevcut üretimin tamamlanmasını bekle veya durdur."))
            return
        }
        if (user == null) {
            _events.trySend(ChatEvent.Alert("Giriş gerekli", "Fotoğraf ve video oluşturmak için hesabına giriş yapmalısın."))
            return
        }
        val ts = now()
        val assistantId = (ts + 1).toString()
        val chatId = _state.value.chatId ?: "chat_$ts"
        _state.update {
            it.copy(
                chatId = chatId,
                isLoading = true,
                messages = it.messages +
                    ChatMessage(id = ts.toString(), role = "user", content = userText ?: "${if (kind == MediaKind.Video) "Video" else "Fotoğraf"} oluştur: $prompt", timestamp = ts) +
                    ChatMessage(
                        id = assistantId,
                        role = "model",
                        isStreaming = true,
                        mediaStatus = if (kind == MediaKind.Video) "Veo videoyu hazırlıyor…" else "Görsel oluşturuluyor…",
                    ),
            )
        }
        scheduleSave()
        startOp {
            try {
                if (kind == MediaKind.Image) {
                    val image = backend.generateImage(prompt, aspectRatio)
                    val uri = media.saveGeneratedImage(image.base64, image.mimeType, ts)
                    media.addToLibrary(uri, prompt, generated = true)
                    updateMessage(assistantId) {
                        it.copy(content = "Fotoğraf hazır.", generatedImage = uri, generatedAspectRatio = aspectRatio, isStreaming = false, mediaStatus = null)
                    }
                    return@startOp
                }
                val videoAspect = if (aspectRatio == "9:16") "9:16" else "16:9"
                val jobId = backend.startVideoGeneration(prompt, videoAspect)
                updateMessage(assistantId) { it.copy(mediaJobId = jobId, mediaStatus = "Video sıraya alındı…") }
                for (attempt in 1..90) {
                    if (attempt > 1) delay(10_000)
                    val status = backend.getVideoStatus(jobId)
                    if (status.status == "failed") throw IllegalStateException(status.error ?: "Video üretilemedi.")
                    if (status.status == "completed" && status.videoUrl != null) {
                        updateMessage(assistantId) {
                            it.copy(content = "Video hazır. Oynatabilir veya paylaşabilirsin.", generatedVideo = status.videoUrl, isStreaming = false, mediaStatus = null)
                        }
                        return@startOp
                    }
                    updateMessage(assistantId) { it.copy(mediaStatus = "Veo videoyu hazırlıyor… ${maxOf(10, attempt * 10)} sn") }
                }
                throw IllegalStateException("Video üretimi zaman aşımına uğradı. Daha sonra tekrar dene.")
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                updateMessage(assistantId) { it.copy(content = e.message ?: "Medya üretilemedi.", isStreaming = false, mediaStatus = null, isError = true) }
            } finally {
                finishOp()
            }
        }
    }

    fun checkVideo(message: ChatMessage) {
        val jobId = message.mediaJobId ?: return
        updateMessage(message.id) { it.copy(mediaStatus = "Video durumu kontrol ediliyor…") }
        viewModelScope.launch {
            try {
                val status = backend.getVideoStatus(jobId)
                updateMessage(message.id) {
                    when {
                        status.status == "completed" && status.videoUrl != null ->
                            it.copy(content = "Video hazır. Oynatabilir veya paylaşabilirsin.", generatedVideo = status.videoUrl, mediaStatus = null)
                        status.status == "failed" -> it.copy(content = status.error ?: "Video üretilemedi.", mediaStatus = null)
                        else -> it.copy(content = "Video hâlâ hazırlanıyor. Biraz sonra tekrar kontrol et.", mediaStatus = null)
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                updateMessage(message.id) { it.copy(content = e.message ?: "Video durumu alınamadı.", mediaStatus = null) }
            } finally {
                scheduleSave()
            }
        }
    }

    // ------------------------------------------------------------------ durdurma, düzenleme, yeniden deneme

    fun stop() {
        if (_state.value.isLocalSelected) localAi.stop()
        cancelOp()
        _state.update { s -> s.copy(isLoading = false, messages = finishStreaming(s.messages)) }
        scheduleSave()
    }

    fun edit(message: ChatMessage) {
        val index = _state.value.messages.indexOfFirst { it.id == message.id }
        if (index < 0) return
        _state.update { it.copy(messages = it.messages.take(index)) }
        _input.value = message.content
    }

    fun retry(message: ChatMessage) {
        val messages = _state.value.messages
        val assistantIndex = messages.indexOfFirst { it.id == message.id }
        if (assistantIndex < 1 || _state.value.isLoading) return
        val userIndex = (assistantIndex - 1 downTo 0).firstOrNull { messages[it].isUser } ?: return
        val userMessage = messages[userIndex]
        _state.update { it.copy(messages = messages.take(userIndex)) }
        if ((_state.value.isLocalSelected || _state.value.privateChat) && localAi.downloadedModels().isNotEmpty()) {
            // Yerel model yalnız metin kabul eder; görsel metinle yeniden denenir.
            startOp { sendToOffline(userMessage.content) }
            return
        }
        val image = userMessage.image?.let { Attachment(it, "image/jpeg", "mobile-upload.jpg") }
        startOp { sendToCloud(userMessage.content, image = image) }
    }

    fun answerApproval(approved: Boolean) {
        approvalAnswer?.complete(approved)
    }

    /** Hafıza bildirimindeki "Geri al". */
    fun undoMemory(keys: List<String>) {
        viewModelScope.launch {
            _events.trySend(ChatEvent.Toast(if (memory.forget(keys)) "Geri alındı" else "Geri alınamadı"))
        }
    }

    fun feedback(id: String, value: Feedback) {
        val pending = _state.value.pendingFeedback
        if (pending != null && pending.messageId != id) submitFeedback(pending)
        val snapshot = _state.value
        val next = value.takeUnless { snapshot.feedbacks[id] == it }
        _state.update {
            it.copy(
                feedbacks = if (next == null) it.feedbacks - id else it.feedbacks + (id to next),
                pendingFeedback = null,
            )
        }
        val index = snapshot.messages.indexOfFirst { it.id == id }
        val answer = snapshot.messages.getOrNull(index) ?: return
        // Yerel model cevapları ve oturumsuz kullanım backend'e gitmez.
        if (!snapshot.signedIn || snapshot.privateChat || answer.answeredBy == null || answer.answeredBy.startsWith("local/")) return
        val question = snapshot.messages.take(index).lastOrNull { it.isUser }?.content.orEmpty()
        val request = FeedbackRequest(
            type = when (next) {
                Feedback.Up -> "up"
                Feedback.Down -> "down"
                null -> null
            },
            chatId = snapshot.chatId ?: "temp",
            messageId = id,
            provider = answer.answeredBy.substringBefore('/'),
            model = answer.answeredBy.substringAfter('/'),
            question = question,
            answer = answer.content,
            latencyMs = answer.latencyMs,
        )
        if (next == Feedback.Down) {
            _state.update { it.copy(pendingFeedback = request) }
        } else {
            sendFeedback(request)
        }
    }

    fun submitFeedback(pending: FeedbackRequest, reason: String? = null, note: String? = null) {
        if (_state.value.pendingFeedback !== pending) return
        _state.update { it.copy(pendingFeedback = null) }
        sendFeedback(pending.copy(reason = reason, note = note))
    }

    private fun sendFeedback(request: FeedbackRequest) {
        val owner = uid.value ?: return
        val accountJob = feedbackAccountJob ?: return
        viewModelScope.launch(accountJob) {
            feedbackSendLock.withLock {
                val current = auth.currentUser.value ?: return@withLock
                if (uid.value != owner || current.uid != owner || !current.emailVerified) return@withLock
                try {
                    backend.sendFeedback(request)
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    // Oy yerelde kalır, gönderim hatası sohbeti kesmez.
                }
            }
        }
    }

    // ------------------------------------------------------------------ sohbet yükleme ve kaydetme

    private fun clearChat() {
        _state.value.pendingFeedback?.let { submitFeedback(it) }
        cancelOp()
        saveNow()
        openBase = null
        _state.update { it.copy(messages = emptyList(), chatId = null, isLoading = false, emptyEpoch = it.emptyEpoch + 1, privateChat = false) }
    }

    /**
     * Hesap değişti: önceki hesabın süren işi ve kuyruk gönderimi durur, açık sohbet beklemeden kendi
     * geçmişine yazılır ve ekran temizlenir. Depo yeni hesaba geçmeden önce çağrılmalı; yoksa önceki
     * kullanıcının sohbeti sonraki hesabın (ya da misafirin) geçmişine yazılır.
     */
    private suspend fun leaveAccount() {
        feedbackAccountJob?.cancel()
        cloudWatcher?.close()
        cloudWatcher = null
        flushJob?.cancel()
        cancelOp()
        saveJob?.cancel()
        saveJob = null
        persist(_state.value.let { it.copy(messages = finishStreaming(it.messages)) })
        openBase = null
        _state.update {
            it.copy(
                messages = emptyList(), chatId = null, isLoading = false, emptyEpoch = it.emptyEpoch + 1,
                privateChat = false, quota = null, quotaExhaustedUntil = null,
                pendingFeedback = null, feedbacks = emptyMap(),
            )
        }
    }

    private suspend fun loadChat(id: String) {
        val chat = store.get(id) ?: return
        _state.value.pendingFeedback?.let { submitFeedback(it) }
        cancelOp()
        saveNow()
        persistedIds += id
        openBase = chat.messages.mapTo(HashSet()) { it.id }
        _state.update { it.copy(chatId = chat.id, messages = finishStreaming(chat.messages), isLoading = false, privateChat = false) }
    }

    override fun onCleared() {
        cloudWatcher?.close()
        cloudWatcher = null
        cancelOp()
        saveNow()
    }

    private fun appendMessage(message: ChatMessage) {
        _state.update { it.copy(messages = it.messages + message) }
    }

    private fun updateMessage(id: String, change: (ChatMessage) -> ChatMessage) {
        _state.update { s -> s.copy(messages = s.messages.map { if (it.id == id) change(it) else it }) }
    }

    /** index.tsx: mesajlar değiştikten 450 ms sonra geçmişe yazar. */
    private fun scheduleSave() {
        saveJob?.cancel()
        saveJob = viewModelScope.launch {
            delay(450)
            persist(_state.value)
        }
    }

    /**
     * Açık sohbeti beklemeden yazar (sohbet değişmeden ya da ekran kapanmadan önce). Yarım kalan
     * cevaplar durdurulmuş olarak kaydedilir; kayıt [saveScope]'ta yaşar, ekran kapansa da biter.
     */
    private fun saveNow() {
        saveJob?.cancel()
        saveJob = null
        val snapshot = _state.value.let { it.copy(messages = finishStreaming(it.messages)) }
        saveScope.launch { persist(snapshot) }
    }

    private suspend fun persist(s: ChatUiState) {
        // Gizli sohbet hiçbir zaman geçmişe yazılmaz (eşitleme de buradan beslendiği için buluta da gitmez).
        if (s.privateChat) return
        val id = s.chatId ?: return
        if (s.messages.isEmpty()) return
        val existing = store.get(id)
        val isOpen = _state.value.chatId == id
        // Depoda olup ekranın görmediği mesajlar (başka cihazdan gelen) korunur, ekrana da eklenir.
        val messages = if (existing != null && isOpen) mergeMessages(s.messages, existing.messages, openBase) else s.messages
        if (isOpen && messages != s.messages) {
            _state.update { st -> if (st.chatId == id) st.copy(messages = mergeMessages(st.messages, existing!!.messages, openBase)) else st }
        }
        if (isOpen) openBase = messages.mapTo(HashSet()) { it.id }
        if (existing != null && existing.messages == messages) return
        val title = existing?.title
            ?: messages.firstOrNull { it.isUser }?.content?.take(55)?.trimEnd()
            ?: "Yeni sohbet"
        val updatedAt = Instant.ofEpochMilli(now()).toString()
        store.upsert(
            (existing ?: StoredChat(id = id, updatedAt = "")).copy(
                title = title,
                updatedAt = updatedAt,
                messages = messages,
            ),
        )
        persistedIds += id
    }

    /**
     * Açık sohbet depoda dışarıdan değişti (başka cihaz). Cevap akmıyorsa ve kaydedilmemiş değişiklik
     * yoksa ekrana yansıtılır; aksi hâlde sonraki kayıt birleştirir.
     */
    private suspend fun absorbStoredChat(id: String) {
        if (_state.value.isLoading || saveJob?.isActive == true || openBase == null) return
        val stored = store.get(id) ?: return
        val s = _state.value
        if (s.chatId != id || s.isLoading) return
        val merged = mergeMessages(stored.messages, s.messages, openBase)
        openBase = stored.messages.mapTo(HashSet()) { it.id }
        if (merged != s.messages) _state.update { it.copy(messages = merged) }
    }

    /** Akışı yarım kalmış mesajları durdurulmuş olarak kapatır. */
    private fun finishStreaming(messages: List<ChatMessage>): List<ChatMessage> = messages.map { m ->
        if (m.streaming) {
            m.copy(
                content = m.content.ifEmpty { if (m.mediaJobId != null) "Video üretimi arka planda devam ediyor." else "Üretim durduruldu." },
                isStreaming = false,
                agentStatus = null,
                mediaStatus = null,
            )
        } else {
            m
        }
    }

    /**
     * Modele gidecek geçmiş: uzun sohbette eski kısım özetlenip özet ilgili mesaja yazılır, yalnızca son mesajlar
     * gönderilir. Özet alınamazsa geçmiş eksiksiz gider.
     */
    private suspend fun conversationContext(prior: List<ChatMessage>, assistantId: String, provider: String?): Pair<List<ChatHistoryItem>, String?> {
        val plan = planConversationContext(prior, contextBudgetChars(provider))
        var summary = plan.summary.ifEmpty { null }
        var recent = plan.recent
        if (plan.needsSummary) {
            updateMessage(assistantId) { it.copy(agentStatus = "Sohbetin önceki kısmını özetliyorum") }
            val fresh = memory.summarize(summary, toSummaryMessages(plan.toSummarize))
            updateMessage(assistantId) { it.copy(agentStatus = null) }
            if (fresh != null) {
                summary = fresh
                updateMessage(prior[plan.newSummaryIndex].id) { it.copy(contextSummary = fresh) }
                scheduleSave()
            } else {
                recent = plan.toSummarize + plan.recent
            }
        }
        val history = recent.map { ChatHistoryItem(if (it.role == "model" || it.role == "assistant") it.role else "user", it.content) }
        return history to summary
    }

    private fun summaryPrompt(summary: String?): String = if (summary.isNullOrBlank()) "" else
        "\n\n$SUMMARY_HEADER\n$summary"

    private fun buildInstructions(text: String = ""): String {
        val custom = prefs.customInstructions(user?.email)
        return buildString {
            append("Sen KocaMind'sun. Varsayılan yanıt dilin Türkçedir. Kullanıcı açıkça başka bir dil istemedikçe Türkçe cevap ver. Eski İngilizce cevaplar yanıt dilini değiştirmemeli.\n")
            append("Güncel bilgi gerektiğinde gerçek web araması kullan; kaynakta olmayan bilgi veya URL uydurma.\n")
            append("Önce kısa ve net sonucu ver, gerekirse sonra ayrıntılandır. Temiz Markdown kullan.\n")
            append("Araç çağrılarını veya ham JSON'u kullanıcıya gösterme.\n")
            append(HONESTY_RULE).append('\n')
            append("Kullanıcı: ${_state.value.userName.ifEmpty { "Bilinmiyor" }}\n")
            if (custom.isNotBlank()) append("Kullanıcının özel talimatları:\n$custom")
            append(memory.promptFor(text))
        }
    }
}
