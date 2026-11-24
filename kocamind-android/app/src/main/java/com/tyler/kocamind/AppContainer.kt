package com.tyler.kocamind

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.tyler.kocamind.data.auth.AuthRepository
import com.tyler.kocamind.data.auth.CredentialManagerGoogleSignInClient
import com.tyler.kocamind.data.auth.FirebaseAuthRepository
import com.tyler.kocamind.data.auth.WelcomeEmail
import com.tyler.kocamind.data.auth.GoogleSignInClient
import com.tyler.kocamind.data.auth.UnconfiguredAuthRepository
import com.tyler.kocamind.data.backend.BackendClient
import com.tyler.kocamind.data.chat.ChatCommands
import com.tyler.kocamind.data.chat.ChatHistoryRepository
import com.tyler.kocamind.data.chat.ChatStore
import com.tyler.kocamind.data.chat.FileChatHistoryRepository
import com.tyler.kocamind.data.chat.SharedPrefsChatPrefs
import com.tyler.kocamind.data.admin.AdminApi
import com.tyler.kocamind.data.admin.FirestoreAdminApi
import com.tyler.kocamind.data.media.AndroidMediaFiles
import com.tyler.kocamind.data.offline.LlamaSession
import com.tyler.kocamind.data.offline.OfflineAiService
import com.tyler.kocamind.data.offline.OfflineLocalAi
import com.tyler.kocamind.data.offline.SharedPrefsOfflinePrefs
import com.tyler.kocamind.data.offline.androidDeviceProfile
import com.tyler.kocamind.ui.chat.LocalAi
import com.tyler.kocamind.data.media.LibraryStore
import com.tyler.kocamind.data.queue.FileOfflineQueue
import com.tyler.kocamind.data.queue.NetworkMonitor
import com.tyler.kocamind.data.queue.OfflineQueue
import com.tyler.kocamind.data.sync.CloudChatSync
import com.tyler.kocamind.data.sync.CloudSyncedChatStore
import com.tyler.kocamind.data.sync.FirestoreCloudChatApi
import com.tyler.kocamind.data.sync.PrefsPendingOpsStore
import com.tyler.kocamind.data.sync.PrefsSyncBaseStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import com.tyler.kocamind.data.memory.FileMemoryCache
import com.tyler.kocamind.data.memory.MemoryPrefs
import com.tyler.kocamind.data.memory.MemoryRepository
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/** Elle bağımlılık bağlama (DI kütüphanesi yok). */
class AppContainer(context: Context) {
    private val appContext = context.applicationContext

    /** Cihaz profili gibi yalnız Context isteyen yardımcılar için. */
    val appContextForProfile: Context get() = appContext

    val authRepository: AuthRepository by lazy {
        // google-services.json yoksa initializeApp null döner.
        val app = FirebaseApp.initializeApp(appContext)
        if (app == null) {
            UnconfiguredAuthRepository()
        } else {
            FirebaseAuthRepository(FirebaseAuth.getInstance(app), FirebaseFirestore.getInstance(app), mailer = { backendClient })
        }
    }

    val googleSignInClient: GoogleSignInClient = CredentialManagerGoogleSignInClient()

