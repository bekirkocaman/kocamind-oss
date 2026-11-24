package com.tyler.kocamind.ui.nav

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.tyler.kocamind.KocaMindApp
import com.tyler.kocamind.data.chat.ChatCommand
import com.tyler.kocamind.ui.auth.PendingDeletionScreen
import com.tyler.kocamind.ui.drawer.AppDrawer
import com.tyler.kocamind.ui.drawer.DrawerUser
import com.tyler.kocamind.ui.drawer.drawerDisplayName
import com.tyler.kocamind.ui.theme.KmColors
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import com.tyler.kocamind.ui.components.rememberReduceMotion
import com.tyler.kocamind.ui.theme.KmMotion
import kotlin.math.roundToInt

/** Ekranların drawer'ı açması için (eski `navigation.openDrawer()`). */
class DrawerController(val open: () -> Unit, val close: () -> Unit)

val LocalDrawer = staticCompositionLocalOf { DrawerController({}, {}) }

/** Uygulamanın kabuğu: giriş yoksa yalnızca giriş ekranı, varsa menü + ekranlar. */
@Composable
fun KocaMindAppShell() {
    val container = (LocalContext.current.applicationContext as KocaMindApp).container
    val user by container.authRepository.currentUser.collectAsStateWithLifecycle()
    AuthGate(
        user = user,
        auth = {
            AuthRoute(
                Modifier
                    .testTag(Route.Auth.screenTag())
                    .fillMaxSize()
                    .background(KmColors.bg)
                    .statusBarsPadding()
                    .navigationBarsPadding(),
                onBack = null,
                onSignedIn = {},
            )
        },
    ) { DeletionGate { SignedInShell() } }
}

/**
 * Silinmeyi bekleyen hesap (`deletionPending` claim'i) uygulamayı açamaz; yalnızca
 * geri alma ekranını görür. Claim token'dan okunur, ağ gerektirmez.
 */
@Composable
private fun DeletionGate(content: @Composable () -> Unit) {
    val container = (LocalContext.current.applicationContext as KocaMindApp).container
    val user by container.authRepository.currentUser.collectAsStateWithLifecycle()
    var pending by remember(user?.uid) { mutableStateOf<Boolean?>(null) }
    LaunchedEffect(user?.uid) {
        pending = try { container.authRepository.isDeletionPending() } catch (e: CancellationException) { throw e } catch (e: Exception) { false }
    }
    val screen = Modifier.fillMaxSize().background(KmColors.bg).statusBarsPadding().navigationBarsPadding()
    when (pending) {
        null -> Box(screen)
        true -> PendingDeletionScreen(
            email = user?.email,
            loadPurgeAfter = { container.backendClient.deletionPurgeAfter() },
            onRestore = {
                container.backendClient.restoreAccount()
                container.authRepository.refreshToken()
                pending = false
            },
            onDeleteNow = {
                container.backendClient.deleteAccountNow()
                container.authRepository.signOut()
            },
            onSignOut = { container.authRepository.signOut() },
            modifier = screen.testTag("screen-pending-deletion"),
        )
        false -> content()
    }
}

