package com.tyler.kocamind.data.backend

import com.tyler.kocamind.data.memory.ExtractResult
import com.tyler.kocamind.data.memory.Memory
import com.tyler.kocamind.data.memory.SummaryMessage
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

class MemoryApiTest {
    private val server = MockWebServer()

    @Before fun setUp() = server.start()
    @After fun tearDown() = server.shutdown()

    private fun client() = BackendClient(server.url("/").toString(), OkHttpClient(), tokenProvider = { "tok" })
    private fun body(raw: String) = Json.parseToJsonElement(raw).jsonObject

    @Test fun list_readsMemories() = runTest {
        server.enqueue(MockResponse().setBody("""{"success":true,"memories":[{"key":"isim","value":"Bekir","category":"kisisel","updatedAt":"x"}],"count":1}"""))
        assertEquals(listOf(Memory("isim", "Bekir", "kisisel")), client().listMemories())
        assertEquals("GET", server.takeRequest().method)
    }

    @Test fun extract_sendsMessage_andReportsChange() = runTest {
        server.enqueue(MockResponse().setBody("""{"success":true,"saved":[{"key":"şehir","value":"İstanbul"}],"forgotten":[]}"""))
        assertEquals(ExtractResult(listOf("şehir"), 0), client().extractMemories("İstanbul'da yaşıyorum"))
        val request = server.takeRequest()
        assertEquals("/memory/extract", request.path)
        assertEquals("İstanbul'da yaşıyorum", body(request.body.readUtf8())["message"]!!.jsonPrimitive.content)
        // Güncellenen kayıt geri alınamaz (eski değer yok); yalnızca sayılır.
        server.enqueue(MockResponse().setBody("""{"success":true,"saved":[{"key":"şehir","value":"İzmir","isNew":false}],"forgotten":[]}"""))
        assertEquals(ExtractResult(emptyList(), 0, updated = 1), client().extractMemories("İzmir'e taşındım"))
    }

    @Test fun delete_oneOrAll() = runTest {
        server.enqueue(MockResponse().setBody("""{"success":true}"""))
        server.enqueue(MockResponse().setBody("""{"success":true}"""))
        client().deleteMemory("isim")
        client().deleteMemory(null)
        val one = server.takeRequest()
        assertEquals("DELETE", one.method)
        assertEquals("isim", body(one.body.readUtf8())["key"]!!.jsonPrimitive.content)
        assertNull(body(server.takeRequest().body.readUtf8())["key"])
    }

    @Test fun summarize_sendsPreviousAndMessages() = runTest {
        server.enqueue(MockResponse().setBody("""{"success":true,"summary":"- özet"}"""))
        val summary = client().summarizeConversation("- eski", listOf(SummaryMessage("user", "merhaba")))
        assertEquals("- özet", summary)
        val sent = body(server.takeRequest().body.readUtf8())
        assertEquals("- eski", sent["previous_summary"]!!.jsonPrimitive.content)
        assertEquals("merhaba", sent["messages"]!!.jsonArray[0].jsonObject["content"]!!.jsonPrimitive.content)
    }

    @Test fun chat_sendsHistorySummary() = runTest {
        server.enqueue(MockResponse().setBody("data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\ndata: [DONE]\n\n"))
        client().streamChat(ChatStreamRequest("selam", emptyList(), historySummary = "- önceki")) {}
        assertEquals("- önceki", body(server.takeRequest().body.readUtf8())["history_summary"]!!.jsonPrimitive.content)
    }

    @Test fun chat_sendsDeepThinkOnlyWhenOn() = runTest {
        repeat(2) { server.enqueue(MockResponse().setBody("data: [DONE]\n\n")) }
        client().streamChat(ChatStreamRequest("selam", emptyList(), deepThink = true)) {}
        assertEquals("true", body(server.takeRequest().body.readUtf8())["deep_think"]!!.jsonPrimitive.content)
        client().streamChat(ChatStreamRequest("selam", emptyList())) {}
        assertNull(body(server.takeRequest().body.readUtf8())["deep_think"])
    }

    @Test fun import_sendsText_andReadsCounts() = runTest {
        server.enqueue(MockResponse().setBody("""{"success":true,"saved":[{"key":"isim","value":"Bekir"},{"key":"şehir","value":"Üsküp"}],"skippedForLimit":1,"from":"ChatGPT"}"""))
        assertEquals(com.tyler.kocamind.data.memory.ImportResult(saved = 2, skippedForLimit = 1, from = "ChatGPT"), client().importMemories("- isim: Bekir"))
        val request = server.takeRequest()
        assertEquals("/memory/import", request.path)
        assertEquals("- isim: Bekir", body(request.body.readUtf8())["text"]!!.jsonPrimitive.content)
    }

    @Test fun insight_readsTextOrFewReason() = runTest {
        server.enqueue(MockResponse().setBody("""{"success":true,"insight":"Teknolojiye yönelmiş bir öğrencisin.","basedOn":4,"chats":12}"""))
        server.enqueue(MockResponse().setBody("""{"success":true,"insight":null,"reason":"few","basedOn":1}"""))
        assertEquals(com.tyler.kocamind.data.memory.MemoryInsight("Teknolojiye yönelmiş bir öğrencisin.", 4, 12), client().memoryInsight(refresh = true))
        assertEquals("true", body(server.takeRequest().body.readUtf8())["refresh"]!!.jsonPrimitive.content)
        assertEquals(com.tyler.kocamind.data.memory.MemoryInsight(null, 1), client().memoryInsight(refresh = false))
    }
}
