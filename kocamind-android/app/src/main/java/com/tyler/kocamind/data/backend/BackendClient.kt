package com.tyler.kocamind.data.backend

import com.tyler.kocamind.BuildConfig
import com.tyler.kocamind.data.auth.AuthMailer
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.booleanOrNull
import com.tyler.kocamind.data.chat.AgentStep
import com.tyler.kocamind.data.memory.ExtractResult
import com.tyler.kocamind.data.memory.ImportResult
import com.tyler.kocamind.data.memory.Memory
import com.tyler.kocamind.data.memory.MemoryInsight
import com.tyler.kocamind.data.memory.MemoryApi
import com.tyler.kocamind.data.memory.SummaryMessage
import okhttp3.Call
import okhttp3.Headers
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

open class BackendException(message: String) : Exception(message)

/** Günlük sohbet hakkı bitti (429); ekran hata balonu yerine geri sayım gösterir. */
class QuotaExceededException(message: String) : BackendException(message)

class BugReportDailyLimitException : BackendException("Bugünlük bildirim sınırına ulaştın.")

/** Backend'in `X-Daily-Remaining` / `X-Daily-Limit` başlıkları (quota.js). */
data class QuotaState(val remaining: Int, val limit: Int)

internal fun quotaFrom(headers: Headers): QuotaState? {
    val limit = headers["X-Daily-Limit"]?.toIntOrNull()?.takeIf { it > 0 } ?: return null
    val remaining = headers["X-Daily-Remaining"]?.toIntOrNull() ?: return null
    return QuotaState(remaining, limit)
}

/** Sohbet geçmişi öğesi. Rol `user` / `model` / `assistant`. */
@Serializable
data class ChatHistoryItem(val role: String, val content: String)

/** backend.ts `streamBackendChat` seçenekleri. */
data class ChatStreamRequest(
    val message: String,
    val history: List<ChatHistoryItem>,
    val instructions: String? = null,
    val webSearch: Boolean = true,
    val provider: String? = null,
    val model: String? = null,
    /** Sohbetin eski kısmının özeti; backend sistem istemine ekler. */
    val historySummary: String? = null,
    /** Derin düşünce: backend düşünen modele geçer ya da düşünme çabasını yükseltir. */
    val deepThink: Boolean = false,
)

/** Beğen/beğenme; backend kendini geliştiren döngü için model skorlarına yazar. type null: oy geri alındı. */
data class FeedbackRequest(
    val type: String?,
    val chatId: String,
    val messageId: String,
    val provider: String?,
    val model: String?,
    val question: String,
    val answer: String,
    val reason: String? = null,
    val note: String? = null,
    val latencyMs: Long? = null,
)

/** Sohbet ekranının backend'den kullandığı kısım (testte sahtesi kullanılır). */
interface ChatBackend {
    /** Son `/chat` cevabını veren model ("sağlayıcı/model"); backend başlıkta bildirir. */
    val lastAnsweredBy: String? get() = null
    /** Son `/chat` cevabındaki kalan günlük hak; başlık yoksa (sınırsız) null. */
    val lastQuota: QuotaState? get() = null
    suspend fun sendFeedback(request: FeedbackRequest) {}
    suspend fun getRemoteModels(): List<RemoteModel>
    /** [onReasoning] modelin düşünce özetini (birikimli) yanıt metninden ayrı verir. */
    suspend fun streamChat(request: ChatStreamRequest, onReasoning: (String) -> Unit = {}, onText: (String) -> Unit): String
    suspend fun runAgent(request: AgentRequest, callbacks: AgentCallbacks): AgentResult
    suspend fun uploadForAnalysis(bytes: ByteArray, mimeType: String, fileName: String, errorFallback: String): String
    suspend fun transcribeAudio(bytes: ByteArray, mimeType: String): String
    suspend fun generateImage(prompt: String, aspectRatio: String): GeneratedImage
    suspend fun startVideoGeneration(prompt: String, aspectRatio: String): String
    suspend fun getVideoStatus(jobId: String): VideoStatus
}

