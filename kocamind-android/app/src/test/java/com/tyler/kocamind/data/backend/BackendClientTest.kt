package com.tyler.kocamind.data.backend

import com.tyler.kocamind.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertTrue
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test

class BackendClientTest {
    private val server = MockWebServer()

    @Before
    fun setUp() = server.start()

    @After
    fun tearDown() = server.shutdown()

    private fun client(token: String? = "tok") =
        BackendClient(server.url("/").toString(), OkHttpClient(), tokenProvider = { token })

    private fun model(id: String, available: Boolean) =
        """{"id":"$id","provider":"openai","providerName":"OpenAI","label":"Model $id","available":$available,"extra":1}"""

    @Test
    fun models_sendsBearerToken() = runTest {
        server.enqueue(MockResponse().setBody("""{"models":[]}"""))
        client().getRemoteModels()
        val request = server.takeRequest()
        assertEquals("/models", request.path)
        assertEquals("Bearer tok", request.getHeader("Authorization"))
    }

    @Test
    fun models_filtersUnavailable() = runTest {
        server.enqueue(MockResponse().setBody("""{"models":[${model("a", true)},${model("b", false)}]}"""))
        val models = client().getRemoteModels()
        assertEquals(listOf("a"), models.map { it.id })
        assertEquals("Model a", models.single().label)
    }

    @Test
    fun models_acceptsBareArray() = runTest {
        server.enqueue(MockResponse().setBody("[${model("a", true)},${model("c", true)}]"))
        assertEquals(listOf("a", "c"), client().getRemoteModels().map { it.id })
    }

