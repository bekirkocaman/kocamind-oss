package com.tyler.kocamind.data.crash

import com.tyler.kocamind.BuildConfig
import com.tyler.kocamind.data.backend.BackendClient
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.nio.file.Files
import java.util.Base64
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class CrashReporterTest {
    private class SilentFailure(cause: Throwable) : IllegalStateException("müşteri notu: 42", cause) {
        override val message: String get() = error("İstisna mesajı okunmamalı")
    }

    private lateinit var crashDir: File
    private val json = Json { ignoreUnknownKeys = true }
    private val dayMs = 24 * 60 * 60 * 1000L

    @Before
    fun setUp() {
        crashDir = Files.createTempDirectory("crash_reporter_test").toFile()
    }

    @After
    fun tearDown() {
        crashDir.deleteRecursively()
    }

    private fun readReport(file: File): StoredCrashReport = json.decodeFromString(file.readText(Charsets.UTF_8))

    private fun readReports(): List<StoredCrashReport> = crashDir.listFiles { file -> file.name.endsWith(".json") }
        .orEmpty()
        .map(::readReport)

    @Test
    fun recordCrash_writesOnlyExceptionClassesAndFramesWithMetadata() {
        val reporter = CrashReporter(
            crashDir = crashDir,
            userAgentProvider = { defaultUserAgent("15", "Pixel 9") },
            nowMs = { 1_700_000_000_000L },
            currentUid = { "abc" },
        )
        reporter.currentScreen = "MainActivity"
        val cause = RuntimeException("PIN 5191 ve ali@example.org").apply {
            stackTrace = arrayOf(StackTraceElement("a.Reader", "read", "Reader.kt", 25))
        }
        val root = SilentFailure(cause).apply {
            stackTrace = arrayOf(StackTraceElement("a.Main", "start", "Main.kt", 18))
        }

        val file = requireNotNull(reporter.recordCrash(root))
        val raw = file.readText()
        val report = readReport(file)
        assertEquals("${root.javaClass.name} | java.lang.RuntimeException", report.message)
        assertEquals("at a.Main.start(Main.kt:18)\nCaused by: java.lang.RuntimeException\nat a.Reader.read(Reader.kt:25)", report.stack)
        assertFalse(raw.contains("müşteri notu"))
        assertFalse(raw.contains("PIN 5191"))
        assertFalse(raw.contains("ali@example.org"))
        assertEquals("ba7816bf8f01cfea", report.ownerHash)
        assertEquals(4, UUID.fromString(requireNotNull(report.reportId)).version())
        assertEquals("${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})", report.release)
        assertEquals("Android 15; Pixel 9", report.userAgent)
        assertEquals("MainActivity", report.url)
        assertEquals(1_700_000_000_000L, report.timestamp)
        assertEquals(0, report.attempts)
        assertEquals("Android unknown; unknown", defaultUserAgent(null, ""))
        assertEquals(listOf(file), crashDir.listFiles()!!.toList())
    }

    @Test
    fun recordCrash_cleansRecognizedSecretsAndLineBreaksInStructuralFields() {
        val reporter = CrashReporter(crashDir)
        val exception = IllegalStateException().apply {
            stackTrace = arrayOf(StackTraceElement("a.Main", "read", "ali@example.org\nBearer hide-me", 5))
        }
        val report = readReport(requireNotNull(reporter.recordCrash(exception)))
        assertEquals("at a.Main.read([REDACTED_EMAIL]_Bearer [REDACTED]:5)", report.stack)
        assertEquals("normal.className", sanitizeCrashText("normal.className"))
        assertEquals("[REDACTED_TOKEN]", sanitizeCrashText("a".repeat(32)))
    }

    @Test
    fun recordCrash_boundsFrameCountDepthCharactersAndBytes() {
        val reporter = CrashReporter(crashDir)
        val shortFrames = Array(350) { StackTraceElement("A", "m", "F", it + 1) }
        var deep: Throwable = IllegalStateException()
        repeat(100) {
            deep = RuntimeException(null, deep).apply { stackTrace = shortFrames }
        }
        val bounded = readReport(requireNotNull(reporter.recordCrash(deep)))
        assertEquals(64, bounded.stack.lineSequence().count { it.startsWith("at ") })
        assertEquals(7, bounded.stack.lineSequence().count { it.startsWith("Caused by: ") })

        val longFrames = Array(350) { StackTraceElement("中".repeat(200), "文".repeat(200), "件".repeat(200), it + 1) }
        val heavy = IllegalArgumentException().apply { stackTrace = longFrames }
        val file = requireNotNull(reporter.recordCrash(heavy, screen = "語".repeat(500)))
        val report = readReport(file)
        assertTrue(report.message.length <= 500)
        assertTrue(report.stack.length in 1..5000)
        assertTrue(report.stack.lineSequence().all { it.startsWith("at ") && it.endsWith(")") })
        assertTrue(file.length() <= 16 * 1024)
    }

    @Test
    fun cleanup_deletesExpiredAndLegacyReportsIncludingWhenSignedOutAndDebug() {
        var now = 10 * dayMs
        var uid: String? = "alice"
        val reporter = CrashReporter(crashDir, isDebug = true, nowMs = { now }, currentUid = { uid })
        val expiredOwner = requireNotNull(reporter.recordCrash(IllegalStateException()))
        now++
        uid = null
        val expiredAnonymous = requireNotNull(reporter.recordCrash(IllegalStateException()))
        now++
        val onBoundary = requireNotNull(reporter.recordCrash(IllegalStateException()))
        val orphanedTemp = File(crashDir, "incomplete.json.tmp").apply {
            writeText("partial")
            assertTrue(setLastModified(now - 1))
        }
        val legacy = File(crashDir, "crash_legacy.json").apply {
            writeText("""{"message":"raw text","stack":"old","release":"1","userAgent":"x","timestamp":$now}""")
        }
        now += 7 * dayMs
        reporter.cleanUp()
        assertFalse(expiredOwner.exists())
        assertFalse(expiredAnonymous.exists())
        assertFalse(orphanedTemp.exists())
        assertFalse(legacy.exists())
        assertTrue(onBoundary.exists())
        now++
        reporter.cleanUp()
        assertFalse(onBoundary.exists())
    }

    @Test
    fun cleanup_keepsFiveNewestCompletedReports() {
        var now = 1000L
        val reporter = CrashReporter(crashDir, nowMs = { ++now })
        repeat(7) { reporter.recordCrash(RuntimeException()) }

        reporter.cleanUp()

        assertEquals((1003L..1007L).toList(), readReports().map { it.timestamp }.sorted())
    }

    @Test
    fun flushPending_waitsForOwnersReturnAndNeverSendsAnonymousReports() = runTest {
        var uid: String? = "alice"
        val reporter = CrashReporter(crashDir, isDebug = false, currentUid = { uid })
        val owner = requireNotNull(reporter.recordCrash(RuntimeException()))
        uid = null
        val anonymous = requireNotNull(reporter.recordCrash(RuntimeException()))
        val deliveries = mutableListOf<String>()
        val send: suspend (StoredCrashReport, String) -> Boolean = { _, account -> deliveries.add(account) }

        reporter.flushPending(send)
        uid = "alice-2"
        reporter.flushPending(send)
        assertTrue(deliveries.isEmpty())
        assertEquals(0, readReport(owner).attempts)
        assertNull(readReport(anonymous).ownerHash)

        uid = "alice"
        reporter.flushPending(send)
        assertEquals(listOf("alice"), deliveries)
        assertFalse(owner.exists())
        assertTrue(anonymous.exists())
    }

    @Test
    fun flushPending_retriesAcceptedFalseWithSameIdAndDeletesOnlyWhenAccepted() = runTest {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(202).setBody("""{"accepted":false}"""))
            server.enqueue(MockResponse().setResponseCode(202).setBody("""{"accepted":true}"""))
            server.start()
            val token = tokenFor("alice")
            val backend = BackendClient(server.url("/").toString().trimEnd('/'), OkHttpClient()) { token }
            val reporter = CrashReporter(crashDir, isDebug = false, currentUid = { "alice" })
            val file = requireNotNull(reporter.recordCrash(NullPointerException("eksik alan"), screen = "ChatScreen"))
            val reportId = readReport(file).reportId
            val send: suspend (StoredCrashReport, String) -> Boolean = { report, uid ->
                backend.sendErrorTelemetry(
                    report.message, report.stack, report.release, report.userAgent, report.url,
                    reportId = report.reportId, expectedUid = uid,
                )
            }

            reporter.flushPending(send)
            assertEquals(1, readReport(file).attempts)
            assertEquals(reportId, readReport(file).reportId)
            reporter.flushPending(send)

            assertFalse(file.exists())
            assertEquals(2, server.requestCount)
            val requests = (1..2).map { requireNotNull(server.takeRequest(2, TimeUnit.SECONDS)) }
            for (request in requests) {
                assertEquals("/telemetry/error", request.path)
                assertEquals("Bearer $token", request.getHeader("Authorization"))
                val body = json.parseToJsonElement(request.body.readUtf8()).jsonObject
                assertEquals(JsonPrimitive("java.lang.NullPointerException"), body["message"])
                assertEquals(JsonPrimitive(reportId), body["reportId"])
                assertEquals(JsonPrimitive("ChatScreen"), body["url"])
                assertFalse(body.containsKey("ownerHash"))
            }
        }
    }

    @Test
    fun sendErrorTelemetry_rejectsAnotherAccountsTokenAndRequiresBooleanAcceptance() = runTest {
        MockWebServer().use { server ->
            server.start()
            var token = tokenFor("alice-2")
            val backend = BackendClient(server.url("/").toString().trimEnd('/'), OkHttpClient()) { token }
            assertFalse(backend.sendErrorTelemetry("Error", "", expectedUid = "alice"))
            token = "not-a-jwt"
            assertFalse(backend.sendErrorTelemetry("Error", "", expectedUid = "alice"))
            token = tokenFor("alice")
            assertFalse(backend.sendErrorTelemetry("Error", "", expectedUid = "alice", isSessionCurrent = { false }))
            assertEquals(0, server.requestCount)

            for (response in listOf("", "{}", "null", "broken", """{"accepted":"true"}""")) {
                server.enqueue(MockResponse().setResponseCode(202).setBody(response))
                assertFalse(backend.sendErrorTelemetry("Error", "", expectedUid = "alice"))
            }
            server.enqueue(MockResponse().setResponseCode(500).setBody("""{"accepted":true}"""))
            assertFalse(backend.sendErrorTelemetry("Error", "", expectedUid = "alice"))
        }
    }

    @Test
    fun flushPending_keepsOriginalRetryCeilingAndDebugPolicy() = runTest {
        val reporter = CrashReporter(crashDir, isDebug = true, currentUid = { "alice" })
        val file = requireNotNull(reporter.recordCrash(RuntimeException()))
        val send: suspend (StoredCrashReport, String) -> Boolean = { _, _ -> false }
        reporter.flushPending { _, _ -> error("Debug gönderimi kapalı") }
        assertEquals(0, readReport(file).attempts)

        reporter.sendInDebug = true
        for (attempt in 1..2) {
            reporter.flushPending(send)
            assertEquals(attempt, readReport(file).attempts)
        }
        reporter.flushPending(send)
        assertFalse(file.exists())
    }

    @Test
    fun installExceptionHandler_catchesStartupFailureBeforeSessionWiringAndChainsOnce() {
        val original = Thread.getDefaultUncaughtExceptionHandler()
        val startupError = IllegalStateException("başlatma hatası")
        val callingThread = Thread.currentThread()
        var chains = 0
        try {
            Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
                chains++
                assertSame(callingThread, thread)
                assertSame(startupError, throwable)
                assertEquals("java.lang.IllegalStateException", readReports().single().message)
            }
            val reporter = CrashReporter(crashDir)
            reporter.installExceptionHandler()
            reporter.installExceptionHandler()

            Thread.getDefaultUncaughtExceptionHandler()!!.uncaughtException(callingThread, startupError)

            assertEquals(1, chains)
            assertNull(readReports().single().ownerHash)
        } finally {
            Thread.setDefaultUncaughtExceptionHandler(original)
        }
    }

    @Test
    fun installExceptionHandler_chainsWhenWritingFails() {
        val original = Thread.getDefaultUncaughtExceptionHandler()
        val brokenCrashDir = File(crashDir, "not-a-directory").apply { writeText("file") }
        val boom = IllegalStateException()
        var chained: Throwable? = null
        try {
            Thread.setDefaultUncaughtExceptionHandler { _, throwable -> chained = throwable }
            val reporter = CrashReporter(brokenCrashDir, userAgentProvider = { error("metadata failed") })
            reporter.installExceptionHandler()
            Thread.getDefaultUncaughtExceptionHandler()!!.uncaughtException(Thread.currentThread(), boom)
            assertSame(boom, chained)
            assertTrue(readReports().isEmpty())
        } finally {
            Thread.setDefaultUncaughtExceptionHandler(original)
        }
    }

    @Test
    fun recordCrash_doesNotWaitForAnotherRecording() {
        val recording = CountDownLatch(1)
        val finish = CountDownLatch(1)
        val reporter = CrashReporter(crashDir, userAgentProvider = {
            recording.countDown()
            check(finish.await(5, TimeUnit.SECONDS))
            "Android"
        })
        val executor = Executors.newFixedThreadPool(2)
        try {
            val first = executor.submit<File?> { reporter.recordCrash(RuntimeException()) }
            assertTrue(recording.await(2, TimeUnit.SECONDS))
            val second = executor.submit<File?> { reporter.recordCrash(RuntimeException()) }
            assertNull(second.get(2, TimeUnit.SECONDS))
            finish.countDown()
            assertTrue(requireNotNull(first.get(2, TimeUnit.SECONDS)).isFile)
        } finally {
            finish.countDown()
            executor.shutdownNow()
        }
    }

    private fun tokenFor(uid: String): String {
        val claims = Base64.getUrlEncoder().withoutPadding().encodeToString("""{"sub":"$uid"}""".toByteArray())
        return "header.$claims.signature"
    }
}