/** Drawer + NavHost: giriş yapılmış uygulama. Ekranlar başlıklarını kendileri çizer. */
@Composable
internal fun SignedInShell(navController: NavHostController = rememberNavController()) {
    val container = (LocalContext.current.applicationContext as KocaMindApp).container
    var drawerOpen by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val backStack by navController.currentBackStackEntryAsState()
    val currentPath = backStack?.destination?.route

    val authUser by container.authRepository.currentUser.collectAsStateWithLifecycle()
    val chats by container.chatHistory.chats.collectAsStateWithLifecycle()
    val signedIn = authUser?.takeIf { it.emailVerified }
    var isAdmin by remember { mutableStateOf(false) }
    var plan by remember { mutableStateOf("free") }
    LaunchedEffect(signedIn?.uid) {
        if (signedIn == null) {
            isAdmin = false
            plan = "free"
            return@LaunchedEffect
        }
        isAdmin = try { container.authRepository.isAdmin() } catch (e: CancellationException) { throw e } catch (e: Exception) { false }
        plan = try { container.backendClient.getBillingPlan() } catch (e: CancellationException) { throw e } catch (e: Exception) { "free" }
    }

    val focusManager = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    fun go(route: Route) {
        drawerOpen = false
        if (route.path != currentPath) {
            navController.navigate(route.path) {
                popUpTo(Route.Chat.path)
                launchSingleTop = true
            }
        }
    }

    val controller = remember {
        DrawerController(
            open = {
                // Menü açılırken yazı alanı odağını bırakır, klavye kapanır.
                focusManager.clearFocus(force = true)
                keyboard?.hide()
                drawerOpen = true
            },
            close = { drawerOpen = false },
        )
    }

    val activeChatId by container.chatCommands.openChatId.collectAsStateWithLifecycle()
    BackHandler(enabled = drawerOpen) { drawerOpen = false }
    Box(Modifier.fillMaxSize().background(KmColors.bg)) {
        CompositionLocalProvider(LocalDrawer provides controller) {
            KocaMindNavHost(navController)
        }
        SideDrawer(open = drawerOpen, onClose = { drawerOpen = false }) {
            AppDrawer(
                user = signedIn?.let { DrawerUser(drawerDisplayName(it.displayName, it.email), it.email, it.photoUrl) },
                isAdmin = isAdmin,
                plan = plan,
                chats = chats,
                onClose = { drawerOpen = false },
                onNewChat = {
                    container.chatCommands.send(ChatCommand.NewChat)
                    go(Route.Chat)
                },
                onOpenChat = { id ->
                    container.chatCommands.send(ChatCommand.LoadChat(id))
                    go(Route.Chat)
                },
                onLibrary = { go(Route.Library) },
                onAdmin = { go(Route.Admin) },
                onProfile = { go(Route.Settings) },
                onSettings = { go(Route.Settings) },
                onTogglePin = { id -> scope.launch { container.chatHistory.togglePin(id) } },
                onRename = { id, title -> scope.launch { container.chatHistory.rename(id, title) } },
                onDelete = { id -> scope.launch { container.chatHistory.delete(id) } },
                activeChatId = activeChatId,
                isOpen = drawerOpen,
                onMemory = { go(Route.Memory) },
                onConnectors = { go(Route.Connectors) },
                onOfflineModels = { go(Route.OfflineModels) },
            )
        }
    }
}

/**
 * Klon tasarımının çekmecesi: ekranın %94'ü kadar soldan kayar, arkası kararır; karartıya
 * dokununca ya da sola sürükleyince kapanır.
 */
@Composable
private fun SideDrawer(open: Boolean, onClose: () -> Unit, content: @Composable () -> Unit) {
    val reduce = rememberReduceMotion()
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val widthPx = constraints.maxWidth * 0.94f
        var drag by remember { mutableFloatStateOf(0f) }
        val progress by animateFloatAsState(
            targetValue = if (open) 1f else 0f,
            animationSpec = tween(if (reduce) 0 else if (open) 260 else 200, easing = KmMotion.standard),
            label = "drawer",
        )
        LaunchedEffect(open) { drag = 0f }
        if (progress == 0f && !open) return@BoxWithConstraints
        val offset = -widthPx * (1f - progress) + drag
        val visible = ((widthPx + offset) / widthPx).coerceIn(0f, 1f)
        Box(
            Modifier
                .fillMaxSize()
                .graphicsLayer { alpha = visible }
                .background(KmColors.overlay)
                .pointerInput(Unit) { detectTapGestures { onClose() } },
        )
        Box(
            Modifier
                .fillMaxHeight()
                .width(with(LocalDensity.current) { widthPx.toDp() })
                .offset { IntOffset(offset.roundToInt(), 0) }
                .pointerInput(Unit) {
                    detectHorizontalDragGestures(
                        onDragEnd = { if (drag < -widthPx * 0.3f) onClose() else drag = 0f },
                        onDragCancel = { drag = 0f },
                    ) { _, dx -> drag = (drag + dx).coerceIn(-widthPx, 0f) }
                },
        ) { content() }
    }
}
