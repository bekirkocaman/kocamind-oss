package com.tyler.kocamind.ui.drawer

import android.net.Uri
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.sp
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.layout.heightIn
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.min
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import coil.compose.AsyncImage
import com.tyler.kocamind.data.chat.ChatSummary
import com.tyler.kocamind.ui.components.KmMark
import com.tyler.kocamind.ui.components.MarkState
import com.tyler.kocamind.ui.components.KmButton
import com.tyler.kocamind.ui.components.KmDivider
import com.tyler.kocamind.ui.components.KmIcon
import com.tyler.kocamind.ui.components.KmSkeleton
import com.tyler.kocamind.ui.components.pressableScale
import com.tyler.kocamind.ui.components.pressableScaleWithPosition
import com.tyler.kocamind.ui.components.rememberReduceMotion
import com.tyler.kocamind.ui.icons.KmIcons
import com.tyler.kocamind.ui.theme.KmColors
import com.tyler.kocamind.ui.theme.KmElevation
import com.tyler.kocamind.ui.theme.KmMotion
import com.tyler.kocamind.ui.theme.KmRadius
import com.tyler.kocamind.ui.theme.KmSpace
import com.tyler.kocamind.ui.theme.KmType
import kotlinx.coroutines.launch
import java.util.Locale
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.ui.text.TextStyle
import com.tyler.kocamind.ui.components.KmIconButton
import com.tyler.kocamind.ui.theme.KmReplyFont

/** Drawer'ın gösterdiği kullanıcı bilgisi. null = misafir. */
data class DrawerUser(val name: String, val email: String?, val photoUrl: String?)

/**
 * Klon tasarımındaki menü: üstte serif başlık ve arama, altında bölümler, "Son kullanılanlar",
 * en altta profil yuvarlağı ve "Yeni sohbet" hapı. Bölümler KocaMind'in gerçek sayfalarıdır;
 * null verilen bölüm gösterilmez.
 */
