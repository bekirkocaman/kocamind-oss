package com.tyler.kocamind.ui.nav

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tyler.kocamind.ui.auth.GoogleButton
import kotlinx.coroutines.launch
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import com.tyler.kocamind.KocaMindApp
import com.tyler.kocamind.ui.auth.AuthScreen
import com.tyler.kocamind.ui.auth.AuthViewModel
import com.tyler.kocamind.ui.auth.authViewModelFactory
import com.tyler.kocamind.data.chat.ChatCommand
import com.tyler.kocamind.ui.chat.ChatScreen
import com.tyler.kocamind.ui.chat.ChatViewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.tyler.kocamind.data.offline.androidDeviceProfile
import com.tyler.kocamind.ui.offline.OfflineModelsScreen
import com.tyler.kocamind.ui.settings.AdminScreen
import com.tyler.kocamind.ui.settings.CustomInstructionsScreen
import com.tyler.kocamind.ui.settings.MemoryScreen
import com.tyler.kocamind.ui.settings.AdminUserScreen
import com.tyler.kocamind.ui.settings.ConnectorsScreen
import com.tyler.kocamind.ui.settings.LibraryScreen
import com.tyler.kocamind.ui.settings.SkillsScreen
import com.tyler.kocamind.ui.settings.SettingsScreen
import com.tyler.kocamind.ui.theme.KmColors

fun Route.screenTag(): String = "screen-${path.substringBefore('/')}"

@Composable
fun KocaMindNavHost(navController: NavHostController, modifier: Modifier = Modifier) {
    val appContainer = (LocalContext.current.applicationContext as KocaMindApp).container
    // Tarayıcıdaki bağlantı izninden dönüldüyse sonucu göstermek için Bağlantılar açılır.
    val connectorReturn by appContainer.connectorReturn.collectAsStateWithLifecycle()
    LaunchedEffect(connectorReturn) {
        if (connectorReturn != null && navController.currentDestination?.route != Route.Connectors.path) {
            navController.navigate(Route.Connectors.path) { launchSingleTop = true }
        }
    }
    // Başka uygulamadan paylaşım geldiyse içerik sohbetin mesaj kutusuna düşer; önce sohbete dönülür.
    val sharedContent by appContainer.sharedContent.collectAsStateWithLifecycle()
    LaunchedEffect(sharedContent) {
        if (sharedContent != null && navController.currentDestination?.route != Route.Chat.path) {
            if (!navController.popBackStack(Route.Chat.path, inclusive = false)) navController.navigate(Route.Chat.path)
        }
    }
    NavHost(navController = navController, startDestination = Route.Chat.path, modifier = modifier) {
        Route.entries.forEach { route ->
            composable(route.path) {
                val tagged = Modifier
                    .testTag(route.screenTag())
                    .fillMaxSize()
                    .background(KmColors.bg)
                    .statusBarsPadding()
                    .navigationBarsPadding()
                val toChat = {
                    if (!navController.popBackStack(Route.Chat.path, inclusive = false)) {
                        navController.navigate(Route.Chat.path)
                    }
                }
                val back = { if (!navController.popBackStack()) navController.navigate(Route.Chat.path) }
                val container = (LocalContext.current.applicationContext as KocaMindApp).container
                when (route) {
                    // Giriş ekranı kabuktaki AuthGate'te; oturum açıkken buraya gelinmez.
                    Route.Auth -> Unit
                    Route.Chat -> ChatRoute(tagged) { navController.navigate(Route.OfflineModels.path) { launchSingleTop = true } }
                    Route.Settings -> SettingsScreen(
                        container = container,
                        onBack = { back() },
                        onAdmin = { navController.navigate(Route.Admin.path) },
                        onOfflineModels = { navController.navigate(Route.OfflineModels.path) },
                        onLibrary = { navController.navigate(Route.Library.path) },
                        onCustomInstructions = { navController.navigate(Route.CustomInstructions.path) },
                        onMemory = { navController.navigate(Route.Memory.path) },
                        onConnectors = { navController.navigate(Route.Connectors.path) },
                        onSkills = { navController.navigate(Route.Skills.path) },
                        // Çıkışta AuthGate giriş ekranını gösterir; tekrar girişte sohbetten başlansın.
                        onSignedOut = { navController.navigate(Route.Chat.path) { popUpTo(0) } },
                        modifier = tagged,
                    )
                    Route.CustomInstructions -> {
                        val email = container.authRepository.currentUser.collectAsStateWithLifecycle().value?.email
                        CustomInstructionsScreen(
                            initial = container.chatPrefs.customInstructions(email),
                            onSave = { container.chatPrefs.setCustomInstructions(email, it) },
                            onBack = { back() },
                            modifier = tagged,
                        )
                    }
                    Route.Connectors -> ConnectorsScreen(container, onBack = { back() }, modifier = tagged)
                    Route.Skills -> SkillsScreen(container.backendClient, onBack = { back() }, modifier = tagged)
                    Route.Memory -> MemoryScreen(container.memoryRepository, onBack = { back() }, modifier = tagged)
                    Route.Library -> LibraryScreen(container.libraryStore, onBack = { back() }, modifier = tagged)
                    Route.Admin -> AdminScreen(
                        api = container.adminApi,
                        onBack = { back() },
                        onOpenUser = { user -> navController.navigate(Route.adminUser(user.id, user.name.orEmpty())) },
                        modifier = tagged,
                    )
                    Route.AdminUser -> AdminUserScreen(
                        api = container.adminApi,
                        uid = it.arguments?.getString("uid").orEmpty(),
                        name = it.arguments?.getString("name").orEmpty(),
                        onBack = { back() },
                        modifier = tagged,
                    )
                    Route.OfflineModels -> OfflineModelsScreen(
                        service = container.offlineAi,
                        deviceProfile = {
                            androidDeviceProfile(container.appContextForProfile, java.io.File(container.appContextForProfile.filesDir, "offline-models"))
                        },
                        appScope = container.appScope,
                        onBack = { back() },
                        modifier = tagged,
                    )
                }
            }
        }
    }
}

