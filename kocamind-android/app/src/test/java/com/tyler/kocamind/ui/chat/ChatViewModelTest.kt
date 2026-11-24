package com.tyler.kocamind.ui.chat

import com.tyler.kocamind.data.auth.AuthUser
import com.tyler.kocamind.data.auth.FakeAuthRepository
import com.tyler.kocamind.data.backend.AgentApproval
import com.tyler.kocamind.data.backend.AgentCallbacks
import com.tyler.kocamind.data.backend.AgentRequest
import com.tyler.kocamind.data.backend.AgentResult
import com.tyler.kocamind.data.backend.BackendException
import com.tyler.kocamind.data.backend.GeneratedImage
import com.tyler.kocamind.data.backend.VideoStatus
import com.tyler.kocamind.data.backend.ChatBackend
import com.tyler.kocamind.data.backend.ChatStreamRequest
import com.tyler.kocamind.data.backend.FeedbackRequest
import com.tyler.kocamind.data.backend.RemoteModel
import com.tyler.kocamind.data.chat.ChatCommand
import com.tyler.kocamind.data.chat.ChatCommands
import com.tyler.kocamind.data.chat.ChatMessage
import com.tyler.kocamind.data.chat.ChatStore
import com.tyler.kocamind.data.chat.ChatSummary
import com.tyler.kocamind.data.chat.StoredChat
import com.tyler.kocamind.data.chat.toSummary
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.test.runCurrent
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

private class FakeChatBackend : ChatBackend {
    val feedbackRequests = mutableListOf<FeedbackRequest>()
    var feedbackGate: CompletableDeferred<Unit>? = null
    var startedFeedbacks = 0

    override suspend fun sendFeedback(request: FeedbackRequest) {
        startedFeedbacks++
        feedbackGate?.await()
        feedbackRequests += request
    }

    var models = listOf(
        RemoteModel("gpt-5.6-luna", "openai", "OpenAI", "GPT-5.6 Luna", available = true, isDefault = true),
        RemoteModel("deepseek-v3", "deepseek", "DeepSeek", "DeepSeek V3", available = true),
    )
    var quota: com.tyler.kocamind.data.backend.QuotaState? = null
    override val lastQuota get() = quota
    var parts = listOf("Mer", "Merhaba")
    var error: Exception? = null
    /** Doluysa ilk parçadan sonra bu kapı açılana kadar bekler (durdurma testi). */
    var gate: CompletableDeferred<Unit>? = null
    val requests = mutableListOf<ChatStreamRequest>()
    val agentRequests = mutableListOf<AgentRequest>()
    val uploads = mutableListOf<Pair<String, String>>()
    var approvalAnswer: Boolean? = null
    var askApproval = false
    var videoStatuses = mutableListOf(VideoStatus("processing", null, null), VideoStatus("completed", "https://v.mp4", null))
    val imagePrompts = mutableListOf<Pair<String, String>>()
    /** Doluysa görsel isteği iptale aldırmadan bu kapıyı bekler (kesilemeyen ağ çağrısı). */
    var imageGate: CompletableDeferred<Unit>? = null

    override suspend fun getRemoteModels() = models

    override suspend fun runAgent(request: AgentRequest, callbacks: AgentCallbacks): AgentResult {
        agentRequests += request
        callbacks.onStatus("Kaynaklar taranıyor…")
        callbacks.onSteps(listOf(com.tyler.kocamind.data.chat.AgentStep("web_search")))
        if (askApproval) approvalAnswer = callbacks.onApproval(AgentApproval("r1", "c1", "send_email", "Gönderilsin mi?"))
        callbacks.onText("Rapor")
        return AgentResult("Rapor", listOf(com.tyler.kocamind.data.chat.AgentStep("web_search")))
    }

    override suspend fun uploadForAnalysis(bytes: ByteArray, mimeType: String, fileName: String, errorFallback: String): String {
        uploads += fileName to mimeType
        return if (mimeType.startsWith("image")) "kedi var" else "dosya içeriği"
    }

    override suspend fun transcribeAudio(bytes: ByteArray, mimeType: String) = "sesli not"

    override suspend fun generateImage(prompt: String, aspectRatio: String): GeneratedImage {
        imagePrompts += prompt to aspectRatio
        imageGate?.let { withContext(NonCancellable) { it.await() } }
        return GeneratedImage("QUJD", "image/png")
    }

    override suspend fun startVideoGeneration(prompt: String, aspectRatio: String) = "job1"

    override suspend fun getVideoStatus(jobId: String): VideoStatus = videoStatuses.removeAt(0)

    /** Yanıttan önce gelen birikimli düşünce metinleri. */
    var thoughts = emptyList<String>()

    override suspend fun streamChat(request: ChatStreamRequest, onReasoning: (String) -> Unit, onText: (String) -> Unit): String {
        requests += request
        error?.let { throw it }
        thoughts.forEach(onReasoning)
        parts.forEachIndexed { i, p ->
            onText(p)
            if (i == 0) gate?.await()
        }
        return parts.lastOrNull() ?: ""
    }
}

private class InMemoryChatStore : ChatStore {
    val saved = mutableMapOf<String, StoredChat>()
    private val flow = MutableStateFlow<List<ChatSummary>?>(null)
    override val chats: StateFlow<List<ChatSummary>?> = flow
    var owner: String? = "unset"
    /** Her kaydın hangi hesabın geçmişine yazıldığı: (sahip, sohbet kimliği). */
    val upserts = mutableListOf<Pair<String?, String>>()
    private fun publish() { flow.value = saved.values.map { it.toSummary() } }
    override suspend fun setOwner(email: String?) { owner = email; publish() }
    override suspend fun get(id: String) = saved[id]
    override suspend fun upsert(chat: StoredChat) { upserts += owner to chat.id; saved[chat.id] = chat; publish() }
    override suspend fun togglePin(id: String) = Unit
    override suspend fun rename(id: String, title: String) = Unit
    override suspend fun delete(id: String) { saved.remove(id); publish() }
    override suspend fun all() = saved.values.toList()
    override suspend fun replaceAll(chats: List<StoredChat>) { saved.clear(); chats.forEach { saved[it.id] = it }; publish() }
}

private class FakeMedia : MediaFiles {
    val library = mutableListOf<String>()
    override suspend fun read(uri: String) = byteArrayOf(1, 2)
    override suspend fun saveGeneratedImage(base64: String, mimeType: String, timestamp: Long) = "file:///gen-$timestamp.png"
    override suspend fun addToLibrary(uri: String, prompt: String?, generated: Boolean) { library += uri }
}

private class FakeLocalAi : LocalAi {
    val changesFlow = MutableStateFlow(0)
    override val changes: StateFlow<Int> = changesFlow
    var downloaded = listOf<com.tyler.kocamind.data.offline.OfflineModel>()
    var selectedId = "qwen3.5-2b"
    var manualSelections = mutableListOf<String>()
    var reply = "Yerel cevap"
    var error: Exception? = null
    var lastHistory = emptyList<Pair<String, String>>()
    var lastMemory: String? = null
    var stopped = false
    /** Doluysa ilk parçadan sonra bu kapıyı bekler. */
    var gate: CompletableDeferred<Unit>? = null
    override fun downloadedModels() = downloaded
    override fun selectedModelId() = selectedId
    override suspend fun select(id: String, preserveAutoMode: Boolean) { selectedId = id; if (!preserveAutoMode) manualSelections += id }
    override suspend fun generate(history: List<Pair<String, String>>, onPartial: (String) -> Unit, customInstructions: String?, memoryContext: String?): String {
        lastHistory = history
        lastMemory = memoryContext
        error?.let { throw it }
        onPartial(reply.take(4))
        gate?.await()
        return reply
    }
    override fun stop() { stopped = true }
}

