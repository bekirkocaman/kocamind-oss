package com.tyler.kocamind.data.offline

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.time.LocalDateTime

private class FakeSession(
    override val contextSize: Int = 2048,
    var reply: String = "Merhaba!",
    var stop: StopReason = StopReason.Eos,
) : LocalLlm {
    var lastPrompt = ""
    var lastStops = emptyList<String>()
    var closed = false
    var stopped = false
    var generatedAfterClose = false
    /** Her mesaj ~ karakter/4 token sayılır. */
    override fun formatChat(messages: List<Pair<String, String>>) = messages.joinToString("") { "<${it.first}>${it.second}" } + "<assistant>"
    override fun countTokens(text: String) = text.length / 4
    override fun generate(prompt: String, profile: AdaptiveInferenceProfile, stopWords: List<String>, onPartial: (String) -> Unit): Pair<String, GenerationStats> {
        if (closed) generatedAfterClose = true
        lastPrompt = prompt
        lastStops = stopWords
        onPartial(reply.take(3))
        onPartial(reply)
        return reply to GenerationStats(40.0, 7.0, stop, 10)
    }
    override fun stop() { stopped = true }
    override fun bench(promptTokens: Int, generateTokens: Int) = 50.0 to 9.0
    override fun close() { closed = true }
}

private class MapPrefs : OfflinePrefs {
    val map = mutableMapOf<String, String>()
    override fun get(key: String) = map[key]
    override fun set(key: String, value: String?) { if (value == null) map.remove(key) else map[key] = value }
}

class OfflineAiServiceTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private val server = MockWebServer()
    private val prefs = MapPrefs()
    private var session = FakeSession()
    private var opened = mutableListOf<String>()
    private val phone = DeviceProfile("Samsung SM-S711B", 8.0, 100.0, null, listOf("arm64-v8a"), true)
    private val qwen2 = OFFLINE_MODELS.first { it.id == "qwen3.5-2b" }
    private val gemma1 = OFFLINE_MODELS.first { it.id == "gemma3-1b" }

    @Before
    fun setUp() = server.start()

    @After
    fun tearDown() = server.shutdown()

    private fun service(
        engine: (File, Int) -> LocalLlm? = { file, _ -> opened += file.name; session },
    ) = OfflineAiService(
        modelsDir = tmp.root,
        prefs = prefs,
        deviceProfile = { phone },
        http = OkHttpClient(),
        engine = engine,
        now = { LocalDateTime.of(2026, 10, 8, 9, 5) },
    )

    /** Modeli "indirilmiş ve doğrulanmış" yapar (beklenen boyutta seyrek dosya). */
    private fun fakeDownload(model: OfflineModel) {
        java.io.RandomAccessFile(File(tmp.root, model.fileName), "rw").use { it.setLength(model.expectedBytes) }
        prefs.set("offline_verified_${model.id}", model.sha256)
    }

    private fun sha256(bytes: ByteArray) =
        java.security.MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    @Test
    fun downloadedMeansExactSize() {
        val s = service()
        assertFalse(s.isDownloaded(gemma1))
        java.io.RandomAccessFile(File(tmp.root, gemma1.fileName), "rw").use { it.setLength(gemma1.expectedBytes - 1) }
        assertFalse(s.isDownloaded(gemma1))
        assertTrue(s.hasFile(gemma1))
        fakeDownload(gemma1)
        assertTrue(s.isDownloaded(gemma1))
    }

    @Test
    fun catalog_isPinnedToCommits_withSha256() {
        OFFLINE_MODELS.forEach { model ->
            assertTrue(model.id, Regex("""https://huggingface\.co/[^/]+/[^/]+/resolve/[0-9a-f]{40}/.+""").matches(model.url))
            assertTrue(model.id, Regex("[0-9a-f]{64}").matches(model.sha256))
        }
    }

    @Test
    fun download_wrongHash_deletesPartAndThrows() = runTest {
        val body = ByteArray(1000) { 7 }
        server.enqueue(MockResponse().setBody(Buffer().write(body)))
        val tiny = gemma1.copy(url = server.url("/model.gguf").toString(), expectedBytes = 1000, sha256 = "0".repeat(64))
        val e = assertThrows(IllegalStateException::class.java) { kotlinx.coroutines.runBlocking { service().download(tiny) {} } }
        assertEquals("Model indirilemedi veya dosya bozuk. Tekrar dene.", e.message)
        assertFalse(File(tmp.root, tiny.fileName).exists())
        assertFalse(File(tmp.root, tiny.fileName + ".part").exists())
    }

    @Test
    fun legacyFileWithoutVerification_isCheckedOnceBeforeLoading_andDeletedIfCorrupt() = runTest {
        // Eski sürümle inmiş dosya: boyut doğru, doğrulama kaydı yok, içerik bozuk (sıfırlar).
        java.io.RandomAccessFile(File(tmp.root, gemma1.fileName), "rw").use { it.setLength(gemma1.expectedBytes) }
        val s = service()
        s.setSelected(gemma1.id)
        val e = assertThrows(IllegalStateException::class.java) {
            kotlinx.coroutines.runBlocking { s.generateReply(listOf("user" to "merhaba orada"), onPartial = {}) }
        }
        assertEquals("Gemma 3 Mini (1B) dosyası bozuk çıktı ve silindi. Ayarlar'dan yeniden indir.", e.message)
        assertFalse(File(tmp.root, gemma1.fileName).exists())
        assertTrue(opened.isEmpty())
    }

    @Test
    fun sha256Of_matchesJdkDigest() {
        val bytes = ByteArray(200_000) { (it % 251).toByte() }
        val file = File(tmp.root, "x.bin").apply { writeBytes(bytes) }
        assertEquals(sha256(bytes), sha256Of(file))
    }

    @Test
    fun autoMode_selectsBestDownloaded_manualSelectionDisablesAuto() = runTest {
        val s = service()
        fakeDownload(gemma1)
        fakeDownload(qwen2)
        assertTrue(s.autoMode)
        assertEquals("qwen3.5-2b", s.selectedModel().id)
        s.setSelected("gemma3-1b")
        assertFalse(s.autoMode)
        assertEquals("gemma3-1b", s.selectedModel().id)
    }

    @Test
    fun download_writesFileAndReportsProgress() = runTest {
        val body = ByteArray(1000) { 7 }
        server.enqueue(MockResponse().setBody(Buffer().write(body)))
        val tiny = gemma1.copy(url = server.url("/model.gguf").toString(), expectedBytes = 1000, sha256 = sha256(body))
        val progress = mutableListOf<Int>()
        val s = service()
        s.download(tiny) { progress += it }
        assertEquals(1000L, File(tmp.root, tiny.fileName).length())
        assertFalse(File(tmp.root, tiny.fileName + ".part").exists())
        assertEquals(100, progress.last())
        assertEquals(sha256(body), prefs.get("offline_verified_${tiny.id}"))
    }

    @Test
    fun download_tooSmall_throwsTurkish() = runTest {
        server.enqueue(MockResponse().setBody("kısa"))
        val tiny = gemma1.copy(url = server.url("/m").toString(), expectedBytes = 1000)
        val e = assertThrows(IllegalStateException::class.java) { kotlinx.coroutines.runBlocking { service().download(tiny) {} } }
        assertEquals("Model indirilemedi veya dosya bozuk. Tekrar dene.", e.message)
    }

    @Test
    fun deviceTools_answerWithoutLoadingModel() = runTest {
        val partials = mutableListOf<String>()
        val answer = service().generateReply(listOf("user" to "saat kaç"), onPartial = { partials += it })
        assertEquals("Cihazının saatine göre şu an saat 09:05.", answer)
        assertEquals(listOf(answer), partials)
        assertTrue(opened.isEmpty())
    }

    @Test
    fun noModel_throwsNotReady() = runTest {
        val e = assertThrows(IllegalStateException::class.java) {
            kotlinx.coroutines.runBlocking { service().generateReply(listOf("user" to "merhaba"), onPartial = {}) }
        }
        assertEquals("OFFLINE_MODEL_NOT_READY", e.message)
    }

    @Test
    fun qwenReply_usesSystemPrompt_noThinkPrefix_andStopWords() = runTest {
        fakeDownload(qwen2)
        val s = service()
        val partials = mutableListOf<String>()
        val answer = s.generateReply(
            listOf("user" to "Kotlin nedir?"),
            onPartial = { partials += it },
            customInstructions = "Kısa yaz",
        )
        assertEquals("Merhaba!", answer)
        assertTrue(session.lastPrompt.startsWith("<system>Sen KocaMind, kullanıcının telefonunda internetsiz çalışan kişisel asistanısın."))
        assertTrue(session.lastPrompt.contains("Kullanıcının özel talimatları:\nKısa yaz"))
        assertTrue(session.lastPrompt.endsWith("<assistant><think>\n\n</think>\n\n"))
        assertEquals(listOf("<|im_end|>", "<|endoftext|>"), session.lastStops)
        assertEquals(listOf("Mer", "Merhaba!"), partials)
        // Gerçek hız kaydedildi.
        assertEquals(7.0, s.performance("qwen3.5-2b")!!.tokensPerSecond, 0.0)
    }

    @Test
    fun smallModel_getsShortPrompt_andGemmaStops() = runTest {
        fakeDownload(gemma1)
        service().generateReply(listOf("user" to "Merhaba dostum"), onPartial = {})
        assertTrue(session.lastPrompt.startsWith("<system>Sen KocaMind adlı Türkçe asistansın."))
        assertFalse(session.lastPrompt.contains("<think>"))
        assertEquals(listOf("<end_of_turn>", "<eos>"), session.lastStops)
    }

    @Test
    fun cutOffReply_getsContinueNote() = runTest {
        fakeDownload(qwen2)
        session.stop = StopReason.Limit
        val answer = service().generateReply(listOf("user" to "uzun anlat"), onPartial = {})
        assertTrue(answer.endsWith("_(Cevap uzunluk sınırında kesildi. Devamı için \"devam et\" yazabilirsin.)_"))
    }

    @Test
    fun thinkingBlocks_areStripped_emptyThrows() = runTest {
        fakeDownload(qwen2)
        session.reply = "<think>gizli</think>Görünen"
        assertEquals("Görünen", service().generateReply(listOf("user" to "x y z"), onPartial = {}))
        session.reply = "<think>sadece düşünce"
        val e = assertThrows(IllegalStateException::class.java) {
            kotlinx.coroutines.runBlocking { service().generateReply(listOf("user" to "x y z"), onPartial = {}) }
        }
        assertEquals("Model boş cevap döndürdü", e.message)
    }

    @Test
    fun history_isTrimmedToFitContext() = runTest {
        fakeDownload(qwen2)
        session = FakeSession(contextSize = 2048)
        val long = "a".repeat(4000) // ~1000 token
        service().generateReply(listOf("user" to long, "model" to long, "user" to "son soru"), onPartial = {})
        assertFalse(session.lastPrompt.contains(long))
        assertTrue(session.lastPrompt.contains("son soru"))
    }

    @Test
    fun crashDuringLoad_isDetectedNextTime() = runTest {
        fakeDownload(qwen2)
        // Önceki oturum yüklerken kapanmış gibi.
        prefs.set("offline_model_in_use", "qwen3.5-2b")
        val s = service()
        s.setSelected("qwen3.5-2b", preserveAutoMode = true)
        val e = assertThrows(IllegalStateException::class.java) {
            kotlinx.coroutines.runBlocking { s.generateReply(listOf("user" to "merhaba orada"), onPartial = {}) }
        }
        assertEquals("Qwen 3.5 (2B) bu telefonda bellek yetmediği için kapandı. Ayarlardan daha küçük bir model seç.", e.message)
        assertTrue(s.isCrashed("qwen3.5-2b"))
        // Elle seçmek bir şans daha verir.
        s.setSelected("qwen3.5-2b")
        assertFalse(s.isCrashed("qwen3.5-2b"))
        assertNull(prefs.get("offline_model_in_use"))
    }

    @Test
    fun delete_unloadsAndFallsBack() = runTest {
        fakeDownload(qwen2)
        fakeDownload(gemma1)
        val s = service()
        s.setSelected("qwen3.5-2b")
        s.generateReply(listOf("user" to "merhaba orada"), onPartial = {})
        s.delete(qwen2)
        assertTrue(session.closed)
        assertFalse(File(tmp.root, qwen2.fileName).exists())
        assertEquals("gemma3-1b", prefs.get("offline_selected_model"))
    }

    @Test
    fun benchmark_savesPerformance() = runTest {
        fakeDownload(qwen2)
        val perf = service().benchmark(qwen2)
        assertEquals(9.0, perf.tokensPerSecond, 0.0)
        assertEquals(9, perf.comfortScore)
    }

    @Test
    fun unloadWhileLoading_waitsUntilReplyFinishes() = runTest {
        fakeDownload(qwen2)
        val entered = java.util.concurrent.CountDownLatch(1)
        val gate = java.util.concurrent.CountDownLatch(1)
        val s = service(engine = { _, _ -> entered.countDown(); gate.await(); session })
        s.setSelected(qwen2.id)

        val reply = async(Dispatchers.Default) { s.generateReply(listOf("user" to "anlat bakalım"), {}) }
        entered.await()
        // Model yüklenirken kullanıcı başka modele geçiyor / modeli siliyor.
        val unload = async(Dispatchers.Default) { s.unload() }
        Thread.sleep(200)
        gate.countDown()
        reply.await()
        unload.await()

        assertFalse("kapatılmış oturumda üretim yapıldı", session.generatedAfterClose)
        assertTrue(session.closed)
    }
}