@Composable
private fun ChatRoute(modifier: Modifier, onOpenOfflineModels: () -> Unit) {
    val container = (LocalContext.current.applicationContext as KocaMindApp).container
    val vm: ChatViewModel = viewModel(
        factory = viewModelFactory {
            initializer {
                ChatViewModel(
                    auth = container.authRepository,
                    backend = container.backendClient,
                    store = container.chatStore,
                    commands = container.chatCommands,
                    prefs = container.chatPrefs,
                    network = container.networkMonitor.isOnline,
                    queue = container.offlineQueue,
                    cloudSync = { uid -> container.syncedChatStore?.syncNow(uid) },
                    cloudWatch = { uid -> container.syncedChatStore?.watch(uid) },
                    media = container.mediaFiles,
                    localAi = container.localAi,
                    memory = container.memoryRepository,
                    saveScope = container.appScope,
                )
            }
        },
    )
    ChatScreen(
        vm = vm,
        mediaFiles = container.mediaFiles,
        onOpenOfflineModels = onOpenOfflineModels,
        history = container.chatHistory,
        onNewChat = { container.chatCommands.send(ChatCommand.NewChat) },
        appPrefs = container.appPrefs,
        modifier = modifier,
        shared = container.sharedContent,
    )
}

@Composable
internal fun AuthRoute(modifier: Modifier, onBack: (() -> Unit)?, onSignedIn: () -> Unit) {
    val context = LocalContext.current
    val container = (context.applicationContext as KocaMindApp).container
    val vm: AuthViewModel = viewModel(factory = authViewModelFactory(container.authRepository))
    val isLoading by vm.isLoading.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var googleLoading by remember { mutableStateOf(false) }

    AuthScreen(
        viewModel = vm,
        onSignedIn = onSignedIn,
        onBack = onBack,
        modifier = modifier,
        googleButton = {
            GoogleButton(
                loading = googleLoading || isLoading,
                enabled = !isLoading,
                onClick = {
                    val activity = context.findActivity() ?: return@GoogleButton
                    scope.launch {
                        googleLoading = true
                        try {
                            vm.onGoogleResult(container.googleSignInClient.requestIdToken(activity))
                        } finally {
                            googleLoading = false
                        }
                    }
                },
            )
        },
    )
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