private const val DEFAULT_ERROR = "Sunucu isteği tamamlanamadı."
private const val NOT_SIGNED_IN = "Devam etmek için hesabına giriş yapman gerekiyor."
private const val STREAM_ERROR = "Yanıt akışı kesildi."
private const val AGENT_STREAM_ERROR = "Agent bağlantısı kesildi."
private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

private val json = Json { ignoreUnknownKeys = true }

/**
 * Backend hata gövdesinden okunabilir mesaj çıkarır:
 * `{error:{message}}`, `{error:"..."}` ya da JSON olmayan gövde.
 */
internal fun backendErrorMessage(body: String?, fallback: String): String {
    val root = body?.let { runCatching { json.parseToJsonElement(it) }.getOrNull() } as? JsonObject
        ?: return fallback
    return when (val error = root["error"]) {
        is JsonObject -> (error["message"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        is JsonPrimitive -> error.takeIf { it.isString }?.content
        else -> null
    }?.takeIf { it.isNotBlank() } ?: fallback
}

/** `/billing/status` yanıtından plan: yalnız `pro` + `active` ise "pro". */
fun planFromBillingStatus(status: JsonElement): String {
    val billing = (status as? JsonObject)?.get("billing") as? JsonObject ?: return "free"
    val plan = (billing["plan"] as? JsonPrimitive)?.content
    val state = (billing["status"] as? JsonPrimitive)?.content
    return if (plan == "pro" && state == "active") "pro" else "free"
}

/** Agent / derin araştırma isteği (backend.ts `runBackendAgent`). */
data class AgentRequest(
    val mode: String,
    val message: String,
    val history: List<ChatHistoryItem>,
    val instructions: String?,
    val model: String?,
)

/** Agent'ın onay istediği işlem (ör. e-posta gönderme). */
data class AgentApproval(val runId: String, val confirmationId: String, val name: String?, val message: String?)

class AgentCallbacks(
    val onText: (String) -> Unit,
    val onStatus: (String) -> Unit = {},
    val onSteps: (List<AgentStep>) -> Unit = {},
    /** Kullanıcıya sorar; true = onayla. */
    val onApproval: suspend (AgentApproval) -> Boolean = { false },
)

data class AgentResult(val finalText: String, val steps: List<AgentStep>)

data class GeneratedImage(val base64: String, val mimeType: String)

data class VideoStatus(val status: String, val videoUrl: String?, val error: String?)

/** kocamind-mobil/src/lib/backend.ts ile aynı sözleşme. */
class BackendClient(
    baseUrl: String,
    private val http: OkHttpClient,
    private val tokenProvider: suspend () -> String?,
) : ChatBackend, MemoryApi, AuthMailer {
    private val baseUrl = baseUrl.trimEnd('/')

    @Volatile
    override var lastAnsweredBy: String? = null
        private set

    @Volatile
    override var lastQuota: QuotaState? = null
        private set

    override suspend fun getRemoteModels(): List<RemoteModel> {
        val models = when (val data = requestJson("/models")) {
            is JsonArray -> data
            is JsonObject -> data["models"] as? JsonArray
            else -> null
        } ?: return emptyList()
        return models.mapNotNull { runCatching { json.decodeFromJsonElement<RemoteModel>(it) }.getOrNull() }
            .filter { it.available }
    }

    /**
     * `/chat` SSE akışı. Her parçada o ana kadarki tüm metinle [onText] çağrılır.
     * Coroutine iptal edilirse HTTP çağrısı da kesilir.
     */
    override suspend fun streamChat(request: ChatStreamRequest, onReasoning: (String) -> Unit, onText: (String) -> Unit): String {
        val body = buildJsonObject {
            put("provider", request.provider ?: "openai")
            put("model", request.model ?: "gpt-5.6-luna")
            put("assistant_type", "tiger")
            request.instructions?.let { put("custom_prompt", it) }
            put("history", historyJson(request.history))
            request.historySummary?.let { put("history_summary", it) }
            if (request.deepThink) put("deep_think", true)
            put("message", request.message)
            put("stream", true)
            put("web_search", request.webSearch)
        }
        var text = ""
        var reasoning = ""
        lastAnsweredBy = null
        val onHeaders: (Headers) -> Unit = { headers ->
            val model = headers["X-KocaMind-Model"]
            lastAnsweredBy = model?.let { "${headers["X-KocaMind-Provider"].orEmpty()}/$it" }
        }
        streamEvents("/chat", body, STREAM_ERROR, onHeaders, chatQuota = true) { event, data ->
            if (data == "[DONE]") return@streamEvents true
            val element = runCatching { json.parseToJsonElement(data) }.getOrNull() as? JsonObject
            if (event == "error" || element?.containsKey("error") == true) {
                throw BackendException(backendErrorMessage(data, STREAM_ERROR))
            }
            val choices = element?.get("choices") as? JsonArray
            val deltaObject = (choices?.firstOrNull() as? JsonObject)?.get("delta") as? JsonObject
            (deltaObject?.get("reasoning_content") as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { it.isNotEmpty() }?.let {
                reasoning += it
                onReasoning(reasoning)
            }
            val delta = deltaObject?.get("content") as? JsonPrimitive
            delta?.takeIf { it.isString }?.content?.takeIf { it.isNotEmpty() }?.let {
                text += it
                onText(text)
            }
            false
        }
        return text
    }

    override suspend fun sendFeedback(request: FeedbackRequest) {
        requestJson("/feedback", jsonBody {
            put("type", request.type)
            put("chatId", request.chatId)
            put("messageId", request.messageId)
            request.provider?.let { put("provider", it) }
            request.model?.let { put("model", it) }
            put("assistantType", "tiger")
            put("question", request.question.take(1000))
            put("answer", request.answer.take(2000))
            if (request.type == "down") {
                request.reason?.let { put("reason", it) }
                request.note?.trim()?.takeIf { it.isNotEmpty() }?.let { put("note", it.take(500)) }
            }
            put("context", androidFeedbackContext(request.latencyMs))
        })
    }

    suspend fun sendBugReport(text: String, chatId: String? = null, messageId: String? = null): String {
        val body = jsonBody {
            put("text", text.trim())
            chatId?.let { put("chatId", it) }
            messageId?.let { put("messageId", it) }
            put("context", androidFeedbackContext())
        }
        val result = requestJson("/feedback/bug", body, errorFallback = "Hata bildirimi gönderilemedi.")
        return (result as? JsonObject)?.string("id")?.takeIf { it.isNotBlank() }
            ?: throw BackendException("Hata bildirimi gönderilemedi.")
    }

    private fun androidFeedbackContext(latencyMs: Long? = null): JsonObject = buildJsonObject {
        put("platform", "android")
        put("appVersion", BuildConfig.VERSION_NAME)
        latencyMs?.let { put("latencyMs", it) }
    }

    /** `/agent/run` akışı; onay istenirse kullanıcıya sorup `/confirm` ile devam eder. */
    override suspend fun runAgent(request: AgentRequest, callbacks: AgentCallbacks): AgentResult {
        var pass = agentPass(
            "/agent/run",
            buildJsonObject {
                put("history", historyJson(request.history))
                put("message", request.message)
                request.instructions?.let { put("instructions", it) }
                put("model", request.model ?: "gpt-5.6-luna")
                put("mode", request.mode)
            },
            callbacks,
        )
        while (true) {
            val approval = pass.approval ?: break
            val approved = callbacks.onApproval(approval)
            pass = agentPass(
                "/agent/runs/${encodePath(approval.runId)}/confirm",
                buildJsonObject {
                    put("confirmationId", approval.confirmationId)
                    put("approved", approved)
                },
                callbacks,
            )
        }
        var finalText = pass.text
        val existing = Regex("https?://[^\\s)]+").findAll(finalText).map { it.value }.toSet()
        val missing = pass.sources.filter { it.second !in existing }
        if (missing.isNotEmpty()) {
            finalText += "\n\n### Kaynaklar\n" + missing.joinToString("\n") { (title, url) -> "- [${title ?: url}]($url)" }
        }
        callbacks.onText(finalText)
        return AgentResult(finalText, pass.steps)
    }

    private class AgentPass(
        val text: String,
        val steps: List<AgentStep>,
        val sources: List<Pair<String?, String>>,
        val approval: AgentApproval?,
    )

    private suspend fun agentPass(path: String, body: JsonObject, callbacks: AgentCallbacks): AgentPass {
        var text = ""
        val steps = mutableListOf<AgentStep>()
        var sources = emptyList<Pair<String?, String>>()
        var approval: AgentApproval? = null
        streamEvents(path, body, AGENT_STREAM_ERROR) { event, data ->
            val payload = runCatching { json.parseToJsonElement(data) }.getOrNull() as? JsonObject ?: JsonObject(emptyMap())
            when (event ?: payload.string("type")) {
                "done" -> return@streamEvents true
                "status" -> callbacks.onStatus(payload.string("message") ?: "Çalışıyor…")
                "tool_started" -> callbacks.onStatus("${payload.string("name")} çalışıyor…")
                "tool_completed" -> {
                    val output = payload["output"] as? JsonObject
                    val ok = (output?.get("ok") as? JsonPrimitive)?.booleanOrNull == true
                    steps += AgentStep(
                        name = payload.string("name").orEmpty(),
                        arguments = payload["arguments"] as? JsonObject ?: JsonObject(emptyMap()),
                        result = if (ok) (output?.get("result") ?: output).toString() else (output?.string("error") ?: "Araç hatası"),
                    )
                    callbacks.onSteps(steps.toList())
                }
                "text_delta" -> {
                    text += payload.string("delta").orEmpty()
                    callbacks.onText(text)
                }
                "completed" -> {
                    text = payload.string("text") ?: text
                    sources = (payload["sources"] as? JsonArray).orEmpty().mapNotNull { item ->
                        val obj = item as? JsonObject ?: return@mapNotNull null
                        val url = obj.string("url") ?: return@mapNotNull null
                        obj.string("title") to url
                    }
                    callbacks.onText(text)
                }
                "approval_required" -> approval = AgentApproval(
                    runId = payload.string("runId").orEmpty(),
                    confirmationId = payload.string("confirmationId").orEmpty(),
                    name = payload.string("name"),
                    message = payload.string("message"),
                )
                "error" -> throw BackendException(
                    payload.string("error") ?: (payload["error"] as? JsonObject)?.string("message") ?: "Agent çalıştırılamadı.",
                )
            }
            false
        }
        return AgentPass(text, steps, sources, approval)
    }

    /** `/upload`: görsel ya da dosyadan çıkarılan metin. */
    override suspend fun uploadForAnalysis(bytes: ByteArray, mimeType: String, fileName: String, errorFallback: String): String {
        val form = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("file", fileName, bytes.toRequestBody(mimeType.toMediaTypeOrNull()))
            .build()
        val data = requestJson("/upload", form, errorFallback) as? JsonObject
        return data?.string("content").orEmpty()
    }

    /** `/audio`: ses kaydını yazıya çevirir. */
    override suspend fun transcribeAudio(bytes: ByteArray, mimeType: String): String {
        val form = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("file", "recording.m4a", bytes.toRequestBody(mimeType.toMediaTypeOrNull()))
            .build()
        return (requestJson("/audio", form) as? JsonObject)?.string("transcription").orEmpty().trim()
    }

    override suspend fun generateImage(prompt: String, aspectRatio: String): GeneratedImage {
        val data = requestJson("/generate-image", jsonBody { put("prompt", prompt); put("aspectRatio", aspectRatio) }) as? JsonObject
        val image = data?.string("image") ?: throw BackendException("Görsel verisi alınamadı.")
        return GeneratedImage(image, data.string("mimeType") ?: "image/png")
    }

    override suspend fun startVideoGeneration(prompt: String, aspectRatio: String): String {
        val data = requestJson("/generate-video", jsonBody { put("prompt", prompt); put("aspectRatio", aspectRatio) }) as? JsonObject
        return data?.string("jobId") ?: throw BackendException("Video işi oluşturulamadı.")
    }

    override suspend fun getVideoStatus(jobId: String): VideoStatus {
        val data = requestJson("/generate-video/${encodePath(jobId)}") as? JsonObject ?: JsonObject(emptyMap())
        return VideoStatus(data.string("status") ?: "processing", data.string("videoUrl"), data.string("error"))
    }

    suspend fun getBillingPlan(): String = planFromBillingStatus(requestJson("/billing/status"))

    /** Ayarlar > Günlük limit (`GET /usage/me`); limit bilgisi yoksa null. */
    suspend fun dailyUsage(): DailyUsage? = (requestJson("/usage/me") as? JsonObject)?.let(::parseDailyUsage)

    // ------------------------------------------------------------------ hafıza

    /** Kullanıcının kayıtlı hafızası. Kimlik token'dan gelir; yoldaki kimlik backend'de yok sayılır. */
    override suspend fun listMemories(): List<Memory> {
        val list = (requestJson("/memory/list/me") as? JsonObject)?.get("memories") as? JsonArray ?: return emptyList()
        return list.mapNotNull { runCatching { json.decodeFromJsonElement<Memory>(it) }.getOrNull() }
    }

    /** Mesajdaki kişisel bilgiyi otomatik hafızaya alır; kaydedilen anahtarları ve unutulan sayısını döner. */
    override suspend fun extractMemories(message: String): ExtractResult {
        val body = requestJson("/memory/extract", jsonBody { put("message", message) }) as? JsonObject ?: return ExtractResult(emptyList(), 0)
        val saved = (body["saved"] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }
        // isNew yoksa (eski backend) yeni kayıt sayılır.
        val (created, updated) = saved.partition { (it["isNew"] as? JsonPrimitive)?.content != "false" }
        val keys = created.mapNotNull { (it["key"] as? JsonPrimitive)?.content }
        return ExtractResult(keys, (body["forgotten"] as? JsonArray)?.size ?: 0, updated.size)
    }

    /** [key] verilirse o kaydı, null ise tüm hafızayı siler. */
    override suspend fun deleteMemory(key: String?) {
        requestJson("/memory/delete", jsonBody { key?.let { put("key", it) } }, method = "DELETE")
    }

    /** Sohbetin eski kısmını önceki özetle birleştirip yeni özet döner. */
    override suspend fun summarizeConversation(previous: String?, messages: List<SummaryMessage>): String? {
        val body = jsonBody {
            previous?.takeIf { it.isNotBlank() }?.let { put("previous_summary", it) }
            put("messages", buildJsonArray {
                messages.forEach { m -> add(buildJsonObject { put("role", m.role); put("content", m.content) }) }
            })
        }
        return ((requestJson("/memory/summarize", body) as? JsonObject)?.get("summary") as? JsonPrimitive)
            ?.takeIf { it.isString }?.content?.takeIf { it.isNotBlank() }
    }

    /** Başka bir yapay zekâ uygulamasından kopyalanan hafıza dökümünü içe aktarır. */
    override suspend fun importMemories(text: String): ImportResult {
        val body = requestJson("/memory/import", jsonBody { put("text", text) }, errorFallback = "Hafıza aktarılamadı.") as? JsonObject
        val saved = (body?.get("saved") as? JsonArray)?.size ?: 0
        val skipped = (body?.get("skippedForLimit") as? JsonPrimitive)?.content?.toIntOrNull() ?: 0
        val from = (body?.get("from") as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { it.isNotBlank() }
        return ImportResult(saved, skipped, from)
    }

    /** Sohbetlere ve hafızaya dayanan objektif kullanıcı yorumu; [refresh] önbelleği atlar. */
    override suspend fun memoryInsight(refresh: Boolean): MemoryInsight {
        val body = requestJson("/memory/insight", jsonBody { if (refresh) put("refresh", true) }, errorFallback = "Yorum oluşturulamadı.") as? JsonObject
        val text = (body?.get("insight") as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { it.isNotBlank() }
        val basedOn = (body?.get("basedOn") as? JsonPrimitive)?.content?.toIntOrNull() ?: 0
        val chats = (body?.get("chats") as? JsonPrimitive)?.content?.toIntOrNull() ?: 0
        return MemoryInsight(text, basedOn, chats)
    }

    /** Ayarlar > Hesabı sil: hesap kilitlenir, veriler 60 gün sonra kalıcı olarak silinir. */
    suspend fun deleteAccount() {
        requestJson("/account", method = "DELETE")
    }

    /** Silinmeyi bekleyen hesabın kalıcı silinme zamanı (ISO 8601); bekleme yoksa null. */
    suspend fun deletionPurgeAfter(): String? {
        val body = requestJson("/account/deletion", method = "GET") as? JsonObject
        return (body?.get("purgeAfter") as? JsonPrimitive)?.takeIf { it.isString }?.content
    }

    /** Bekleme süresindeki hesabı geri alır; ardından token yenilenmelidir. */
    suspend fun restoreAccount() {
        requestJson("/account/restore", jsonBody { }, errorFallback = "Hesap geri alınamadı.")
    }

    /** Bekleme süresini atlayıp hesabı ve verileri hemen kalıcı olarak siler. */
    suspend fun deleteAccountNow() {
        requestJson("/account/now", method = "DELETE", errorFallback = "Hesap silinemedi.")
    }

    // ------------------------------------------------------------------ bağlantılar ve skill'ler

    /** Ayarlar > Bağlantılar: servisler ve kullanıcının bağlantı durumu. */
    suspend fun connectors(): ConnectorCatalog =
        parseConnectorCatalog(requestJson("/connectors", errorFallback = "Bağlantılar yüklenemedi.") as? JsonObject ?: JsonObject(emptyMap()))

    /** İzin ekranının adresini döndürür; OAuth bitince sunucu `kocamind://baglantilar` adresine yönlendirir. */
    suspend fun startConnector(id: String): String {
        val body = requestJson(
            "/connectors/${encodePath(id)}/connect",
            jsonBody { put("client", "android") },
            errorFallback = "Bağlantı başlatılamadı, biraz sonra tekrar dene.",
        ) as? JsonObject
        val url = body?.string("authUrl")
        if (url == null || !url.startsWith("https://")) throw BackendException("Bağlantı adresi alınamadı.")
        return url
    }

    suspend fun disconnectConnector(id: String) {
        requestJson("/connectors/${encodePath(id)}", method = "DELETE", errorFallback = "Bağlantı kesilemedi, biraz sonra tekrar dene.")
    }

    /** Ayarlar > Skill'ler: yapay zekânın gerektiğinde yüklediği talimat paketleri. */
    suspend fun skills(): List<SkillInfo> =
        parseSkills(requestJson("/skills", errorFallback = "Skill'ler yüklenemedi.") as? JsonObject ?: JsonObject(emptyMap()))

    /** Kullanıcının kurduğu skill'i kaldırır; yerleşik skill'ler kaldırılamaz. */
    suspend fun removeSkill(name: String) {
        requestJson("/skills/${encodePath(name)}", method = "DELETE", errorFallback = "Skill kaldırılamadı, biraz sonra tekrar dene.")
    }

    // ------------------------------------------------------------------ altyapı

    private fun historyJson(history: List<ChatHistoryItem>) = buildJsonArray {
        history.forEach { item ->
            add(buildJsonObject {
                put("role", if (item.role == "model") "ai" else item.role)
                put("content", item.content)
            })
        }
    }

    // ------------------------------------------------------------------ kimlik e-postaları

    /** Şifre sıfırlama mailini sunucudan gönderir; oturum gerekmez. Gönderilemezse false. */
    override suspend fun sendPasswordResetEmail(email: String): Boolean =
        postAuthMail("/auth/email/password-reset", jsonBody { put("email", email) }, token = null)

    /** Oturumdaki hesabın doğrulama mailini sunucudan gönderir. Gönderilemezse false. */
    override suspend fun sendVerificationEmail(): Boolean {
        val token = runCatching { tokenProvider() }.getOrNull() ?: return false
        return postAuthMail("/auth/email/verification", jsonBody {}, token)
    }

    /** E-postası doğrulanmış hesaba hoş geldin mailini ister; sunucu her hesaba bir kez gönderir. */
    suspend fun sendWelcomeEmail(): Boolean {
        val token = runCatching { tokenProvider() }.getOrNull() ?: return false
        return postAuthMail("/auth/email/welcome", jsonBody {}, token)
    }

    /** Sunucu kaydı kabul ederse true döndürür. */
    suspend fun sendErrorTelemetry(
        message: String,
        stack: String,
        release: String = "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})",
        userAgent: String = "",
        url: String = "",
        componentStack: String = "",
        reportId: String? = null,
        expectedUid: String? = null,
        isSessionCurrent: () -> Boolean = { true },
    ): Boolean {
        val token = try {
            tokenProvider()?.takeIf { it.isNotBlank() } ?: return false
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            return false
        }
        if (expectedUid != null) {
            // Oturum, gönderim kararı ile token alınması arasında değişebilir.
            val subject = runCatching {
                val claims = token.split('.', limit = 4).getOrNull(1) ?: return false
                val payload = java.util.Base64.getUrlDecoder().decode(claims).toString(Charsets.UTF_8)
                (Json.parseToJsonElement(payload) as? JsonObject)?.get("sub")
            }.getOrNull()
            if (subject != JsonPrimitive(expectedUid)) return false
        }
        val body = jsonBody {
            put("message", message.take(500))
            put("stack", stack.take(5000))
            if (componentStack.isNotEmpty()) put("componentStack", componentStack.take(3000))
            put("url", url.take(500))
            put("userAgent", userAgent.take(500))
            put("release", release.take(100))
            if (reportId != null) put("reportId", reportId)
        }
        return withContext(Dispatchers.IO) {
            runCatching {
                if (!isSessionCurrent()) return@runCatching false
                val request = Request.Builder()
                    .url("$baseUrl/telemetry/error")
                    .header("Authorization", "Bearer $token")
                    .post(body)
                    .build()
                http.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) return@use false
                    val responseBody = response.body?.string() ?: return@use false
                    val result = Json.parseToJsonElement(responseBody) as? JsonObject
                    result?.get("accepted") == JsonPrimitive(true)
                }
            }.getOrDefault(false)
        }
    }

    private suspend fun postAuthMail(path: String, body: RequestBody, token: String?): Boolean = withContext(Dispatchers.IO) {
        runCatching {
            val request = Request.Builder()
                .url(baseUrl + path)
                .apply { if (token != null) header("Authorization", "Bearer $token") }
                .post(body)
                .build()
            http.newCall(request).execute().use { it.isSuccessful }
        }.getOrDefault(false)
    }

    private fun jsonBody(build: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit): RequestBody =
        buildJsonObject(build).toString().toRequestBody(JSON_MEDIA)

    private fun encodePath(segment: String): String = java.net.URLEncoder.encode(segment, "UTF-8").replace("+", "%20")

    /**
     * SSE akışını okur; her olay için [onEvent] çağrılır, true dönerse akış biter.
     * Kullanıcı durdurursa (coroutine iptali) HTTP çağrısı kesilir ve hata sayılmaz.
     */
    private suspend fun streamEvents(
        path: String,
        body: JsonObject,
        dropMessage: String,
        onHeaders: (Headers) -> Unit = {},
        chatQuota: Boolean = false,
        onEvent: (event: String?, data: String) -> Boolean,
    ) {
        val token = tokenProvider() ?: throw BackendException(NOT_SIGNED_IN)
        val call = http.newCall(
            Request.Builder()
                .url(baseUrl + path)
                .header("Authorization", "Bearer $token")
                .header("Accept", "text/event-stream")
                .post(body.toString().toRequestBody(JSON_MEDIA))
                .build(),
        )
        coroutineScope {
            val watcher = launch { try { awaitCancellation() } finally { call.cancel() } }
            try {
                withContext(Dispatchers.IO) { readEvents(call, dropMessage, onHeaders, chatQuota, onEvent) }
            } finally {
                watcher.cancel()
            }
        }
    }

    /** [chatQuota]: yalnızca `/chat` sohbet kotasını taşır; agent kotası ayrıdır ve sohbet satırına yazılmaz. */
    private fun readEvents(call: Call, dropMessage: String, onHeaders: (Headers) -> Unit, chatQuota: Boolean, onEvent: (String?, String) -> Boolean) {
        try {
            call.execute().use { response ->
                if (chatQuota) lastQuota = quotaFrom(response.headers)
                if (chatQuota && response.code == 429) {
                    throw QuotaExceededException(backendErrorMessage(response.body?.string(), dropMessage))
                }
                if (!response.isSuccessful) {
                    // /chat 400 jailbreak_blocked dahil, sunucunun kullanıcıya yönelik mesajını koru.
                    throw BackendException(backendErrorMessage(response.body?.string(), dropMessage))
                }
                onHeaders(response.headers)
                val source = response.body?.source() ?: return
                var event: String? = null
                val data = StringBuilder()
                while (true) {
                    val line = source.readUtf8Line() ?: break
                    when {
                        line.isEmpty() -> {
                            if (data.isNotEmpty() || event != null) {
                                val payload = data.toString()
                                data.clear()
                                val name = event
                                event = null
                                if (onEvent(name, payload)) return
                            }
                        }
                        line.startsWith(":") -> Unit
                        line.startsWith("event:") -> event = line.removePrefix("event:").trim()
                        line.startsWith("data:") -> {
                            if (data.isNotEmpty()) data.append('\n')
                            data.append(line.removePrefix("data:").removePrefix(" "))
                        }
                    }
                }
                if (data.isNotEmpty()) onEvent(event, data.toString())
            }
        } catch (e: IOException) {
            // Kullanıcı durdurduysa bu bir hata değil, iptaldir.
            if (call.isCanceled()) throw CancellationException("Akış durduruldu")
            throw BackendException(dropMessage)
        }
    }

    /** JSON isteği: [body] yoksa GET. Hata gövdesi okunabilir Türkçe mesaja çevrilir. */
    private suspend fun requestJson(
        path: String,
        body: RequestBody? = null,
        errorFallback: String = DEFAULT_ERROR,
        method: String? = null,
    ): JsonElement {
        val token = tokenProvider() ?: throw BackendException(NOT_SIGNED_IN)
        val request = Request.Builder()
            .url(baseUrl + path)
            .header("Authorization", "Bearer $token")
            .apply {
                when {
                    method != null -> method(method, body)
                    body != null -> post(body)
                }
            }
            .build()
        val call = http.newCall(request)
        // Engelleyen execute() iptali duymaz; iş iptal edilince çağrıyı da kes (görsel üretimi gibi uzun istekler).
        return coroutineScope {
            val watcher = launch { try { awaitCancellation() } finally { call.cancel() } }
            try {
                withContext(Dispatchers.IO) {
                    try {
                        call.execute().use { response ->
                            if (path == "/feedback/bug" && response.code == 429) throw BugReportDailyLimitException()
                            val text = response.body?.string()
                            if (!response.isSuccessful) throw BackendException(backendErrorMessage(text, errorFallback))
                            text?.let { runCatching { json.parseToJsonElement(it) }.getOrNull() } ?: JsonObject(emptyMap())
                        }
                    } catch (e: IOException) {
                        if (call.isCanceled()) throw CancellationException("İstek iptal edildi")
                        throw BackendException(errorFallback)
                    }
                }
            } finally {
                watcher.cancel()
            }
        }
    }
}

private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
