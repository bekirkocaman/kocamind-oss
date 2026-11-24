package com.tyler.kocamind.data.crash

import android.app.Activity
import android.app.Application
import android.os.Build
import android.os.Bundle
import com.tyler.kocamind.BuildConfig
import com.tyler.kocamind.data.auth.AuthUser
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption.ATOMIC_MOVE
import java.nio.file.StandardCopyOption.REPLACE_EXISTING
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ThreadLocalRandom
import java.util.concurrent.atomic.AtomicBoolean

private const val MAX_FILES = 5
private const val MAX_FILE_BYTES = 16 * 1024
private const val MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000L
private const val MAX_MESSAGE_LENGTH = 500
private const val MAX_STACK_LENGTH = 5000
private const val MAX_CAUSE_DEPTH = 8
private const val MAX_STACK_FRAMES = 64
private const val MAX_FRAMES_PER_CAUSE = 24
private const val MAX_FRAME_FIELD_LENGTH = 200
private const val MAX_URL_LENGTH = 500
private const val MAX_USER_AGENT_LENGTH = 500
private const val MAX_RELEASE_LENGTH = 100
private const val MAX_ATTEMPTS = 3

private val BEARER_REGEX = Regex("""(?i)\bBearer\s+[^\s"',;)\]]+""")
private val EMAIL_REGEX = Regex("""[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}""")
private val JWT_REGEX = Regex("""\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b""")
private val LONG_TOKEN_REGEX = Regex("""[A-Za-z0-9_-]{32,}""")
private val FRAME_DELIMITERS = Regex("""[\p{Cc}\p{Zl}\p{Zp}():]""")

private val crashJson = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
}

@Serializable
data class StoredCrashReport(
    val message: String,
    val stack: String,
    val release: String,
    val userAgent: String,
    val url: String = "",
    val timestamp: Long = 0L,
    val attempts: Int = 0,
    val reportId: String? = null,
    val ownerHash: String? = null,
)

/** Yapısal alanlarda da tanınan gizli veri biçimlerini temizler. */
internal fun sanitizeCrashText(text: String): String = text
    .replace(BEARER_REGEX, "Bearer [REDACTED]")
    .replace(EMAIL_REGEX, "[REDACTED_EMAIL]")
    .replace(JWT_REGEX, "[REDACTED_TOKEN]")
    .replace(LONG_TOKEN_REGEX, "[REDACTED_TOKEN]")

private fun ownerHash(uid: String): String = MessageDigest.getInstance("SHA-256")
    .digest(uid.toByteArray(Charsets.UTF_8))
    .take(8)
    .joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }

private fun frameField(value: String): String = sanitizeCrashText(value.take(MAX_FRAME_FIELD_LENGTH))
    .replace(FRAME_DELIMITERS, "_")

private fun exceptionChain(throwable: Throwable): List<Throwable> = buildList {
    var current: Throwable? = throwable
    while (size < MAX_CAUSE_DEPTH) {
        val cause = current ?: break
        if (any { it === cause }) break
        add(cause)
        current = cause.cause
    }
}

private fun stackSummary(chain: List<Throwable>): String = buildString {
    var frameCount = 0
    for ((index, cause) in chain.withIndex()) {
        if (index > 0 && !appendStackLine("Caused by: ${frameField(cause.javaClass.name)}")) break
        if (frameCount == MAX_STACK_FRAMES) continue
        val frames = cause.stackTrace
        val count = minOf(frames.size, MAX_FRAMES_PER_CAUSE, MAX_STACK_FRAMES - frameCount)
        for (frameIndex in 0 until count) {
            val frame = frames[frameIndex]
            val fileName = frame.fileName
            val location = when {
                frame.isNativeMethod -> "Native Method"
                fileName == null -> "Unknown Source"
                frame.lineNumber < 0 -> frameField(fileName)
                else -> "${frameField(fileName)}:${frame.lineNumber}"
            }
            if (!appendStackLine("at ${frameField(frame.className)}.${frameField(frame.methodName)}($location)")) break
            frameCount++
        }
    }
}

