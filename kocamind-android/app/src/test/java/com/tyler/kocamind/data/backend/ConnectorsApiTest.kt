package com.tyler.kocamind.data.backend

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class ConnectorsApiTest {
    private val server = MockWebServer()

    @Before fun setUp() = server.start()
    @After fun tearDown() = server.shutdown()

    private fun client() = BackendClient(server.url("/").toString(), OkHttpClient(), tokenProvider = { "tok" })

    @Test fun catalog_readsConnectors() = runTest {
        server.enqueue(MockResponse().setBody(
            """{"enabled":true,"plusRequired":true,"allowed":false,"connectors":[
              {"id":"google_calendar","label":"Google Takvim","description":"Etkinlikler","available":true,"connected":true,"status":"reauth","toolCount":2},
              {"id":"notion","label":"Notion","description":"Sayfalar","available":false,"connected":false,"status":null}]}""",
        ))
        val catalog = client().connectors()
        assertTrue(catalog.enabled)
        assertFalse(catalog.allowed)
        assertEquals(ConnectorInfo("google_calendar", "Google Takvim", "Etkinlikler", available = true, connected = true, status = "reauth"), catalog.connectors[0])
        assertEquals("notion", catalog.connectors[1].id)
        assertEquals("/connectors", server.takeRequest().path)
    }

    @Test fun start_sendsAndroidClient_andReturnsHttpsUrl() = runTest {
        server.enqueue(MockResponse().setBody("""{"authUrl":"https://accounts.google.com/o/oauth2?x=1"}"""))
        assertEquals("https://accounts.google.com/o/oauth2?x=1", client().startConnector("google_calendar"))
        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/connectors/google_calendar/connect", request.path)
        assertEquals("android", Json.parseToJsonElement(request.body.readUtf8()).jsonObject["client"]!!.jsonPrimitive.content)
    }

    @Test(expected = BackendException::class)
    fun start_rejectsNonHttpsUrl() = runTest {
        server.enqueue(MockResponse().setBody("""{"authUrl":"javascript:alert(1)"}"""))
        client().startConnector("notion")
    }

    @Test fun start_errorMessageFromServer() = runTest {
        server.enqueue(MockResponse().setResponseCode(403).setBody("""{"error":"Bağlantılar Plus aboneliğinde kullanılabilir.","code":"plus_required"}"""))
        val error = runCatching { client().startConnector("notion") }.exceptionOrNull()
        assertEquals("Bağlantılar Plus aboneliğinde kullanılabilir.", error?.message)
    }

    @Test fun disconnect_usesDelete() = runTest {
        server.enqueue(MockResponse().setBody("""{"disconnected":true}"""))
        client().disconnectConnector("github")
        val request = server.takeRequest()
        assertEquals("DELETE", request.method)
        assertEquals("/connectors/github", request.path)
    }

    @Test fun skills_readsVisibleFields() = runTest {
        server.enqueue(MockResponse().setBody(
            """{"skills":[{"name":"dilekce","title":"Dilekçe","description":"Dilekçe hazırlar.","where":["Sohbet"],"alwaysOn":false},
              {"name":"x","description":"Başlıksız","where":[],"alwaysOn":true}]}""",
        ))
        val skills = client().skills()
        assertEquals(SkillInfo("dilekce", "Dilekçe", "Dilekçe hazırlar.", listOf("Sohbet"), alwaysOn = false), skills[0])
        assertEquals("x", skills[1].title)
        assertTrue(skills[1].alwaysOn)
        assertEquals("/skills", server.takeRequest().path)
    }

    @Test fun skills_readsInstalledSkill() = runTest {
        server.enqueue(MockResponse().setBody(
            """{"skills":[{"name":"sunum","title":"Sunum","description":"Sunum hazırlar.","where":["Her yerde"],"alwaysOn":false,"installed":true,"sourceUrl":"https://github.com/ornek/skills"}]}""",
        ))
        val skill = client().skills().single()
        assertTrue(skill.installed)
        assertEquals("https://github.com/ornek/skills", skill.sourceUrl)
    }

    @Test fun removeSkill_usesDelete() = runTest {
        server.enqueue(MockResponse().setBody("""{"deleted":true}"""))
        client().removeSkill("sunum")
        val request = server.takeRequest()
        assertEquals("DELETE", request.method)
        assertEquals("/skills/sunum", request.path)
    }
}
