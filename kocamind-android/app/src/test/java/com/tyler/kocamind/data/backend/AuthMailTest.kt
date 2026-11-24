package com.tyler.kocamind.data.backend

import com.tyler.kocamind.data.auth.sendWithFallback
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
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class AuthMailTest {
    private val server = MockWebServer()

    @Before fun setUp() = server.start()
    @After fun tearDown() = server.shutdown()

    private fun client(token: String? = "tok") = BackendClient(server.url("/").toString(), OkHttpClient(), tokenProvider = { token })

    @Test fun passwordReset_postsEmailWithoutToken_trueOn200() = runTest {
        server.enqueue(MockResponse().setBody("""{"success":true}"""))
        assertTrue(client().sendPasswordResetEmail("ali@ornek.com"))
        val request = server.takeRequest()
        assertEquals("/auth/email/password-reset", request.path)
        assertNull(request.getHeader("Authorization"))
        assertEquals("ali@ornek.com", Json.parseToJsonElement(request.body.readUtf8()).jsonObject["email"]!!.jsonPrimitive.content)
    }

    @Test fun verification_sendsToken_falseOnFallback() = runTest {
        server.enqueue(MockResponse().setResponseCode(503).setBody("""{"fallback":true}"""))
        assertFalse(client().sendVerificationEmail())
        assertEquals("Bearer tok", server.takeRequest().getHeader("Authorization"))
    }

    @Test fun networkFailure_isFalse_notThrown() = runTest {
        server.shutdown()
        assertFalse(client().sendPasswordResetEmail("ali@ornek.com"))
    }

    @Test fun fallback_runsOnlyWhenBackendDidNotSend() = runTest {
        var firebase = 0
        sendWithFallback(primary = { true }) { firebase++ }
        assertEquals(0, firebase)
        sendWithFallback(primary = { false }) { firebase++ }
        sendWithFallback(primary = { error("bağlantı yok") }) { firebase++ }
        assertEquals(2, firebase)
    }
}