@Composable
fun AppDrawer(
    user: DrawerUser?,
    isAdmin: Boolean,
    plan: String,
    chats: List<ChatSummary>?,
    onClose: () -> Unit,
    onNewChat: () -> Unit,
    onOpenChat: (String) -> Unit,
    onLibrary: () -> Unit,
    onAdmin: () -> Unit,
    onProfile: () -> Unit,
    onSettings: () -> Unit,
    onTogglePin: (String) -> Unit,
    onRename: (String, String) -> Unit,
    onDelete: (String) -> Unit,
    modifier: Modifier = Modifier,
    activeChatId: String? = null,
    isOpen: Boolean = true,
    onMemory: (() -> Unit)? = null,
    onConnectors: (() -> Unit)? = null,
    onOfflineModels: (() -> Unit)? = null,
) {
    var searching by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var menu by remember { mutableStateOf<Pair<ChatSummary, Offset>?>(null) }
    var renaming by remember { mutableStateOf<ChatSummary?>(null) }
    LaunchedEffect(isOpen) { if (!isOpen) { searching = false; query = "" } }
    val visibleChats = chats?.let { drawerChats(it, query) }

    val sections = buildList {
        add(Triple("Kitaplık", KmIcons.LayoutGrid, onLibrary))
        onMemory?.let { add(Triple("Hafıza", KmIcons.Notebook, it)) }
        onConnectors?.let { add(Triple("Bağlantılar", KmIcons.Globe2, it)) }
        onOfflineModels?.let { add(Triple("Yerel modeller", KmIcons.Smartphone, it)) }
        if (isAdmin) add(Triple("Admin paneli", KmIcons.ShieldCheck, onAdmin))
    }

    Box(modifier.fillMaxSize().background(KmColors.surfaceSunken).statusBarsPadding()) {
        Column(Modifier.fillMaxSize()) {
            Row(
                Modifier.fillMaxWidth().height(67.dp).padding(start = 20.dp, end = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (searching) {
                    KmIconButton(
                        onClick = { searching = false; query = "" },
                        contentDescription = "Aramayı kapat",
                        background = Color.Transparent,
                        modifier = Modifier.offset(x = (-8).dp),
                    ) { KmIcon(KmIcons.ArrowLeft, KmColors.text, 22.dp) }
                    SearchField(query, Modifier.weight(1f)) { query = it }
                } else {
                    Text(
                        "KocaMind",
                        style = TextStyle(fontFamily = KmReplyFont, fontSize = 32.sp, lineHeight = 38.sp),
                        color = KmColors.text,
                        modifier = Modifier.weight(1f),
                    )
                    KmIconButton(onClick = { searching = true }, contentDescription = "Ara", background = Color.Transparent) {
                        KmIcon(KmIcons.Search, KmColors.text, 24.dp)
                    }
                }
            }
            LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(bottom = 100.dp)) {
                if (!searching) {
                    items(sections, key = { it.first }) { (label, icon, onClick) ->
                        Row(
                            Modifier
                                .padding(horizontal = 8.dp)
                                .fillMaxWidth()
                                .height(57.dp)
                                .clip(RoundedCornerShape(13.dp))
                                .pressableScale(onClick = onClick, pressedOpacity = 0.6f)
                                .padding(horizontal = 18.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            KmIcon(icon, KmColors.text, 22.dp)
                            Spacer(Modifier.width(18.dp))
                            Text(label, style = KmType.body.copy(fontSize = 16.sp), color = KmColors.textSecondary)
                        }
                    }
                    item(key = "recent-title") {
                        KmDivider(Modifier.padding(horizontal = 17.dp, vertical = 12.dp))
                        Text(
                            "Son kullanılanlar",
                            style = KmType.body.copy(fontSize = 15.sp),
                            color = KmColors.textSecondary,
                            modifier = Modifier.padding(horizontal = 25.dp, vertical = 5.dp),
                        )
                    }
                }
                when {
                    visibleChats == null -> item(key = "skeleton") {
                        Column(Modifier.padding(horizontal = 25.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(KmSpace.md)) {
                            repeat(6) { KmSkeleton(Modifier.fillMaxWidth(), height = 22.dp, radius = KmRadius.sm) }
                        }
                    }
                    visibleChats.isEmpty() && query.isNotBlank() -> item(key = "no-results") {
                        Column(
                            Modifier.fillMaxWidth().padding(horizontal = 25.dp, vertical = KmSpace.lg),
                            verticalArrangement = Arrangement.spacedBy(KmSpace.xs),
                        ) {
                            Text("“${query.trim()}” için sohbet bulunamadı", style = KmType.subhead, color = KmColors.textSecondary)
                            Text("Başka bir kelimeyle dene.", style = KmType.footnote, color = KmColors.textMuted)
                        }
                    }
                    visibleChats.isEmpty() -> item(key = "empty") {
                        Text("Henüz sohbet yok", style = KmType.body, color = KmColors.textMuted, modifier = Modifier.padding(horizontal = 25.dp, vertical = 10.dp))
                    }
                }
                items(visibleChats.orEmpty(), key = { it.id }) { chat ->
                    val active = chat.id == activeChatId
                    Row(
                        Modifier
                            .animateItem(
                                fadeInSpec = tween(KmMotion.BASE, easing = KmMotion.standard),
                                placementSpec = tween(KmMotion.BASE, easing = KmMotion.standard),
                                fadeOutSpec = tween(KmMotion.FAST),
                            )
                            .padding(horizontal = 8.dp)
                            .fillMaxWidth()
                            .height(51.dp)
                            .clip(RoundedCornerShape(13.dp))
                            .background(if (active) KmColors.surface else Color.Transparent)
                            .pressableScaleWithPosition(
                                onClick = { onOpenChat(chat.id) },
                                onLongPress = { menu = chat to it },
                                pressedOpacity = 0.6f,
                            )
                            .padding(horizontal = 19.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        KmIcon(if (chat.isPinned) KmIcons.Pin else KmIcons.MessageCircle, KmColors.textSecondary, 17.dp)
                        Spacer(Modifier.width(17.dp))
                        Text(
                            chat.title,
                            style = KmType.body.copy(fontSize = 15.sp, fontWeight = if (active) FontWeight.Medium else FontWeight.Normal),
                            color = KmColors.text,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        }
        BottomBar(user, plan, onProfile, onNewChat, Modifier.align(Alignment.BottomCenter))
    }

    menu?.let { (chat, at) ->
        ChatContextMenu(
            chat = chat,
            at = at,
            onDismiss = { menu = null },
            onTogglePin = { menu = null; onTogglePin(chat.id) },
            onRename = { menu = null; renaming = chat },
            onDelete = { menu = null; onDelete(chat.id) },
        )
    }
    renaming?.let { chat ->
        RenameDialog(
            initial = chat.title,
            onCancel = { renaming = null },
            onSave = { title ->
                renaming = null
                if (title.isNotBlank()) onRename(chat.id, title.trim())
            },
        )
    }
}

@Composable
private fun SearchField(value: String, modifier: Modifier, onChange: (String) -> Unit) {
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        BasicTextField(
            value = value,
            onValueChange = onChange,
            singleLine = true,
            textStyle = KmType.body.copy(fontSize = 16.sp, color = KmColors.text),
            cursorBrush = SolidColor(KmColors.brand),
            modifier = Modifier
                .weight(1f)
                .focusRequester(focus)
                .semantics { contentDescription = "Sohbetlerde ara" },
            decorationBox = { inner ->
                if (value.isEmpty()) Text("Sohbetlerde ara", style = KmType.body.copy(fontSize = 16.sp), color = KmColors.textMuted)
                inner()
            },
        )
        if (value.isNotEmpty()) {
            KmIconButton(onClick = { onChange("") }, contentDescription = "Aramayı temizle", background = Color.Transparent) {
                KmIcon(KmIcons.X, KmColors.textMuted, 18.dp)
            }
        }
    }
}

/** Alt şerit: solda profil yuvarlağı (Ayarlar), sağda "Yeni sohbet" hapı. */
@Composable
private fun BottomBar(user: DrawerUser?, plan: String, onProfile: () -> Unit, onNewChat: () -> Unit, modifier: Modifier) {
    Row(
        modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .padding(horizontal = 17.dp, vertical = 17.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Box(
            Modifier
                .size(50.dp)
                .clip(CircleShape)
                .pressableScale(onClick = onProfile, onClickLabel = "Ayarlar")
                .semantics { contentDescription = "Ayarlar" },
        ) {
            Avatar(user)
            if (plan == "pro") {
                Text(
                    "PRO",
                    style = KmType.caption.copy(fontSize = 9.sp, fontWeight = FontWeight.SemiBold),
                    color = KmColors.textOnBrand,
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .clip(RoundedCornerShape(KmRadius.pill))
                        .background(KmColors.brand)
                        .padding(horizontal = 5.dp),
                )
            }
        }
        Row(
            Modifier
                .height(47.dp)
                .clip(CircleShape)
                .background(KmColors.text)
                .pressableScale(onClick = onNewChat, onClickLabel = "Yeni sohbet")
                .padding(horizontal = 22.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            KmIcon(KmIcons.Plus, KmColors.bg, 18.dp)
            Spacer(Modifier.width(8.dp))
            Text("Yeni sohbet", style = KmType.body.copy(fontSize = 15.sp, fontWeight = FontWeight.Medium), color = KmColors.bg)
        }
    }
}

@Composable
private fun Avatar(user: DrawerUser?) {
    val photo = user?.photoUrl
    if (photo != null) {
        AsyncImage(
            model = photo,
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize().clip(CircleShape).background(KmColors.surfaceElevated),
        )
        return
    }
    Box(Modifier.fillMaxSize().clip(CircleShape).background(Color(0xFF8B7CF0)), contentAlignment = Alignment.Center) {
        val initial = user?.name?.trim()?.firstOrNull()?.toString()?.uppercase(Locale.forLanguageTag("tr"))
        if (initial != null) {
            Text(initial, style = KmType.body.copy(fontSize = 17.sp, fontWeight = FontWeight.SemiBold), color = Color.White)
        } else {
            KmIcon(KmIcons.User, Color.White, 22.dp)
        }
    }
}

@Composable
private fun ChatContextMenu(
    chat: ChatSummary,
    at: Offset,
    onDismiss: () -> Unit,
    onTogglePin: () -> Unit,
    onRename: () -> Unit,
    onDelete: () -> Unit,
) {
    val density = LocalDensity.current
    val config = LocalConfiguration.current
    val menuW = with(density) { 172.dp.roundToPx() }
    val menuH = with(density) { 150.dp.roundToPx() }
    val edge = with(density) { KmSpace.sm.roundToPx() }
    val screenW = with(density) { config.screenWidthDp.dp.roundToPx() }
    val screenH = with(density) { config.screenHeightDp.dp.roundToPx() }
    val x = at.x.toInt().coerceIn(edge, (screenW - menuW - edge).coerceAtLeast(edge))
    val y = at.y.toInt().coerceIn(edge, (screenH - menuH - edge).coerceAtLeast(edge))

    val reduce = rememberReduceMotion()
    val scale = remember { Animatable(if (reduce) 1f else 0.96f) }
    val alpha = remember { Animatable(if (reduce) 1f else 0f) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        scope.launch { scale.animateTo(1f, tween(KmMotion.FAST, easing = KmMotion.decelerate)) }
        alpha.animateTo(1f, tween(KmMotion.FAST, easing = KmMotion.decelerate))
    }

    Popup(offset = IntOffset(x, y), onDismissRequest = onDismiss, properties = PopupProperties(focusable = true)) {
        val shape = RoundedCornerShape(KmRadius.lg)
        Column(
            Modifier
                .graphicsLayer {
                    scaleX = scale.value
                    scaleY = scale.value
                    this.alpha = alpha.value
                    shadowElevation = KmElevation.lg.toPx()
                    this.shape = shape
                    clip = true
                }
                .width(172.dp)
                .background(KmColors.surfaceElevated)
                .border(1.dp, KmColors.border, shape)
                .padding(KmSpace.xs),
        ) {
            ContextItem(KmIcons.Pin, if (chat.isPinned) "Sabitlemeyi Kaldır" else "Sabitle", KmColors.text, onTogglePin)
            KmDivider(Modifier.padding(horizontal = KmSpace.sm))
            ContextItem(KmIcons.Edit2, "Yeniden Adlandır", KmColors.text, onRename)
            KmDivider(Modifier.padding(horizontal = KmSpace.sm))
            ContextItem(KmIcons.Trash2, "Sil", KmColors.danger, onDelete)
        }
    }
}

@Composable
private fun ContextItem(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    text: String,
    color: androidx.compose.ui.graphics.Color,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .pressableScale(onClick = onClick, pressedOpacity = 0.6f)
            .clip(RoundedCornerShape(KmRadius.md))
            .padding(KmSpace.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        KmIcon(icon, if (color == KmColors.danger) KmColors.danger else KmColors.text, 17.dp)
        Spacer(Modifier.width(KmSpace.md))
        Text(text, style = KmType.subhead, color = color)
    }
}

@Composable
private fun RenameDialog(initial: String, onCancel: () -> Unit, onSave: (String) -> Unit) {
    var text by remember { mutableStateOf(initial) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    val reduce = rememberReduceMotion()
    val scale = remember { Animatable(if (reduce) 1f else 0.96f) }
    LaunchedEffect(Unit) { scale.animateTo(1f, tween(KmMotion.FAST, easing = KmMotion.decelerate)) }

    Dialog(onDismissRequest = onCancel, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        val shape = RoundedCornerShape(KmRadius.lg)
        Column(
            Modifier
                .fillMaxWidth(0.82f)
                .graphicsLayer {
                    scaleX = scale.value
                    scaleY = scale.value
                    shadowElevation = KmElevation.lg.toPx()
                    this.shape = shape
                    clip = true
                }
                .background(KmColors.surfaceElevated)
                .border(1.dp, KmColors.border, shape)
                .padding(KmSpace.xl - KmSpace.xs),
        ) {
            Text("Sohbeti Yeniden Adlandır", style = KmType.headline, color = KmColors.text)
            Spacer(Modifier.height(KmSpace.lg))
            val fieldShape = RoundedCornerShape(KmRadius.md)
            BasicTextField(
                value = text,
                onValueChange = { text = it },
                singleLine = true,
                textStyle = KmType.body.copy(color = KmColors.text),
                cursorBrush = SolidColor(KmColors.brand),
                modifier = Modifier
                    .fillMaxWidth()
                    .focusRequester(focus)
                    .clip(fieldShape)
                    .background(KmColors.bg)
                    .border(1.dp, KmColors.borderStrong, fieldShape)
                    .padding(KmSpace.md + KmSpace.xxs),
                decorationBox = { inner ->
                    if (text.isEmpty()) Text("Yeni sohbet adı...", style = KmType.body, color = KmColors.textMuted)
                    inner()
                },
            )
            Spacer(Modifier.height(KmSpace.xl - KmSpace.xs))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "İptal",
                    style = KmType.body.copy(fontWeight = FontWeight.Medium),
                    color = KmColors.textSecondary,
                    modifier = Modifier
                        .pressableScale(onClick = onCancel, pressedOpacity = 0.6f)
                        .padding(vertical = KmSpace.md, horizontal = KmSpace.lg),
                )
                Spacer(Modifier.width(KmSpace.sm))
                KmButton(text = "Kaydet", onClick = { onSave(text) })
            }
        }
    }
}