    @Test
    fun noUser_throwsWithoutRequest() = runTest {
        val e = assertThrows(BackendException::class.java) {
            kotlinx.coroutines.runBlocking { client(token = null).getRemoteModels() }
        }
        assertEquals("Devam etmek için hesabına giriş yapman gerekiyor.", e.message)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun models_httpError_throwsParsedMessage() = runTest {
        server.enqueue(MockResponse().setResponseCode(429).setBody("""{"error":{"message":"Günlük limit doldu."}}"""))
        val e = assertThrows(BackendException::class.java) {
            kotlinx.coroutines.runBlocking { client().getRemoteModels() }
        }
        assertEquals("Günlük limit doldu.", e.message)
    }

    @Test
    fun baseUrl_trailingSlashesTrimmed() = runTest {
        server.enqueue(MockResponse().setBody("[]"))
        BackendClient(server.url("/").toString() + "//", OkHttpClient()) { "tok" }.getRemoteModels()
        assertEquals("/models", server.takeRequest().path)
    }

    @Test
    fun errorMessage_nestedObject() {
        assertEquals("X", backendErrorMessage("""{"error":{"message":"X"}}""", "fallback"))
    }

    @Test
    fun errorMessage_string() {
        assertEquals("Y", backendErrorMessage("""{"error":"Y"}""", "fallback"))
    }

    @Test
    fun errorMessage_nonJson() {
        assertEquals("Sunucu isteği tamamlanamadı.", backendErrorMessage("<html>", "Sunucu isteği tamamlanamadı."))
        assertEquals("Sunucu isteği tamamlanamadı.", backendErrorMessage(null, "Sunucu isteği tamamlanamadı."))
        assertEquals("Sunucu isteği tamamlanamadı.", backendErrorMessage("""{"ok":false}""", "Sunucu isteği tamamlanamadı."))
    }

    @Test
    fun feedback_sendsDetailsOnlyForDown_andOmitsAbsentFields() = runTest {
        val c = client()
        val vote = FeedbackRequest("down", "c1", "m1", null, null, "soru", "yanıt", "slow", "Açıklama", 1500L)
        suspend fun send(request: FeedbackRequest) = run {
            server.enqueue(MockResponse().setResponseCode(202).setBody("""{"accepted":true}"""))
            c.sendFeedback(request)
            val posted = server.takeRequest()
            assertEquals("/feedback", posted.path)
            Json.parseToJsonElement(posted.body.readUtf8()).jsonObject
        }

        val up = send(vote.copy(type = "up", latencyMs = null))
        assertFalse("reason" in up)
        assertFalse("note" in up)
        assertFalse("provider" in up)
        assertFalse("model" in up)
        assertEquals(
            mapOf("platform" to JsonPrimitive("android"), "appVersion" to JsonPrimitive(BuildConfig.VERSION_NAME)),
            up.getValue("context").jsonObject,
        )

        val down = send(vote)
        assertEquals(JsonPrimitive("slow"), down["reason"])
        assertEquals(JsonPrimitive("Açıklama"), down["note"])
        assertEquals(JsonPrimitive(1500L), down.getValue("context").jsonObject["latencyMs"])

        val skipped = send(vote.copy(reason = null, note = null, latencyMs = null))
        assertFalse("reason" in skipped)
        assertFalse("note" in skipped)

        // Oy silme, backend sözleşmesinde açıkça JSON null olarak kodlanır.
        val removed = send(vote.copy(type = null))
        assertEquals(JsonNull, removed["type"])
        assertFalse("reason" in removed)
        assertFalse("note" in removed)
    }

    @Test
    fun bugReport_returnsId_andOmitsAbsentMessageId() = runTest {
        server.enqueue(MockResponse().setResponseCode(201).setBody("""{"id":"bug-1"}"""))
        assertEquals("bug-1", client().sendBugReport("  Uygulama açılmıyor.  ", chatId = "c1"))
        val posted = server.takeRequest()
        assertEquals("/feedback/bug", posted.path)
        val body = Json.parseToJsonElement(posted.body.readUtf8()).jsonObject
        assertEquals(JsonPrimitive("Uygulama açılmıyor."), body["text"])
        assertEquals(JsonPrimitive("c1"), body["chatId"])
        assertFalse("messageId" in body)
        assertEquals(JsonPrimitive("android"), body.getValue("context").jsonObject["platform"])
    }

    @Test
    fun bugReport_http429_throwsDailyLimitException() {
        server.enqueue(MockResponse().setResponseCode(429).setBody("""{"code":"daily_limit"}"""))
        val error = assertThrows(BugReportDailyLimitException::class.java) {
            runBlocking { client().sendBugReport("Uygulama açılmıyor.") }
        }
        assertEquals("Bugünlük bildirim sınırına ulaştın.", error.message)
    }

    @Test
    fun chat_jailbreakBlocked_displaysBackendMessage() {
        val message = "Bu mesaj güvenlik filtresine takıldı ve modele iletilmedi. Sorunu farklı şekilde sorabilirsin."
        server.enqueue(MockResponse().setResponseCode(400)
            .setBody("""{"error":{"code":"jailbreak_blocked","message":"$message"}}"""))
        val error = assertThrows(BackendException::class.java) {
            runBlocking { client().streamChat(ChatStreamRequest("örnek", emptyList())) { } }
        }
        assertEquals(message, error.message)
        assertEquals("/chat", server.takeRequest().path)
    }

    @Test
    fun cancellingJsonRequest_cancelsHttpCall() = runBlocking {
        // Görsel üretimi gibi uzun tek istek: Durdur'a basınca ağ çağrısı da kesilmeli.
        // Yanıt hiç gelmez; sunucu iş parçacığı uyumadığı için kapanış da beklemez.
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
        val c = client()
        val job = launch(Dispatchers.Default) { runCatching { c.generateImage("kedi", "1:1") } }
        server.takeRequest(2, TimeUnit.SECONDS)
        val started = System.nanoTime()
        job.cancelAndJoin()
        val waitedMs = (System.nanoTime() - started) / 1_000_000
        assertTrue("iptal ${waitedMs} ms bekledi", waitedMs < 2_000)
    }
}