private class FakeChatMemory : com.tyler.kocamind.data.memory.ChatMemorySource {
    val remembered = mutableListOf<String>()
    var summary: String? = "- özet"
    val summarized = mutableListOf<Int>()
    override fun promptFor(text: String) = "Kullanıcı hakkında hafızandaki bilgiler: - isim: Bekir"
    var savedKeys = emptyList<String>()
    val forgotten = mutableListOf<List<String>>()
    var forgetOk = true
    override fun rememberInBackground(text: String, onSaved: (List<String>) -> Unit) {
        remembered += text
        if (savedKeys.isNotEmpty()) onSaved(savedKeys)
    }
    override suspend fun forget(keys: List<String>): Boolean { forgotten += keys; return forgetOk }
    override suspend fun summarize(previous: String?, messages: List<com.tyler.kocamind.data.memory.SummaryMessage>): String? {
        summarized += messages.size
        return summary
    }
}

private class FakePrefs : ChatPrefs {
    override var selectedModelId: String? = null
    override var assistantMode: String? = null
    var instructions = ""
    override fun customInstructions(email: String?) = instructions
}

@OptIn(ExperimentalCoroutinesApi::class)
class ChatViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val auth = FakeAuthRepository()
    private val backend = FakeChatBackend()
    private val store = InMemoryChatStore()
    private val commands = ChatCommands()
    private val prefs = FakePrefs()
    private var clock = 1_000L
    private val network = MutableStateFlow(true)
    private val queue = com.tyler.kocamind.data.queue.InMemoryOfflineQueue()
    private val syncedUids = mutableListOf<String>()
    private val memory = FakeChatMemory()
    private val media = FakeMedia()
    private val localAi = FakeLocalAi()
    private val qwenLocal = com.tyler.kocamind.data.offline.OFFLINE_MODELS.first { it.id == "qwen3.5-2b" }

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() = Dispatchers.resetMain()

    private suspend fun signIn(name: String? = "Bekir Koca") {
        auth.nextUser = AuthUser("u1", "b@k.com", name, emailVerified = true)
        auth.signInWithEmail("b@k.com", "x")
    }

    private fun TestScope.vm(): ChatViewModel =
        ChatViewModel(
            auth, backend, store, commands, prefs,
            network = network,
            queue = queue,
            cloudSync = { uid -> syncedUids += uid },
            media = media,
            localAi = localAi,
            memory = memory,
            now = { clock++ },
            saveScope = this,
        ).also { advanceUntilIdle() }

    private fun TestScope.events(vm: ChatViewModel): MutableList<ChatEvent> {
        val list = mutableListOf<ChatEvent>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { vm.events.collect { list += it } }
        return list
    }

    @Test
    fun signedIn_loadsModels_selectsDefault_andUserName() = runTest(dispatcher) {
        signIn()
        val vm = vm()
        val s = vm.state.value
        assertEquals("gpt-5.6-luna", s.selectedModel?.id)
        // İlk seçenek, indirilmemiş Yerel AI yer tutucusu.
        assertEquals(listOf("kocamind-local", "gpt-5.6-luna", "deepseek-v3"), s.models.map { it.id })
        assertEquals("Bekir Koca", s.userName)
        assertEquals("b@k.com", store.owner)
    }

    @Test
    fun storedModel_isRestored() = runTest(dispatcher) {
        prefs.selectedModelId = "deepseek-v3"
        signIn()
        assertEquals("deepseek-v3", vm().state.value.selectedModel?.id)
    }

    @Test
    fun send_withoutUser_alertsAndKeepsInput() = runTest(dispatcher) {
        val vm = vm()
        val ev = events(vm)
        vm.setInput("selam")
        vm.send()
        advanceUntilIdle()
        assertEquals(
            listOf(ChatEvent.Alert("Giriş gerekli", "Güvenli sohbet, web arama ve agent özellikleri için hesabına giriş yapmalısın.")),
            ev,
        )
        assertEquals("selam", vm.input.value)
        assertTrue(vm.state.value.messages.isEmpty())
    }

    @Test
    fun send_streamsReply_andSendsHistoryAndInstructions() = runTest(dispatcher) {
        signIn()
        prefs.instructions = "Kısa yaz"
        val vm = vm()
        vm.setInput("  Merhaba  ")
        vm.send()
        advanceUntilIdle()
        val msgs = vm.state.value.messages
        assertEquals(listOf("user" to "Merhaba", "model" to "Merhaba"), msgs.map { it.role to it.content })
        assertFalse(msgs.last().streaming)
        assertFalse(vm.state.value.isLoading)
        assertEquals("", vm.input.value)
        val req = backend.requests.single()
        assertEquals("openai", req.provider)
        assertEquals("gpt-5.6-luna", req.model)
        assertTrue(req.instructions!!.contains("Kullanıcı: Bekir Koca"))
        assertTrue(req.instructions!!.contains("Kullanıcının özel talimatları:\nKısa yaz"))
        assertEquals(emptyList<Any>(), req.history)
    }

    @Test
    fun send_withReasoning_keepsThinkingAndDuration_outOfHistory() = runTest(dispatcher) {
        signIn()
        backend.thoughts = listOf("Soruyu ", "Soruyu anlıyorum.")
        val vm = vm()
        vm.setInput("bir"); vm.send(); advanceUntilIdle()
        val reply = vm.state.value.messages.last()
        assertEquals("Merhaba", reply.content)
        assertEquals("Soruyu anlıyorum.", reply.thinking)
        assertTrue((reply.thinkingMs ?: -1) >= 0)
        vm.setInput("iki"); vm.send(); advanceUntilIdle()
        // Düşünce metni modele geçmiş olarak geri gönderilmez.
        assertEquals(listOf("user" to "bir", "model" to "Merhaba"), backend.requests[1].history.map { it.role to it.content })
    }

    @Test
    fun secondMessage_sendsPreviousAsHistory() = runTest(dispatcher) {
        signIn()
        val vm = vm()
        vm.setInput("bir"); vm.send(); advanceUntilIdle()
        vm.setInput("iki"); vm.send(); advanceUntilIdle()
        assertEquals(listOf("user" to "bir", "model" to "Merhaba"), backend.requests[1].history.map { it.role to it.content })
    }

    @Test
    fun error_showsMessageInBubble() = runTest(dispatcher) {
        signIn()
        backend.error = BackendException("Günlük limit doldu.")
        val vm = vm()
        vm.setInput("x"); vm.send(); advanceUntilIdle()
        assertEquals("Günlük limit doldu.", vm.state.value.messages.last().content)
        assertFalse(vm.state.value.isLoading)
    }

    @Test
    fun send_remembersQuietly_andAddsMemoryToInstructions() = runTest(dispatcher) {
        signIn()
        val vm = vm()
        vm.setInput("İstanbul'da yaşıyorum"); vm.send(); advanceUntilIdle()
        assertEquals(listOf("İstanbul'da yaşıyorum"), memory.remembered)
        assertTrue(backend.requests.single().instructions!!.contains("- isim: Bekir"))
        assertNull(backend.requests.single().historySummary)
    }

    @Test
    fun longChat_isSummarized_andOnlyRecentSent() = runTest(dispatcher) {
        signIn()
        val old = (0 until 80).map { ChatMessage("o$it", if (it % 2 == 0) "user" else "model", "x".repeat(2000)) }
        store.upsert(StoredChat("chat_long", "Uzun", "2026-10-12", messages = old))
        val vm = vm()
        commands.send(ChatCommand.LoadChat("chat_long")); advanceUntilIdle()
        vm.setInput("devam"); vm.send(); advanceUntilIdle()
        val request = backend.requests.single()
        assertEquals("- özet", request.historySummary)
        assertEquals(60, request.history.size)
        assertEquals(listOf(20), memory.summarized)
        assertEquals("- özet", vm.state.value.messages.first { it.id == "o19" }.contextSummary)
    }

    @Test
    fun summaryFailure_sendsFullHistory() = runTest(dispatcher) {
        signIn()
        memory.summary = null
        val old = (0 until 80).map { ChatMessage("o$it", if (it % 2 == 0) "user" else "model", "x".repeat(2000)) }
        store.upsert(StoredChat("chat_long", "Uzun", "2026-10-12", messages = old))
        val vm = vm()
        commands.send(ChatCommand.LoadChat("chat_long")); advanceUntilIdle()
        vm.setInput("devam"); vm.send(); advanceUntilIdle()
        assertNull(backend.requests.single().historySummary)
        assertEquals(80, backend.requests.single().history.size)
    }

    @Test
    fun createImageMessage_generatesImage_withoutMenu() = runTest(dispatcher) {
        signIn()
        val vm = vm()
        vm.setInput("Bana kırmızı bir araba görseli çiz"); vm.send(); advanceUntilIdle()
        assertEquals(listOf("Bana kırmızı bir araba görseli çiz" to "1:1"), backend.imagePrompts)
        assertEquals("Bana kırmızı bir araba görseli çiz", vm.state.value.messages.first { it.isUser }.content)
        assertTrue(backend.requests.isEmpty())
        assertEquals("", vm.input.value)
    }

    @Test
    fun researchMessage_usesDeepResearch_andPlainMessage_staysChat() = runTest(dispatcher) {
        signIn()
        val vm = vm()
        vm.setInput("Elektrikli arabalar hakkında detaylı araştırma yap"); vm.send(); advanceUntilIdle()
        assertEquals("deep_research", backend.agentRequests.single().mode)
        vm.setInput("naber"); vm.send(); advanceUntilIdle()
        assertEquals(1, backend.requests.size)
        assertEquals(1, backend.agentRequests.size)
    }

    @Test
    fun savedAgentMode_isIgnored_plainMessagesGoToChat() = runTest(dispatcher) {
        signIn()
        prefs.assistantMode = "agent"
        val vm = vm()
        vm.setInput("17 x 23 kaç eder"); vm.send(); advanceUntilIdle()
        assertEquals(1, backend.requests.size)
        assertTrue(backend.agentRequests.isEmpty())
    }

    @Test
    fun error_isMarked_andLeftOutOfNextHistory() = runTest(dispatcher) {
        signIn()
        backend.error = BackendException("Yapay zekâ servisine şu anda ulaşılamıyor.")
        val vm = vm()
        vm.setInput("ilk"); vm.send(); advanceUntilIdle()
        assertTrue(vm.state.value.messages.last().isError == true)
        backend.error = null
        vm.setInput("ikinci"); vm.send(); advanceUntilIdle()
        assertEquals(listOf("user" to "ilk"), backend.requests[1].history.map { it.role to it.content })
        assertNull(vm.state.value.messages.last().isError)
    }

    @Test
    fun stop_keepsPartialText_andEndsLoading() = runTest(dispatcher) {
        signIn()
        backend.gate = CompletableDeferred()
        val vm = vm()
        vm.setInput("x"); vm.send(); advanceUntilIdle()
        assertTrue(vm.state.value.isLoading)
        assertEquals("Mer", vm.state.value.messages.last().content)
        vm.stop(); advanceUntilIdle()
        val last = vm.state.value.messages.last()
        assertEquals("Mer", last.content)
        assertFalse(last.streaming)
        assertFalse(vm.state.value.isLoading)
    }

    @Test
    fun stop_beforeFirstToken_saysStopped() = runTest(dispatcher) {
        signIn()
        backend.parts = listOf("", "geç")
        backend.gate = CompletableDeferred()
        val vm = vm()
        vm.setInput("x"); vm.send(); advanceUntilIdle()
        vm.stop(); advanceUntilIdle()
        assertEquals("Üretim durduruldu.", vm.state.value.messages.last().content)
    }

    @Test
    fun edit_truncatesAndRestoresInput() = runTest(dispatcher) {
        signIn()
        val vm = vm()
        vm.setInput("bir"); vm.send(); advanceUntilIdle()
        vm.setInput("iki"); vm.send(); advanceUntilIdle()
        val second = vm.state.value.messages[2]
        vm.edit(second)
        assertEquals(2, vm.state.value.messages.size)
        assertEquals("iki", vm.input.value)
    }

    @Test
    fun retry_resendsPreviousUserMessage() = runTest(dispatcher) {
        signIn()
        val vm = vm()
        vm.setInput("soru"); vm.send(); advanceUntilIdle()
        backend.parts = listOf("Yeni cevap")
        vm.retry(vm.state.value.messages.last()); advanceUntilIdle()
        assertEquals(listOf("soru", "Yeni cevap"), vm.state.value.messages.map { it.content })
        assertEquals("soru", backend.requests.last().message)
    }

    @Test
    fun chat_isSavedAfterDebounce_withTitleFromFirstMessage() = runTest(dispatcher) {
        signIn()
        val vm = vm()
        vm.setInput("Kotlin ile Android uygulaması nasıl yazılır, adım adım anlatır mısın lütfen?")
        vm.send(); advanceTimeBy(100)
        assertTrue(store.saved.isEmpty())
        advanceUntilIdle()
        val chat = store.saved.values.single()
        assertEquals("Kotlin ile Android uygulaması nasıl yazılır, adım adım", chat.title)
        assertEquals(2, chat.messages.size)
    }

    @Test
    fun newChatCommand_clears() = runTest(dispatcher) {
        signIn()
        val vm = vm()
        vm.setInput("x"); vm.send(); advanceUntilIdle()
        commands.send(ChatCommand.NewChat); advanceUntilIdle()
        assertTrue(vm.state.value.messages.isEmpty())
        assertNull(vm.state.value.chatId)
    }

    @Test
    fun openChatId_isPublishedForSettingsExport() = runTest(dispatcher) {
        signIn()
        store.upsert(StoredChat("chat_9", "Eski", "2026-01-01", messages = listOf(ChatMessage("1", "user", "eski soru"))))
        vm()
        commands.send(ChatCommand.LoadChat("chat_9")); advanceUntilIdle()
        assertEquals("chat_9", commands.openChatId.value)
        commands.send(ChatCommand.NewChat); advanceUntilIdle()
        assertNull(commands.openChatId.value)
    }

    @Test
    fun loadChatCommand_loadsFromStore() = runTest(dispatcher) {
        signIn()
        store.upsert(StoredChat("chat_9", "Eski", "2026-01-01", messages = listOf(ChatMessage("1", "user", "eski soru"))))
        val vm = vm()
        commands.send(ChatCommand.LoadChat("chat_9")); advanceUntilIdle()
        assertEquals("chat_9", vm.state.value.chatId)
        assertEquals("eski soru", vm.state.value.messages.single().content)
    }

    @Test
    fun deletingOpenChat_clearsScreen() = runTest(dispatcher) {
        signIn()
        val vm = vm()
        vm.setInput("x"); vm.send(); advanceUntilIdle()
        val id = vm.state.value.chatId!!
        store.delete(id); advanceUntilIdle()
        assertTrue(vm.state.value.messages.isEmpty())
    }

    @Test
    fun selectingLocalPlaceholder_asksToDownload() = runTest(dispatcher) {
        signIn()
        val vm = vm()
        val ev = events(vm)
        vm.selectModel(vm.state.value.models.first()); advanceUntilIdle()
        assertEquals(
            listOf(ChatEvent.Alert("Önce yerel modeli indir", "İnternetsiz kullanmak istediğin modeli önce telefona indir.", ChatAlertAction.OpenOfflineModels)),
            ev,
        )
        assertEquals("gpt-5.6-luna", vm.state.value.selectedModel?.id)
    }

    @Test
    fun selectModel_persists() = runTest(dispatcher) {
        signIn()
        val vm = vm()
        vm.selectModel(vm.state.value.models.last()); advanceUntilIdle()
        assertEquals("deepseek-v3", vm.state.value.selectedModel?.id)
        assertEquals("deepseek-v3", prefs.selectedModelId)
    }

    @Test
    fun feedback_isRecorded() = runTest(dispatcher) {
        val vm = vm()
        vm.feedback("m1", Feedback.Up)
        assertEquals(Feedback.Up, vm.state.value.feedbacks["m1"])
    }

    @Test
    fun feedback_downUpdatesLocally_andWaitsForSheet() = runTest(dispatcher) {
        signIn()
        val streamGate = CompletableDeferred<Unit>()
        backend.gate = streamGate
        val vm = vm()
        vm.setInput("soru"); vm.send(); runCurrent()
        clock += 250
        streamGate.complete(Unit)
        advanceUntilIdle()
        val answer = vm.state.value.messages.last()

        vm.feedback(answer.id, Feedback.Down)
        assertEquals(Feedback.Down, vm.state.value.feedbacks[answer.id])
        val pending = requireNotNull(vm.state.value.pendingFeedback)
        advanceUntilIdle()
        assertTrue(backend.feedbackRequests.isEmpty())

        vm.submitFeedback(pending, "incomplete", "Örnek eksik.")
        vm.submitFeedback(pending)
        advanceUntilIdle()
        assertNull(vm.state.value.pendingFeedback)
        assertEquals(pending.copy(reason = "incomplete", note = "Örnek eksik."), backend.feedbackRequests.single())
        assertEquals(1L, answer.thinkingMs)
        assertEquals(252L, answer.latencyMs)
        assertEquals(252L, pending.latencyMs)
    }

    @Test
    fun feedback_legacyAnswerOmitsLatency_andQueueChatSwitchSubmitsPendingDown() = runTest(dispatcher) {
        signIn()
        network.value = false
        store.upsert(StoredChat(id = "old", updatedAt = "2026-01-01T00:00:00Z", messages = listOf(
            ChatMessage("answer", "model", "Eski yanıt", thinkingMs = 120, answeredBy = "openai/gpt"),
        )))
        val vm = vm()
        commands.send(ChatCommand.LoadChat("old")); advanceUntilIdle()
        vm.feedback("answer", Feedback.Down)
        val pending = requireNotNull(vm.state.value.pendingFeedback)
        assertNull(pending.latencyMs)
        assertTrue(backend.feedbackRequests.isEmpty())

        queue.enqueue(content = "bekleyen", ownerId = "u1", chatId = "queued", now = 5)
        network.value = true
        advanceUntilIdle()

        assertEquals("queued", vm.state.value.chatId)
        assertNull(vm.state.value.pendingFeedback)
        assertEquals(pending, backend.feedbackRequests.single())
        assertNull(backend.feedbackRequests.single().reason)
    }

    @Test
    fun feedback_accountSwitchCancelsInFlightAndWaitingVotes() = runTest(dispatcher) {
        signIn()
        val vm = vm()
        vm.setInput("ilk hesap"); vm.send(); advanceUntilIdle()
        val id = vm.state.value.messages.last().id
        val blockedFeedback = CompletableDeferred<Unit>()
        backend.feedbackGate = blockedFeedback

        vm.feedback(id, Feedback.Up)
        runCurrent()
        assertEquals(1, backend.startedFeedbacks)
        vm.feedback(id, Feedback.Up)
        runCurrent()
        assertEquals(1, backend.startedFeedbacks)

        auth.nextUser = AuthUser("u2", "c@d.com", "Can", emailVerified = true)
        auth.signInWithEmail("c@d.com", "x")
        advanceUntilIdle()
        blockedFeedback.complete(Unit)
        advanceUntilIdle()
        assertEquals(1, backend.startedFeedbacks)
        assertTrue(backend.feedbackRequests.isEmpty())

        vm.setInput("yeni hesap"); vm.send(); advanceUntilIdle()
        vm.feedback(vm.state.value.messages.last().id, Feedback.Up)
        advanceUntilIdle()
        assertEquals("yeni hesap", backend.feedbackRequests.single().question)
    }

    @Test
    fun feedback_skipThenUndo_sendsPlainDownThenClearsVote() = runTest(dispatcher) {
        signIn()
        val vm = vm()
        vm.setInput("soru"); vm.send(); advanceUntilIdle()
        val id = vm.state.value.messages.last().id

        vm.feedback(id, Feedback.Down)
        val pending = requireNotNull(vm.state.value.pendingFeedback)
        vm.submitFeedback(pending)
        vm.feedback(id, Feedback.Down)
        assertNull(vm.state.value.feedbacks[id])
        assertNull(vm.state.value.pendingFeedback)
        advanceUntilIdle()

        assertEquals(listOf(pending, pending.copy(type = null)), backend.feedbackRequests)
    }

    @Test
    fun jailbreakBlocked_showsServerMessageInErrorReply() = runTest(dispatcher) {
        signIn()
        val message = "Bu mesaj güvenlik filtresine takıldı ve modele iletilmedi. Sorunu farklı şekilde sorabilirsin."
        backend.error = com.tyler.kocamind.data.backend.BackendException(message)
        val vm = vm()
        vm.setInput("örnek"); vm.send(); advanceUntilIdle()
        val reply = vm.state.value.messages.last()
        assertEquals(true, reply.isError)
        assertEquals(message, reply.content)
    }

    @Test
    fun offline_queuesMessage_andShowsNotice() = runTest(dispatcher) {
        signIn()
        network.value = false
        val vm = vm()
        vm.setInput("internetsiz soru"); vm.send(); advanceUntilIdle()
        val queued = queue.all().single()
        assertEquals("internetsiz soru", queued.content)
        assertEquals("u1", queued.ownerId)
        assertEquals(vm.state.value.chatId, queued.chatId)
        assertEquals(
            "İnternet yok. Mesajın kuyruğa alındı; bağlantı gelince gönderilecek.",
            vm.state.value.messages.single().content,
        )
        assertEquals(1, vm.state.value.queuedCount)
        assertTrue(backend.requests.isEmpty())
    }

    @Test
    fun offline_withoutUser_alerts() = runTest(dispatcher) {
        network.value = false
        val vm = vm()
        val ev = events(vm)
        vm.setInput("x"); vm.send(); advanceUntilIdle()
        assertEquals(
            listOf(ChatEvent.Alert("Giriş gerekli", "İnternet yokken mesajı daha sonra göndermek için hesabına giriş yapmış olmalısın.")),
            ev,
        )
        assertTrue(queue.all().isEmpty())
    }

    @Test
    fun backOnline_syncsCloud_andFlushesQueueIntoItsChat() = runTest(dispatcher) {
        signIn()
        network.value = false
        val vm = vm()
        val ev = events(vm)
        vm.setInput("bekleyen"); vm.send(); advanceUntilIdle()
        val chatId = vm.state.value.chatId
        network.value = true
        advanceUntilIdle()
        assertEquals(listOf("u1"), syncedUids.distinct())
        assertEquals("bekleyen", backend.requests.single().message)
        assertTrue(queue.all().isEmpty())
        assertEquals(chatId, vm.state.value.chatId)
        assertEquals(listOf("bekleyen", "Merhaba"), vm.state.value.messages.takeLast(2).map { it.content })
        assertEquals(0, vm.state.value.queuedCount)
        assertTrue(ev.contains(ChatEvent.Toast("Bekleyen mesajlar gönderildi")))
    }

    @Test
    fun flushFailure_keepsMessageQueued() = runTest(dispatcher) {
        signIn()
        network.value = false
        val vm = vm()
        vm.setInput("bekleyen"); vm.send(); advanceUntilIdle()
        backend.error = BackendException("Sunucu hatası")
        network.value = true
        advanceUntilIdle()
        assertEquals(1, queue.all().size)
        assertEquals(1, vm.state.value.queuedCount)
    }

    @Test
    fun queueIsPerUser() = runTest(dispatcher) {
        queue.enqueue(content = "başkasının", ownerId = "other", chatId = "chat_x", now = 1)
        signIn()
        val vm = vm()
        assertEquals(0, vm.state.value.queuedCount)
        assertTrue(backend.requests.isEmpty())
    }

    @Test
    fun signOutWhileReplyStreams_savesChatOnlyToItsOwner_andClearsScreen() = runTest(dispatcher) {
        signIn()
        val vm = vm()
        backend.gate = CompletableDeferred()
        vm.setInput("gizli soru"); vm.send(); advanceUntilIdle()
        val chatId = vm.state.value.chatId!!
        auth.signOut(); advanceUntilIdle()
        backend.gate!!.complete(Unit); advanceUntilIdle()
        assertTrue(store.upserts.contains("b@k.com" to chatId))
        assertEquals(emptyList<Pair<String?, String>>(), store.upserts.filter { (owner, id) -> owner != "b@k.com" && id == chatId })
        assertNull(vm.state.value.chatId)
        assertTrue(vm.state.value.messages.isEmpty())
        assertFalse(vm.state.value.isLoading)
    }

    @Test
    fun accountSwitchDuringQueueFlush_stopsFlush_andNeverSendsForNextAccount() = runTest(dispatcher) {
        queue.enqueue(content = "birinci", ownerId = "u1", chatId = "chat_a", now = 5)
        queue.enqueue(content = "ikinci", ownerId = "u1", chatId = "chat_b", now = 9)
        backend.gate = CompletableDeferred()
        signIn()
        vm()
        assertEquals(listOf("birinci"), backend.requests.map { it.message })
        auth.signOut(); advanceUntilIdle()
        backend.gate!!.complete(Unit); advanceUntilIdle()
        auth.nextUser = AuthUser("u2", "c@d.com", "Can", emailVerified = true)
        auth.signInWithEmail("c@d.com", "x"); advanceUntilIdle()
        assertEquals(listOf("birinci"), backend.requests.map { it.message })
        assertEquals(listOf("ikinci"), queue.all().filter { it.chatId == "chat_b" }.map { it.content })
        assertTrue(store.upserts.none { (owner, id) -> owner != "b@k.com" && id in setOf("chat_a", "chat_b") })
    }

    @Test
    fun remoteMessageInOpenChat_showsWhenIdle_andIsKeptOnNextSave() = runTest(dispatcher) {
        signIn()
        val vm = vm()
        vm.setInput("x"); vm.send(); advanceUntilIdle()
        val id = vm.state.value.chatId!!
        val saved = store.saved[id]!!
        // Başka cihaz aynı sohbete mesaj ekledi; eşitleme yerel depoya yazdı.
        store.upsert(saved.copy(updatedAt = "2030-01-01T00:00:00Z", messages = saved.messages + ChatMessage("r1", "model", "webden", timestamp = 5_000)))
        advanceUntilIdle()
        assertEquals(listOf("x", "Merhaba", "webden"), vm.state.value.messages.map { it.content })
        vm.setInput("y"); vm.send(); advanceUntilIdle()
        assertEquals(listOf("x", "Merhaba", "webden", "y", "Merhaba"), store.saved[id]!!.messages.map { it.content })
    }

    @Test
    fun remoteMessageWhileReplyStreams_isMergedOnSave() = runTest(dispatcher) {
        signIn()
        val vm = vm()
        vm.setInput("x"); vm.send(); advanceUntilIdle()
        val id = vm.state.value.chatId!!
        backend.gate = CompletableDeferred()
        vm.setInput("y"); vm.send(); advanceUntilIdle()
        // Eşitleme, buluta henüz gitmemiş akan cevabı korur; yalnızca uzak mesajı ekler.
        val saved = store.saved[id]!!
        store.upsert(saved.copy(messages = saved.messages + ChatMessage("r1", "model", "webden", timestamp = 5_000)))
        advanceUntilIdle()
        backend.gate!!.complete(Unit); advanceUntilIdle()
        val contents = store.saved[id]!!.messages.map { it.content }
        assertTrue(contents.containsAll(listOf("x", "y", "webden")))
        assertEquals(2, contents.count { it == "Merhaba" })
        assertEquals(contents, vm.state.value.messages.map { it.content })
    }

    @Test
    fun queuedMessageAlreadyInChat_isNotSentTwice() = runTest(dispatcher) {
        // Gönderildikten sonra kuyruktan silinemeden uygulama kapandıysa mesaj sohbette zaten vardır.
        store.upsert(StoredChat("chat_q", "Eski", "2026-01-01", messages = listOf(ChatMessage("5", "user", "bekleyen"), ChatMessage("6", "model", "cevap"))))
        queue.enqueue(content = "bekleyen", ownerId = "u1", chatId = "chat_q", now = 5)
        signIn()
        vm()
        assertTrue(backend.requests.isEmpty())
        assertTrue(queue.all().isEmpty())
    }

    @Test
    fun deepResearch_usesAgent_showsStepsAndPersistsMode() = runTest(dispatcher) {
        signIn()
        val vm = vm()
        vm.setMode(AssistantMode.DeepResearch)
        assertEquals("deep_research", prefs.assistantMode)
        vm.setInput("araştır"); vm.send(); advanceUntilIdle()
        val req = backend.agentRequests.single()
        assertEquals("deep_research", req.mode)
        assertEquals("gpt-5.6-luna", req.model)
        val last = vm.state.value.messages.last()
        assertEquals("Rapor", last.content)
        assertEquals(1, last.agentSteps!!.size)
        assertNull(last.agentStatus)
        assertTrue(backend.requests.isEmpty())
    }

    @Test
    fun agent_withNonOpenAiModel_sendsNoModel() = runTest(dispatcher) {
        prefs.selectedModelId = "deepseek-v3"
        signIn()
        val vm = vm()
        vm.setMode(AssistantMode.Agent)
        vm.setInput("görev"); vm.send(); advanceUntilIdle()
        assertNull(backend.agentRequests.single().model)
    }

    @Test
    fun agentApproval_isAskedAndAnswered() = runTest(dispatcher) {
        signIn()
        backend.askApproval = true
        val vm = vm()
        vm.setMode(AssistantMode.Agent)
        vm.setInput("e-posta at"); vm.send(); advanceUntilIdle()
        // Soru ekran durumunda durur: ekran yeniden oluşsa da kaybolmaz.
        assertEquals("Gönderilsin mi?", vm.state.value.approval)
        vm.answerApproval(true)
        advanceUntilIdle()
        assertEquals(true, backend.approvalAnswer)
        assertNull(vm.state.value.approval)
        assertEquals("Rapor", vm.state.value.messages.last().content)
    }

    @Test
    fun stop_whileAskingApproval_clearsQuestion() = runTest(dispatcher) {
        signIn()
        backend.askApproval = true
        val vm = vm()
        vm.setMode(AssistantMode.Agent)
        vm.setInput("e-posta at"); vm.send(); advanceUntilIdle()
        vm.stop(); advanceUntilIdle()
        assertNull(vm.state.value.approval)
        assertFalse(vm.state.value.isLoading)
    }

    @Test
    fun imageAttachment_isAnalyzedAndAddedToPrompt() = runTest(dispatcher) {
        signIn()
        val vm = vm()
        vm.attachImage(Attachment("content://img/1", "image/jpeg", "foto.jpg"))
        assertTrue(vm.state.value.canSend(""))
        vm.send(); advanceUntilIdle()
        assertEquals("mobile-upload.jpg" to "image/jpeg", backend.uploads.single())
        val user = vm.state.value.messages.first()
        assertEquals("Bu fotoğrafı analiz et.", user.content)
        assertEquals("content://img/1", user.image)
        assertTrue(backend.requests.single().message.endsWith("Görsel incelemesinden çıkarılan bilgi:\nkedi var"))
        assertNull(vm.state.value.selectedImage)
    }

    @Test
    fun documentAttachment_contentIsAppended() = runTest(dispatcher) {
        signIn()
        val vm = vm()
        vm.attachDocument(Attachment("content://doc/1", "application/pdf", "rapor.pdf"))
        vm.setInput("özetle"); vm.send(); advanceUntilIdle()
        assertTrue(backend.requests.single().message.endsWith("rapor.pdf dosyasından çıkarılan içerik:\ndosya içeriği"))
    }

    @Test
    fun offlineWithAttachment_alertsAndKeepsIt() = runTest(dispatcher) {
        signIn()
        network.value = false
        val vm = vm()
        val ev = events(vm)
        vm.attachImage(Attachment("content://img/1", "image/png", "a.png"))
        vm.send(); advanceUntilIdle()
        assertEquals(ChatEvent.Alert("İnternet gerekli", "Fotoğraf ve dosyalar yalnızca internet varken gönderilebilir."), ev.single())
        assertEquals("content://img/1", vm.state.value.selectedImage?.uri)
        assertTrue(queue.all().isEmpty())
    }

    @Test
    fun generateImage_savesToLibraryAndShowsInChat() = runTest(dispatcher) {
        signIn()
        val vm = vm()
        vm.generateMedia(MediaKind.Image, "kedi", "1:1"); advanceUntilIdle()
        assertEquals("kedi" to "1:1", backend.imagePrompts.single())
        val (user, ai) = vm.state.value.messages
        assertEquals("Fotoğraf oluştur: kedi", user.content)
        assertEquals("Fotoğraf hazır.", ai.content)
        assertTrue(ai.generatedImage!!.startsWith("file:///gen-"))
        assertEquals(listOf(ai.generatedImage), media.library)
        assertFalse(vm.state.value.isLoading)
    }

    @Test
    fun generateVideo_pollsUntilReady() = runTest(dispatcher) {
        signIn()
        val vm = vm()
        vm.generateMedia(MediaKind.Video, "taksi", "1:1"); advanceUntilIdle()
        val ai = vm.state.value.messages.last()
        assertEquals("Video hazır. Oynatabilir veya paylaşabilirsin.", ai.content)
        assertEquals("https://v.mp4", ai.generatedVideo)
        assertEquals("job1", ai.mediaJobId)
    }

    @Test
    fun generateMedia_withoutUser_alerts() = runTest(dispatcher) {
        val vm = vm()
        val ev = events(vm)
        vm.generateMedia(MediaKind.Image, "kedi", "1:1"); advanceUntilIdle()
        assertEquals(ChatEvent.Alert("Giriş gerekli", "Fotoğraf ve video oluşturmak için hesabına giriş yapmalısın."), ev.single())
    }

    @Test
    fun checkVideo_updatesPendingJob() = runTest(dispatcher) {
        signIn()
        backend.videoStatuses = mutableListOf(VideoStatus("completed", "https://v2.mp4", null))
        store.upsert(StoredChat("chat_v", "Video", "2026-01-01", messages = listOf(ChatMessage("9", "model", "Video üretimi arka planda devam ediyor.", mediaJobId = "job9"))))
        val vm = vm()
        commands.send(ChatCommand.LoadChat("chat_v")); advanceUntilIdle()
        vm.checkVideo(vm.state.value.messages.single()); advanceUntilIdle()
        assertEquals("https://v2.mp4", vm.state.value.messages.single().generatedVideo)
    }

    @Test
    fun transcription_isAppendedToInput() = runTest(dispatcher) {
        signIn()
        val vm = vm()
        vm.setInput("önce")
        vm.transcribe(byteArrayOf(1)); advanceUntilIdle()
        assertEquals("önce sesli not", vm.input.value)
    }

    @Test
    fun downloadedLocalModels_appearFirst_withBadge() = runTest(dispatcher) {
        localAi.downloaded = listOf(qwenLocal)
        signIn()
        val vm = vm()
        val first = vm.state.value.models.first()
        assertEquals("kocamind-local:qwen3.5-2b", first.id)
        assertEquals("Qwen 3.5 (2B)", first.label)
        assertEquals("Bu cihaz", first.providerName)
        assertEquals("Telefonda hazır", first.badge)
        assertTrue(first.available)
    }

    @Test
    fun legacyLocalSelection_isMigrated() = runTest(dispatcher) {
        localAi.downloaded = listOf(qwenLocal)
        prefs.selectedModelId = "kocamind-local"
        val vm = vm()
        assertEquals("kocamind-local:qwen3.5-2b", vm.state.value.selectedModel?.id)
    }

    @Test
    fun selectingLocalModel_selectsOfflineModel_andForcesChatMode() = runTest(dispatcher) {
        localAi.downloaded = listOf(qwenLocal)
        signIn()
        val vm = vm()
        vm.setMode(AssistantMode.Agent)
        vm.selectModel(vm.state.value.models.first()); advanceUntilIdle()
        assertEquals(listOf("qwen3.5-2b"), localAi.manualSelections)
        assertEquals(AssistantMode.Chat, vm.state.value.mode)
        assertTrue(vm.state.value.isLocalSelected)
    }

    @Test
    fun localSend_worksOfflineAndWithoutAccount_usesMemory() = runTest(dispatcher) {
        localAi.downloaded = listOf(qwenLocal)
        prefs.selectedModelId = "kocamind-local:qwen3.5-2b"
        network.value = false
        store.upsert(StoredChat("eski", "Kedi", "2026-10-01T10:00:00Z", messages = listOf(ChatMessage("1", "user", "Kedim Pamuk mama yemiyor"))))
        val vm = vm()
        vm.setInput("Pamuk kedim yine mama yemiyor"); vm.send(); advanceUntilIdle()
        val (user, ai) = vm.state.value.messages
        assertEquals("Pamuk kedim yine mama yemiyor", user.content)
        assertEquals("Yerel cevap", ai.content)
        assertFalse(ai.streaming)
        assertEquals(listOf("user" to "Pamuk kedim yine mama yemiyor"), localAi.lastHistory)
        assertTrue(localAi.lastMemory!!.contains("Kedim Pamuk mama yemiyor"))
        // Bulut hafızasındaki (cihazdaki kopya) kullanıcı bilgileri de yerel modele gider.
        assertTrue(localAi.lastMemory!!.contains("- isim: Bekir"))
        assertTrue(backend.requests.isEmpty())
        assertTrue(queue.all().isEmpty())
    }

    @Test
    fun localSend_withAttachmentOrAgent_alerts() = runTest(dispatcher) {
        localAi.downloaded = listOf(qwenLocal)
        prefs.selectedModelId = "kocamind-local:qwen3.5-2b"
        val vm = vm()
        val ev = events(vm)
        vm.attachImage(Attachment("content://x", "image/png", "x.png"))
        vm.send(); advanceUntilIdle()
        assertEquals(
            ChatEvent.Alert("Yerel AI metin sohbeti içindir", "Fotoğraf, dosya, Derin Araştırma ve Agent özellikleri internet bağlantılı modellerle çalışır."),
            ev.single(),
        )
    }

    @Test
    fun localError_isShownInBubble() = runTest(dispatcher) {
        localAi.downloaded = listOf(qwenLocal)
        localAi.error = IllegalStateException("Bellek yetmedi")
        prefs.selectedModelId = "kocamind-local:qwen3.5-2b"
        val vm = vm()
        vm.setInput("merhaba"); vm.send(); advanceUntilIdle()
        assertEquals("Çevrimdışı model çalıştırılamadı: Bellek yetmedi", vm.state.value.messages.last().content)
    }

    @Test
    fun localModelDeleted_fallsBackToPlaceholderAndClearsSelection() = runTest(dispatcher) {
        localAi.downloaded = listOf(qwenLocal)
        prefs.selectedModelId = "kocamind-local:qwen3.5-2b"
        val vm = vm()
        assertTrue(vm.state.value.isLocalSelected)
        localAi.downloaded = emptyList()
        localAi.changesFlow.value++
        advanceUntilIdle()
        assertEquals("kocamind-local", vm.state.value.models.first().id)
        assertNull(vm.state.value.selectedModel)
        assertNull(prefs.selectedModelId)
    }

    @Test
    fun stop_whileLocal_stopsEngine() = runTest(dispatcher) {
        localAi.downloaded = listOf(qwenLocal)
        prefs.selectedModelId = "kocamind-local:qwen3.5-2b"
        val vm = vm()
        vm.stop()
        assertTrue(localAi.stopped)
    }

    // ------------------------------------------------------------------ inceleme düzeltmeleri

    @Test
    fun staleCancelledOperation_doesNotEndNewerOperation() = runTest(dispatcher) {
        signIn()
        val vm = vm()
        backend.imageGate = CompletableDeferred()
        vm.generateMedia(MediaKind.Image, "kedi", "1:1"); advanceUntilIdle()
        vm.stop(); advanceUntilIdle()
        backend.gate = CompletableDeferred()
        vm.setInput("x"); vm.send(); advanceUntilIdle()
        assertTrue(vm.state.value.isLoading)
        // Durdurulan görsel isteği şimdi dönüyor; yeni sohbet akışını bitmiş saymamalı.
        backend.imageGate!!.complete(Unit); advanceUntilIdle()
        assertTrue(vm.state.value.isLoading)
        backend.gate!!.complete(Unit); advanceUntilIdle()
        assertFalse(vm.state.value.isLoading)
        assertEquals("Merhaba", vm.state.value.messages.last().content)
    }

    @Test
    fun newChat_stopsLocalGeneration() = runTest(dispatcher) {
        localAi.downloaded = listOf(qwenLocal)
        prefs.selectedModelId = "kocamind-local:qwen3.5-2b"
        localAi.gate = CompletableDeferred()
        val vm = vm()
        vm.setInput("merhaba"); vm.send(); advanceUntilIdle()
        commands.send(ChatCommand.NewChat); advanceUntilIdle()
        assertTrue(localAi.stopped)
    }

    @Test
    fun loadChat_stopsLocalGeneration() = runTest(dispatcher) {
        localAi.downloaded = listOf(qwenLocal)
        prefs.selectedModelId = "kocamind-local:qwen3.5-2b"
        localAi.gate = CompletableDeferred()
        store.upsert(StoredChat("chat_9", "Eski", "2026-01-01", messages = listOf(ChatMessage("1", "user", "eski soru"))))
        val vm = vm()
        vm.setInput("merhaba"); vm.send(); advanceUntilIdle()
        commands.send(ChatCommand.LoadChat("chat_9")); advanceUntilIdle()
        assertTrue(localAi.stopped)
    }

    @Test
    fun stop_cancelsQueueFlush() = runTest(dispatcher) {
        signIn()
        network.value = false
        val vm = vm()
        vm.setInput("bekleyen"); vm.send(); advanceUntilIdle()
        backend.gate = CompletableDeferred()
        network.value = true; advanceUntilIdle()
        assertTrue(vm.state.value.isLoading)
        vm.stop(); advanceUntilIdle()
        backend.gate!!.complete(Unit); advanceUntilIdle()
        val last = vm.state.value.messages.last()
        assertEquals("Mer", last.content)
        assertFalse(last.streaming)
        assertFalse(vm.state.value.isLoading)
    }

    @Test
    fun queueFlush_waitsUntilUserReplyFinishes() = runTest(dispatcher) {
        signIn()
        val vm = vm()
        backend.gate = CompletableDeferred()
        vm.setInput("şimdiki soru"); vm.send(); advanceUntilIdle()
        val userChat = vm.state.value.chatId
        queue.enqueue(content = "bekleyen", ownerId = "u1", chatId = "chat_q", now = 5)
        network.value = false; advanceUntilIdle()
        network.value = true; advanceUntilIdle()
        // Kullanıcının açık sohbeti ve akışı korunur, kuyruk beklemede.
        assertEquals(userChat, vm.state.value.chatId)
        assertEquals(1, backend.requests.size)
        backend.gate!!.complete(Unit); advanceUntilIdle()
        assertEquals(listOf("şimdiki soru", "bekleyen"), backend.requests.map { it.message })
        assertEquals("Merhaba", store.saved[userChat]!!.messages.last().content)
        assertTrue(queue.all().isEmpty())
    }

    @Test
    fun queueFlush_withLocalModelSelected_sendsWithCloudModel() = runTest(dispatcher) {
        localAi.downloaded = listOf(qwenLocal)
        prefs.selectedModelId = "kocamind-local:qwen3.5-2b"
        queue.enqueue(content = "bekleyen", ownerId = "u1", chatId = "chat_q", now = 5)
        signIn()
        vm()
        val request = backend.requests.single()
        assertEquals("openai", request.provider)
        assertEquals("gpt-5.6-luna", request.model)
        assertTrue(queue.all().isEmpty())
    }

    @Test
    fun isOnline_updatesWhileQueueFlushes() = runTest(dispatcher) {
        signIn()
        network.value = false
        val vm = vm()
        vm.setInput("bekleyen"); vm.send(); advanceUntilIdle()
        backend.gate = CompletableDeferred()
        network.value = true; advanceUntilIdle()
        network.value = false; advanceUntilIdle()
        assertFalse(vm.state.value.isOnline)
        backend.gate!!.complete(Unit); advanceUntilIdle()
    }

    @Test
    fun switchingChatRightAfterReply_stillSavesReply() = runTest(dispatcher) {
        signIn()
        val vm = vm()
        vm.setInput("x"); vm.send(); runCurrent()
        val id = vm.state.value.chatId!!
        commands.send(ChatCommand.NewChat); advanceUntilIdle()
        assertEquals(listOf("x", "Merhaba"), store.saved[id]!!.messages.map { it.content })
    }

    @Test
    fun queueFlushAcrossTwoChats_savesBothReplies() = runTest(dispatcher) {
        queue.enqueue(content = "birinci", ownerId = "u1", chatId = "chat_a", now = 5)
        queue.enqueue(content = "ikinci", ownerId = "u1", chatId = "chat_b", now = 9)
        signIn()
        vm()
        assertEquals("Merhaba", store.saved["chat_a"]!!.messages.last().content)
        assertEquals("Merhaba", store.saved["chat_b"]!!.messages.last().content)
        assertFalse(store.saved["chat_a"]!!.messages.any { it.streaming })
    }

    @Test
    fun loadChat_finishesLeftoverStreamingMessages() = runTest(dispatcher) {
        signIn()
        store.upsert(
            StoredChat(
                "chat_9", "Eski", "2026-01-01",
                messages = listOf(ChatMessage("1", "user", "soru"), ChatMessage("2", "model", "", isStreaming = true)),
            ),
        )
        val vm = vm()
        commands.send(ChatCommand.LoadChat("chat_9")); advanceUntilIdle()
        val last = vm.state.value.messages.last()
        assertFalse(last.streaming)
        assertEquals("Üretim durduruldu.", last.content)
    }

    @Test
    fun clearingViewModel_savesAndStopsLocal() = runTest(dispatcher) {
        localAi.downloaded = listOf(qwenLocal)
        prefs.selectedModelId = "kocamind-local:qwen3.5-2b"
        val owner = ViewModelStore()
        val vm = ViewModelProvider(
            owner,
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T = vm() as T
            },
        )[ChatViewModel::class.java]
        localAi.gate = CompletableDeferred()
        vm.setInput("merhaba"); vm.send(); runCurrent()
        val id = vm.state.value.chatId!!
        owner.clear(); advanceUntilIdle()
        assertTrue(localAi.stopped)
        val saved = store.saved[id]!!.messages
        assertEquals("merhaba", saved.first().content)
        assertEquals("Yere", saved.last().content)
        assertFalse(saved.last().streaming)
    }

    @Test
    fun deepThink_isSentWithCloudRequest_untilTurnedOff() = runTest(dispatcher) {
        signIn()
        val vm = vm()
        assertFalse(vm.state.value.deepThink)
        vm.setDeepThink(true)
        vm.setInput("Bu ispatı kontrol et")
        vm.send()
        advanceUntilIdle()
        vm.setDeepThink(false)
        vm.setInput("Teşekkürler")
        vm.send()
        advanceUntilIdle()
        assertEquals(listOf(true, false), backend.requests.map { it.deepThink })
    }

    @Test
    fun quotaExceeded_marksExhausted_withoutErrorBubble() = runTest(dispatcher) {
        signIn()
        backend.error = com.tyler.kocamind.data.backend.QuotaExceededException("Günlük chat kullanım sınırına ulaştın.")
        val vm = vm()
        vm.setInput("selam"); vm.send(); advanceUntilIdle()
        assertTrue(vm.state.value.quotaExhausted)
        assertTrue(vm.state.value.messages.none { it.isError == true })
        assertEquals(listOf("selam"), vm.state.value.messages.map { it.content })
    }

    @Test
    fun cloudReply_copiesQuotaFromBackend() = runTest(dispatcher) {
        signIn()
        backend.quota = com.tyler.kocamind.data.backend.QuotaState(8, 50)
        val vm = vm()
        vm.setInput("selam"); vm.send(); advanceUntilIdle()
        assertEquals(com.tyler.kocamind.data.backend.QuotaState(8, 50), vm.state.value.quota)
        assertFalse(vm.state.value.quotaExhausted)
    }

    @Test
    fun localReply_isMarkedAsAnsweredOnDevice() = runTest(dispatcher) {
        localAi.downloaded = listOf(qwenLocal)
        prefs.selectedModelId = "kocamind-local:qwen3.5-2b"
        val vm = vm()
        vm.setInput("selam"); vm.send(); advanceUntilIdle()
        assertTrue(vm.state.value.messages.last().answeredBy!!.startsWith("local/"))
    }

    @Test
    fun savedMemory_isAnnounced_andCanBeUndone() = runTest(dispatcher) {
        signIn()
        memory.savedKeys = listOf("şehir")
        val vm = vm()
        val ev = events(vm)
        vm.setInput("İstanbul'da yaşıyorum"); vm.send(); advanceUntilIdle()
        assertTrue(ev.contains(ChatEvent.MemorySaved(listOf("şehir"))))
        vm.undoMemory(listOf("şehir")); advanceUntilIdle()
        assertEquals(listOf(listOf("şehir")), memory.forgotten)
        assertEquals(ChatEvent.Toast("Geri alındı"), ev.last())
        memory.forgetOk = false
        vm.undoMemory(listOf("şehir")); advanceUntilIdle()
        assertEquals(ChatEvent.Toast("Geri alınamadı"), ev.last())
    }

    @Test
    fun privateChat_usesOnlyLocalModel_andNeverSaves() = runTest(dispatcher) {
        localAi.downloaded = listOf(qwenLocal)
        signIn()
        val vm = vm()
        assertEquals("gpt-5.6-luna", vm.state.value.selectedModel?.id)
        vm.setPrivateChat(true)
        assertTrue(vm.state.value.privateChat)
        vm.setInput("gizli soru"); vm.send(); advanceUntilIdle()
        assertTrue(backend.requests.isEmpty())
        assertEquals("Yerel cevap", vm.state.value.messages.last().content)
        assertTrue(store.upserts.isEmpty())
        assertTrue(memory.remembered.isEmpty())
    }

    @Test
    fun privateChat_withoutLocalModel_pointsToDownloads() = runTest(dispatcher) {
        signIn()
        val vm = vm()
        val ev = events(vm)
        vm.setPrivateChat(true)
        assertFalse(vm.state.value.privateChat)
        assertEquals(
            ChatEvent.Alert("Yerel model gerekli", "Gizli sohbet telefondaki modelle çalışır. Önce bir model indir.", ChatAlertAction.OpenOfflineModels),
            ev.single(),
        )
    }

    @Test
    fun privateChat_cannotStartMidConversation_andEndsWithNewChat() = runTest(dispatcher) {
        localAi.downloaded = listOf(qwenLocal)
        signIn()
        val vm = vm()
        vm.setInput("selam"); vm.send(); advanceUntilIdle()
        vm.setPrivateChat(true)
        assertFalse(vm.state.value.privateChat)
        commands.send(ChatCommand.NewChat); advanceUntilIdle()
        vm.setPrivateChat(true)
        assertTrue(vm.state.value.privateChat)
        commands.send(ChatCommand.NewChat); advanceUntilIdle()
        assertFalse(vm.state.value.privateChat)
    }

    @Test
    fun instructions_includeHonestyRule() = runTest(dispatcher) {
        signIn()
        val vm = vm()
        vm.setInput("selam"); vm.send(); advanceUntilIdle()
        assertTrue(backend.requests.single().instructions!!.contains(HONESTY_RULE))
        assertEquals(
            "Bilmediğin ya da emin olmadığın bir konuda bunu açıkça söyle (\"Emin değilim\" de), tahmini tahmin olarak belirt; kaynak, rakam, tarih veya alıntı uydurma.",
            HONESTY_RULE,
        )
    }

    @Test
    fun privateChat_retry_neverReachesBackend() = runTest(dispatcher) {
        localAi.downloaded = listOf(qwenLocal)
        signIn()
        val vm = vm()
        vm.setPrivateChat(true)
        vm.setInput("gizli"); vm.send(); advanceUntilIdle()
        vm.retry(vm.state.value.messages.last()); advanceUntilIdle()
        assertTrue(backend.requests.isEmpty())
        assertTrue(memory.remembered.isEmpty())
        assertEquals("Yerel cevap", vm.state.value.messages.last().content)
    }

    @Test
    fun openingStoredChat_endsPrivateChat() = runTest(dispatcher) {
        localAi.downloaded = listOf(qwenLocal)
        signIn()
        store.upsert(StoredChat("eski", "Eski", "2026-10-01T10:00:00Z", messages = listOf(ChatMessage("1", "user", "merhaba"))))
        val vm = vm()
        vm.setPrivateChat(true)
        commands.send(ChatCommand.LoadChat("eski")); advanceUntilIdle()
        assertFalse(vm.state.value.privateChat)
    }

    @Test
    fun quotaExhaustion_lastsUntilNextUtcMidnight_andEndsWithAccount() = runTest(dispatcher) {
        signIn()
        backend.quota = com.tyler.kocamind.data.backend.QuotaState(0, 50)
        backend.error = com.tyler.kocamind.data.backend.QuotaExceededException("bitti")
        val vm = vm()
        vm.setInput("selam"); vm.send(); advanceUntilIdle()
        assertEquals(86_400_000L, vm.state.value.quotaExhaustedUntil)
        auth.signOut(); advanceUntilIdle()
        assertNull(vm.state.value.quotaExhaustedUntil)
        assertNull(vm.state.value.quota)
    }
}
