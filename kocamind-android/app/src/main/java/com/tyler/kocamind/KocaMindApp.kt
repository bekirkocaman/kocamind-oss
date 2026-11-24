package com.tyler.kocamind

import android.app.Application
import com.google.firebase.auth.FirebaseAuth
import com.tyler.kocamind.data.auth.FirebaseAuthRepository
import com.tyler.kocamind.data.crash.CrashReporter
import com.tyler.kocamind.data.legacy.LegacyMigration
import kotlinx.coroutines.runBlocking
import java.io.File

class KocaMindApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        val crashReporter = CrashReporter(File(filesDir, "crash"))
        crashReporter.installExceptionHandler()
        super.onCreate()
        crashReporter.cleanUp()
        // Eski Expo uygulamasının üzerine kurulduysa veriyi ekranlar okumadan önce bir kez taşı.
        // Eski veritabanı yoksa ya da daha önce taşındıysa anında döner.
        if (getDatabasePath("RKStorage").exists()) {
            runBlocking { LegacyMigration(this@KocaMindApp, File(filesDir, "chats")).runOnce() }
        }
        container = AppContainer(this)
        val auth = container.authRepository
        val firebaseAuth = if (auth is FirebaseAuthRepository) FirebaseAuth.getInstance() else null
        val currentUid = { firebaseAuth?.currentUser?.uid }
        crashReporter.startDelivery(
            application = this,
            scope = container.appScope,
            currentUser = auth.currentUser,
            currentUid = currentUid,
        ) { report, uid ->
            container.backendClient.sendErrorTelemetry(
                message = report.message,
                stack = report.stack,
                release = report.release,
                userAgent = report.userAgent,
                url = report.url,
                reportId = report.reportId,
                expectedUid = uid,
                isSessionCurrent = { currentUid() == uid },
            )
        }
    }
}