private fun StringBuilder.appendStackLine(line: String): Boolean {
    val separatorLength = if (isEmpty()) 0 else 1
    if (length + separatorLength + line.length > MAX_STACK_LENGTH) return false
    if (separatorLength > 0) append('\n')
    append(line)
    return true
}

private fun newReportId(): String {
    // UUID v4; kimlik sır değildir ve paylaşılan bir rastgele sayı üretecinde beklemez.
    val random = ThreadLocalRandom.current()
    return UUID(
        (random.nextLong() and 0xffff_ffff_ffff_0fffUL.toLong()) or 0x4000L,
        (random.nextLong() and 0x3fff_ffff_ffff_ffffL) or Long.MIN_VALUE,
    ).toString()
}

fun defaultRelease(): String = "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})"

fun defaultUserAgent(
    osRelease: String? = Build.VERSION.RELEASE,
    deviceModel: String? = Build.MODEL,
): String {
    val os = osRelease?.takeIf { it.isNotBlank() } ?: "unknown"
    val model = deviceModel?.takeIf { it.isNotBlank() } ?: "unknown"
    return "Android $os; $model"
}

/** Yakalanmamış istisnaları yerelde saklar ve yalnızca kaydın sahibi oturumdayken gönderir. */
class CrashReporter(
    private val crashDir: File,
    private val isDebug: Boolean = BuildConfig.DEBUG,
    @Volatile var sendInDebug: Boolean = false,
    private val release: String = defaultRelease(),
    private val userAgentProvider: () -> String = { defaultUserAgent() },
    private val nowMs: () -> Long = System::currentTimeMillis,
    currentUid: () -> String? = { null },
) {
    @Volatile
    var currentScreen: String = ""

    @Volatile
    private var readCurrentUid = currentUid
    private val recording = AtomicBoolean()
    private val flushMutex = Mutex()

    fun installExceptionHandler() {
        val current = Thread.getDefaultUncaughtExceptionHandler()
        if (current is ChainedHandler && current.reporter === this) return
        Thread.setDefaultUncaughtExceptionHandler(ChainedHandler(this, current))
    }

    fun recordCrash(throwable: Throwable, screen: String = currentScreen): File? {
        if (!recording.compareAndSet(false, true)) return null
        try {
            val uid = readCurrentUid()
            val timestamp = nowMs()
            val chain = exceptionChain(throwable)
            val reportId = newReportId()
            val report = StoredCrashReport(
                message = chain.joinToString(" | ") { frameField(it.javaClass.name) }.take(MAX_MESSAGE_LENGTH),
                stack = stackSummary(chain),
                release = sanitizeCrashText(release.take(MAX_RELEASE_LENGTH).trim()).take(MAX_RELEASE_LENGTH),
                userAgent = sanitizeCrashText(userAgentProvider().take(MAX_USER_AGENT_LENGTH).trim()).take(MAX_USER_AGENT_LENGTH),
                url = sanitizeCrashText(screen.take(MAX_URL_LENGTH).trim()).take(MAX_URL_LENGTH),
                timestamp = timestamp,
                reportId = reportId,
                ownerHash = uid?.let(::ownerHash),
            )
            if (!crashDir.isDirectory && !crashDir.mkdirs() && !crashDir.isDirectory) return null
            val ts = timestamp.coerceAtLeast(0L).toString().padStart(19, '0')
            val target = File(crashDir, "crash_${ts}_$reportId.json")
            return target.takeIf { writeReportAtomically(it, report, replacing = false) }
        } finally {
            recording.set(false)
        }
    }

    /** Uygulama açılışında çağrılır. Yaş sınırı debug ve oturum durumundan bağımsızdır. */
    fun cleanUp() {
        val cutoff = nowMs() - MAX_AGE_MS
        val files = crashFiles().filter { readPendingReport(it, cutoff) != null }
        files.dropLast(MAX_FILES).forEach { it.delete() }
        crashDir.listFiles { file -> file.name.endsWith(".tmp") && file.lastModified() < cutoff }
            ?.forEach { it.delete() }
    }

    internal suspend fun flushPending(sender: suspend (StoredCrashReport, String) -> Boolean) {
        if (isDebug && !sendInDebug) return

        flushMutex.withLock {
            withContext(Dispatchers.IO) {
                val cutoff = nowMs() - MAX_AGE_MS
                for (file in crashFiles()) {
                    val uid = readCurrentUid() ?: break
                    val report = readPendingReport(file, cutoff) ?: continue
                    if (report.ownerHash != ownerHash(uid) || readCurrentUid() != uid) continue
                    val accepted = try {
                        sender(report, uid)
                    } catch (error: CancellationException) {
                        throw error
                    } catch (_: Exception) {
                        false
                    }
                    if (accepted) {
                        file.delete()
                    } else if (readCurrentUid() == uid) {
                        val nextAttempts = report.attempts + 1
                        if (nextAttempts >= MAX_ATTEMPTS) {
                            file.delete()
                        } else {
                            writeReportAtomically(file, report.copy(attempts = nextAttempts), replacing = true)
                        }
                    }
                }
            }
        }
    }

    private fun crashFiles(): List<File> = crashDir.listFiles { file -> file.isFile && file.name.endsWith(".json") }
        ?.sortedBy { it.name }
        .orEmpty()

    private fun readPendingReport(file: File, cutoff: Long): StoredCrashReport? {
        val report = if (file.length() <= MAX_FILE_BYTES) {
            runCatching { crashJson.decodeFromString<StoredCrashReport>(file.readText(Charsets.UTF_8)) }.getOrNull()
        } else {
            null
        }
        // Eski şema ham istisna metni içerebilir ve sahibini kanıtlayamaz.
        if (report?.reportId == null || report.timestamp < cutoff) {
            file.delete()
            return null
        }
        return report
    }

    private fun writeReportAtomically(target: File, report: StoredCrashReport, replacing: Boolean): Boolean {
        val direct = crashJson.encodeToString(report).toByteArray(Charsets.UTF_8)
        val encoded = if (direct.size <= MAX_FILE_BYTES) {
            direct
        } else {
            // Çok baytlı satırlarda yalnızca tam kareleri/neden satırlarını koru.
            val stack = report.stack.take(2000).substringBeforeLast('\n', "")
            crashJson.encodeToString(report.copy(stack = stack)).toByteArray(Charsets.UTF_8)
        }
        if (encoded.size > MAX_FILE_BYTES) return false
        val temporary = File(crashDir, "${target.name}.tmp")
        return try {
            temporary.writeBytes(encoded)
            if (replacing) {
                Files.move(temporary.toPath(), target.toPath(), ATOMIC_MOVE, REPLACE_EXISTING)
                true
            } else {
                temporary.renameTo(target)
            }
        } catch (_: java.io.IOException) {
            false
        } finally {
            temporary.delete()
        }
    }

    fun startDelivery(
        application: Application,
        scope: CoroutineScope,
        currentUser: StateFlow<AuthUser?>,
        currentUid: () -> String?,
        sender: suspend (StoredCrashReport, String) -> Boolean,
    ) {
        readCurrentUid = currentUid
        application.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
            override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
            override fun onActivityStarted(activity: Activity) = Unit
            override fun onActivityResumed(activity: Activity) {
                currentScreen = activity.javaClass.simpleName
            }
            override fun onActivityPaused(activity: Activity) = Unit
            override fun onActivityStopped(activity: Activity) = Unit
            override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
            override fun onActivityDestroyed(activity: Activity) = Unit
        })
        scope.launch(Dispatchers.IO) {
            currentUser.map { it?.uid }.distinctUntilChanged().collect { uid ->
                if (uid != null) flushPending(sender)
            }
        }
    }

    private class ChainedHandler(
        val reporter: CrashReporter,
        private val previous: Thread.UncaughtExceptionHandler?,
    ) : Thread.UncaughtExceptionHandler {
        override fun uncaughtException(thread: Thread, throwable: Throwable) {
            try {
                reporter.recordCrash(throwable)
            } catch (_: Throwable) {
                // Önceki işleyici, rapor yazımı başarısız olduğunda da çalışmalı.
            } finally {
                previous?.uncaughtException(thread, throwable)
            }
        }
    }
}
