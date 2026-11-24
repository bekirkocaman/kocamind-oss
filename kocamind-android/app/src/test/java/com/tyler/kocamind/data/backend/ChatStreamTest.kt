package com.tyler.kocamind.data.backend

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test

class ChatStreamTest {
    private val server = MockWebServer()

    @Before
    fun setUp() = server.start()

    @After
    fun tearDown() = server.shutdown()

    private fun client() = BackendClient(server.url("/").toString(), OkHttpClient()) { "tok" }

    private fun delta(text: String) = """data: {"choices":[{"delta":{"content":${Json.encodeToString(kotlinx.serialization.serializer<String>(), text)}}}]}"""

    private val request = ChatStreamRequest(
        message = "Merhaba",
        history = listOf(ChatHistoryItem("user", "önce"), ChatHistoryItem("model", "cevap")),
        instructions = "talimat",
        provider = "openai",
        model = "gpt-5.6-luna",
    )

    @Test
    fun stream_accumulatesDeltasUntilDone() = runTest {
        server.enqueue(
            MockResponse().setHeader("Content-Type", "text/event-stream")
                .setBody("${delta("Mer")}\n\n${delta("haba")}\n\n: yorum\n\ndata: [DONE]\n\n${delta("SONRA")}\n\n"),
        )
        val partials = mutableListOf<String>()
        val result = client().streamChat(request) { partials += it }
        assertEquals("Merhaba", result)
        assertEquals(listOf("Mer", "Merhaba"), partials)
    }

    @Test
    fun stream_forwardsReasoningSeparatelyFromText() = runTest {
        fun reasoning(text: String) = """data: {"choices":[{"delta":{"reasoning_content":${Json.encodeToString(kotlinx.serialization.serializer<String>(), text)}}}]}"""
        server.enqueue(
            MockResponse().setHeader("Content-Type", "text/event-stream")
                .setBody("${reasoning("Soruyu ")}\n\n${reasoning("anlıyorum.")}\n\n${delta("Cevap")}\n\ndata: [DONE]\n\n"),
        )
        val thoughts = mutableListOf<String>()
        val partials = mutableListOf<String>()
        val result = client().streamChat(request, onReasoning = { thoughts += it }) { partials += it }
        assertEquals("Cevap", result)
        assertEquals(listOf("Soruyu ", "Soruyu anlıyorum."), thoughts)
        assertEquals(listOf("Cevap"), partials)
    }

    @Test
    fun stream_sendsSameBodyAsMobile() = runTest {
        server.enqueue(MockResponse().setBody("data: [DONE]\n\n"))
        client().streamChat(request) {}
        val recorded = server.takeRequest()
        assertEquals("/chat", recorded.path)
        assertEquals("Bearer tok", recorded.getHeader("Authorization"))
        val body = Json.parseToJsonElement(recorded.body.readUtf8()).jsonObject
        assertEquals("openai", body["provider"]!!.jsonPrimitive.content)
        assertEquals("gpt-5.6-luna", body["model"]!!.jsonPrimitive.content)
        assertEquals("tiger", body["assistant_type"]!!.jsonPrimitive.content)
        assertEquals("talimat", body["custom_prompt"]!!.jsonPrimitive.content)
        assertEquals("Merhaba", body["message"]!!.jsonPrimitive.content)
        assertEquals("true", body["stream"]!!.jsonPrimitive.content)
        assertEquals("true", body["web_search"]!!.jsonPrimitive.content)
        val history = body["history"]!!.jsonArray
        assertEquals("user", history[0].jsonObject["role"]!!.jsonPrimitive.content)
        // Mobil, "model" rolünü backend'e "ai" olarak gönderir.
        assertEquals("ai", history[1].jsonObject["role"]!!.jsonPrimitive.content)
    }

    @Test
    fun stream_httpError_throwsParsedMessage() = runTest {
        server.enqueue(MockResponse().setResponseCode(403).setBody("""{"error":{"message":"Bu model için Pro gerekli."}}"""))
        val e = assertThrows(BackendException::class.java) { runBlocking { client().streamChat(request) {} } }
        assertEquals("Bu model için Pro gerekli.", e.message)
    }

    @Test
    fun stream_errorEvent_throwsMessage() = runTest {
        server.enqueue(MockResponse().setBody("${delta("Ya")}\n\nevent: error\ndata: {\"error\":\"Sağlayıcı yanıt vermedi.\"}\n\n"))
        val e = assertThrows(BackendException::class.java) { runBlocking { client().streamChat(request) {} } }
        assertEquals("Sağlayıcı yanıt vermedi.", e.message)
    }

    @Test
    fun stream_connectionDrop_throwsTurkish() = runTest {
        server.enqueue(MockResponse().setBody(delta("Ya") + "\n\n").setSocketPolicy(SocketPolicy.DISCONNECT_DURING_RESPONSE_BODY))
        val e = assertThrows(BackendException::class.java) { runBlocking { client().streamChat(request) {} } }
        assertEquals("Yanıt akışı kesildi.", e.message)
    }

    @Test
    fun stream_endWithoutDone_returnsText() = runTest {
        server.enqueue(MockResponse().setBody(delta("Tamam") + "\n\n"))
        assertEquals("Tamam", client().streamChat(request) {})
    }

    @Test
    fun stream_cancel_stopsWithoutError() = runBlocking {
        server.enqueue(MockResponse().setBody(delta("İlk") + "\n\n").setBodyDelay(0, java.util.concurrent.TimeUnit.SECONDS)
            .throttleBody(1, 5, java.util.concurrent.TimeUnit.SECONDS))
        val firstChunk = CompletableDeferred<Unit>()
        val job = async { client().streamChat(request) { firstChunk.complete(Unit) } }
        withTimeout(500) { kotlinx.coroutines.delay(200) }
        job.cancel()
        withTimeout(3000) { runCatching { job.await() } }
        assertEquals(true, job.isCancelled)
    }

    @Test
    fun stream_readsQuotaHeaders() = runTest {
        server.enqueue(
            MockResponse().setHeader("Content-Type", "text/event-stream")
                .setHeader("X-Daily-Limit", "50").setHeader("X-Daily-Remaining", "8")
                .setBody("${delta("Tamam")}\n\ndata: [DONE]\n\n"),
        )
        val c = client()
        c.streamChat(request) {}
        assertEquals(QuotaState(8, 50), c.lastQuota)
    }

    @Test
    fun stream_429_throwsQuotaExceeded() = runTest {
        server.enqueue(
            MockResponse().setResponseCode(429)
                .setHeader("X-Daily-Limit", "50").setHeader("X-Daily-Remaining", "0")
                .setBody("""{"error":"Günlük chat kullanım sınırına ulaştın.","code":"daily_limit"}"""),
        )
        val c = client()
        assertThrows(QuotaExceededException::class.java) { runBlocking { c.streamChat(request) {} } }
        assertEquals(QuotaState(0, 50), c.lastQuota)
    }

    @Test
    fun stream_withoutQuotaHeaders_clearsOldQuota() = runTest {
        server.enqueue(MockResponse().setHeader("X-Daily-Limit", "50").setHeader("X-Daily-Remaining", "8").setBody("${delta("a")}\n\ndata: [DONE]\n\n"))
        server.enqueue(MockResponse().setBody("${delta("b")}\n\ndata: [DONE]\n\n"))
        val c = client()
        c.streamChat(request) {}
        c.streamChat(request) {}
        org.junit.Assert.assertNull(c.lastQuota)
    }
}