    private val httpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            // Agent adımları ve görsel üretimi bir dakikadan uzun sessiz kalabiliyor (sunucu agent süresi 800 sn'ye
            // kadar). Kullanıcı istediği an Durdur ile keser; bu sınır yalnız kopmuş bağlantılar için.
            .readTimeout(15, TimeUnit.MINUTES)
            .build()
    }

    val backendClient: BackendClient by lazy {
        BackendClient(BuildConfig.BACKEND_URL, httpClient) { authRepository.idToken() }
    }

    /** Uygulama ömrü boyunca süren işler (bulut yazımları gibi). */
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    val networkMonitor: NetworkMonitor by lazy { NetworkMonitor(appContext) }

    val offlineQueue: OfflineQueue by lazy { FileOfflineQueue(appContext.filesDir) }

    /** Firebase yapılandırılmamışsa null: sohbetler yalnız yerelde tutulur. */
    val cloudChatSync: CloudChatSync? by lazy {
        if (authRepository !is FirebaseAuthRepository) return@lazy null
        CloudChatSync(
            FirestoreCloudChatApi(FirebaseFirestore.getInstance()),
            PrefsPendingOpsStore(appContext),
            PrefsSyncBaseStore(appContext),
        )
    }

    private val localChatStore by lazy { FileChatHistoryRepository(java.io.File(appContext.filesDir, "chats")) }

    /** Firebase yoksa null; varsa yerel depoyu bulutla eşitler. */
    val syncedChatStore: CloudSyncedChatStore? by lazy {
        cloudChatSync?.let { sync ->
            CloudSyncedChatStore(localChatStore, sync, appScope) {
                authRepository.currentUser.value?.takeIf { it.emailVerified }?.uid
            }
        }
    }

    val chatStore: ChatStore get() = syncedChatStore ?: localChatStore
    val chatHistory: ChatHistoryRepository get() = chatStore

    val chatPrefs = SharedPrefsChatPrefs(appContext)
    val themePrefs = com.tyler.kocamind.ui.theme.ThemePrefs(appContext)
    val appPrefs = com.tyler.kocamind.data.settings.AppPrefs(appContext)

    /**
     * Bulut hafızası (`users/{uid}/memories`); kullanıcı başına cihazda da bir kopyası tutulur.
     * Oturum değişince önceki kullanıcınınki unutulur, yeninin kopyası yüklenip buluttan yenilenir.
     */
    val memoryRepository: MemoryRepository by lazy {
        MemoryRepository(backendClient, MemoryPrefs(appContext), appScope, FileMemoryCache(java.io.File(appContext.filesDir, "memory"))).also { repo ->
            appScope.launch {
                authRepository.currentUser
                    .map { user -> user?.takeIf { it.emailVerified }?.uid }
                    .distinctUntilChanged()
                    .collect { uid -> repo.switchUser(uid) }
            }
        }
    }

    /** Doğrulanmış her kullanıcıya bir kez hoş geldin maili (uygulama açılınca dinlemeye başlar). */
    private val welcomeEmail = WelcomeEmail(WelcomeEmail.PrefsStore(appContext)) { backendClient.sendWelcomeEmail() }

    init {
        appScope.launch {
            authRepository.currentUser
                .map { user -> user?.takeIf { it.emailVerified }?.uid }
                .distinctUntilChanged()
                .collect { uid -> if (uid != null) welcomeEmail.onVerifiedSignIn(uid) }
        }
    }

    /** Admin ekranlarının Firestore okumaları; Firebase yoksa null. */
    val adminApi: AdminApi? by lazy {
        if (authRepository is FirebaseAuthRepository) FirestoreAdminApi(FirebaseFirestore.getInstance()) else null
    }

    /** Telefonda çalışan yerel model (llama.cpp). */
    val offlineAi: OfflineAiService by lazy {
        val dir = java.io.File(appContext.filesDir, "offline-models")
        OfflineAiService(
            modelsDir = dir,
            prefs = SharedPrefsOfflinePrefs(appContext),
            deviceProfile = { androidDeviceProfile(appContext, dir) },
            http = httpClient.newBuilder().readTimeout(2, TimeUnit.MINUTES).build(),
            engine = { file, contextSize -> LlamaSession.open(file, contextSize) },
        )
    }

    val localAi: LocalAi by lazy { OfflineLocalAi(offlineAi) }

    val libraryStore: LibraryStore by lazy { LibraryStore(appContext.filesDir) }

    val mediaFiles: AndroidMediaFiles by lazy { AndroidMediaFiles(appContext, libraryStore) }

    val chatCommands = ChatCommands()

    /** Tarayıcıdaki bağlantı izninden dönüş; Bağlantılar ekranı gösterip temizler. */
    val connectorReturn = kotlinx.coroutines.flow.MutableStateFlow<com.tyler.kocamind.data.backend.ConnectorReturn?>(null)

    /** Başka uygulamadan "Paylaş" ile gelen içerik; sohbet ekranı mesaj kutusuna koyup temizler. */
    val sharedContent = kotlinx.coroutines.flow.MutableStateFlow<com.tyler.kocamind.data.chat.SharedContent?>(null)
}
