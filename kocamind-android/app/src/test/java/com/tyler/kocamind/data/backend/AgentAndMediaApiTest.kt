package com.tyler.kocamind.data.backend

import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class AgentAndMediaApiTest {
    private val server = MockWebServer()

    @Before
    fun setUp() = server.start()

    @After
    fun tearDown() = server.shutdown()

    private fun client() = BackendClient(server.url("/").toString(), OkHttpClient()) { "tok" }

    private fun sse(vararg events: Pair<String, String>) =
        MockResponse().setBody(events.joinToString("") { (name, data) -> "event: $name\ndata: $data\n\n" })

    private val agentRequest = AgentRequest(
        mode = "deep_research",
        message = "Araştır",
        history = listOf(ChatHistoryItem("model", "önceki")),
        instructions = "talimat",
        model = null,
    )

    @Test
    fun agent_streamsStatusStepsTextAndAppendsMissingSources() = runTest {
        server.enqueue(
            sse(
                "status" to """{"message":"Kaynaklar taranıyor…"}""",
                "tool_started" to """{"name":"web_search"}""",
                "tool_completed" to """{"name":"web_search","arguments":{"q":"x"},"output":{"ok":true,"result":{"n":1}}}""",
                "text_delta" to """{"delta":"Sonuç: "}""",
                "text_delta" to """{"delta":"https://a.com"}""",
                "completed" to """{"text":"Sonuç: https://a.com","sources":[{"title":"A","url":"https://a.com"},{"title":"B","url":"https://b.com"}]}""",
                "done" to "{}",
            ),
        )
        val statuses = mutableListOf<String>()
        var steps = emptyList<com.tyler.kocamind.data.chat.AgentStep>()
        var text = ""
        val result = client().runAgent(
            agentRequest,
            AgentCallbacks(onText = { text = it }, onStatus = { statuses += it }, onSteps = { steps = it }, onApproval = { false }),
        )
        assertEquals(listOf("Kaynaklar taranıyor…", "web_search çalışıyor…"), statuses)
        assertEquals("web_search", steps.single().name)
        assertEquals("""{"n":1}""", steps.single().result)
        assertEquals("Sonuç: https://a.com\n\n### Kaynaklar\n- [B](https://b.com)", result.finalText)
        assertEquals(result.finalText, text)
        val body = Json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject
        assertEquals("deep_research", body["mode"]!!.jsonPrimitive.content)
        assertEquals("gpt-5.6-luna", body["model"]!!.jsonPrimitive.content)
    }

    @Test
    fun agent_approvalLoop_sendsDecisionToConfirmEndpoint() = runTest {
        server.enqueue(sse("approval_required" to """{"runId":"r 1","confirmationId":"c1","name":"send_email","message":"E-posta gönderilsin mi?"}""", "done" to "{}"))
        server.enqueue(sse("completed" to """{"text":"Gönderildi."}""", "done" to "{}"))
        var asked: AgentApproval? = null
        val result = client().runAgent(agentRequest, AgentCallbacks(onText = {}, onApproval = { asked = it; true }))
        assertEquals("E-posta gönderilsin mi?", asked!!.message)
        assertEquals("Gönderildi.", result.finalText)
        server.takeRequest()
        val confirm = server.takeRequest()
        assertEquals("/agent/runs/r%201/confirm", confirm.path)
        val body = Json.parseToJsonElement(confirm.body.readUtf8()).jsonObject
        assertEquals("c1", body["confirmationId"]!!.jsonPrimitive.content)
        assertEquals("true", body["approved"]!!.jsonPrimitive.content)
    }

    @Test
    fun agent_errorEvent_throws() = runTest {
        server.enqueue(sse("error" to """{"error":"Kota doldu."}"""))
        val e = assertThrows(BackendException::class.java) {
            runBlocking { client().runAgent(agentRequest, AgentCallbacks(onText = {})) }
        }
        assertEquals("Kota doldu.", e.message)
    }

    @Test
    fun upload_sendsMultipart_returnsContent() = runTest {
        server.enqueue(MockResponse().setBody("""{"content":"Bir kedi fotoğrafı."}"""))
        val content = client().uploadForAnalysis(byteArrayOf(1, 2, 3), "image/png", "mobile-upload.png", "Görsel işlenemedi.")
        assertEquals("Bir kedi fotoğrafı.", content)
        val req = server.takeRequest()
        assertEquals("/upload", req.path)
        assertTrue(req.getHeader("Content-Type")!!.startsWith("multipart/form-data"))
        assertTrue(req.body.readUtf8().contains("filename=\"mobile-upload.png\""))
    }

    @Test
    fun upload_error_usesFallback() = runTest {
        server.enqueue(MockResponse().setResponseCode(500).setBody("<html>"))
        val e = assertThrows(BackendException::class.java) {
            runBlocking { client().uploadForAnalysis(byteArrayOf(1), "application/pdf", "a.pdf", "Dosya işlenemedi.") }
        }
        assertEquals("Dosya işlenemedi.", e.message)
    }

    @Test
    fun transcribe_returnsTrimmedText() = runTest {
        server.enqueue(MockResponse().setBody("""{"transcription":"  merhaba dünya  "}"""))
        assertEquals("merhaba dünya", client().transcribeAudio(byteArrayOf(9), "audio/m4a"))
        assertEquals("/audio", server.takeRequest().path)
    }

    @Test
    fun generateImage_returnsBase64() = runTest {
        server.enqueue(MockResponse().setBody("""{"image":"QUJD","mimeType":"image/jpeg"}"""))
        val image = client().generateImage("kedi", "16:9")
        assertEquals("QUJD", image.base64)
        assertEquals("image/jpeg", image.mimeType)
        val body = Json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject
        assertEquals("16:9", body["aspectRatio"]!!.jsonPrimitive.content)
    }

    @Test
    fun generateImage_withoutImage_throws() = runTest {
        server.enqueue(MockResponse().setBody("""{}"""))
        val e = assertThrows(BackendException::class.java) { runBlocking { client().generateImage("x", "1:1") } }
        assertEquals("Görsel verisi alınamadı.", e.message)
    }

    @Test
    fun video_startAndStatus() = runTest {
        server.enqueue(MockResponse().setBody("""{"jobId":"job 7"}"""))
        server.enqueue(MockResponse().setBody("""{"status":"completed","videoUrl":"https://v.mp4"}"""))
        val job = client().startVideoGeneration("taksi", "9:16")
        assertEquals("job 7", job)
        val status = client().getVideoStatus(job)
        assertEquals("completed", status.status)
        assertEquals("https://v.mp4", status.videoUrl)
        server.takeRequest()
        assertEquals("/generate-video/job%207", server.takeRequest().path)
    }

    @Test
    fun deleteAccount_sendsDelete() = runTest {
        server.enqueue(MockResponse().setBody("""{"ok":true}"""))
        client().deleteAccount()
        val req = server.takeRequest()
        assertEquals("DELETE", req.method)
        assertEquals("/account", req.path)
    }

    @Test
    fun pendingDeletion_statusRestoreAndDeleteNow() = runTest {
        server.enqueue(MockResponse().setBody("""{"pending":true,"purgeAfter":"2026-12-11T10:00:00.000Z"}"""))
        server.enqueue(MockResponse().setBody("""{"success":true}"""))
        server.enqueue(MockResponse().setBody("""{"success":true}"""))
        assertEquals("2026-12-11T10:00:00.000Z", client().deletionPurgeAfter())
        client().restoreAccount()
        client().deleteAccountNow()
        server.takeRequest().let { assertEquals("GET", it.method); assertEquals("/account/deletion", it.path) }
        server.takeRequest().let { assertEquals("POST", it.method); assertEquals("/account/restore", it.path) }
        server.takeRequest().let { assertEquals("DELETE", it.method); assertEquals("/account/now", it.path) }
    }

    @Test
    fun agent429_isNormalError_andDoesNotTouchChatQuota() = kotlinx.coroutines.test.runTest {
        server.enqueue(
            MockResponse().setResponseCode(429).setHeader("X-Daily-Limit", "10").setHeader("X-Daily-Remaining", "0")
                .setBody("""{"error":"Günlük agent kullanım sınırına ulaştın.","code":"daily_limit"}"""),
        )
        val c = client()
        val error = runCatching { c.runAgent(agentRequest, AgentCallbacks(onText = {})) }.exceptionOrNull()
        org.junit.Assert.assertTrue(error is BackendException)
        org.junit.Assert.assertFalse(error is QuotaExceededException)
        org.junit.Assert.assertNull(c.lastQuota)
    }
}
