package com.tyler.kocamind.ui.settings

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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.tyler.kocamind.data.admin.AdminApi
import com.tyler.kocamind.data.admin.AdminChat
import com.tyler.kocamind.data.admin.AdminUserRow
import com.tyler.kocamind.data.admin.adminVisibleUsers
import com.tyler.kocamind.data.sync.toMillis
import com.tyler.kocamind.ui.components.KmIcon
import com.tyler.kocamind.ui.components.KmSkeleton
import com.tyler.kocamind.ui.components.pressableScale
import com.tyler.kocamind.ui.components.rememberReduceMotion
import com.tyler.kocamind.ui.icons.KmIcons
import com.tyler.kocamind.ui.theme.KmColors
import com.tyler.kocamind.ui.theme.KmMotion
import com.tyler.kocamind.ui.theme.KmRadius
import com.tyler.kocamind.ui.theme.KmSpace
import com.tyler.kocamind.ui.theme.KmType
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val trDateTime = DateTimeFormatter.ofPattern("dd.MM.yyyy HH:mm:ss", Locale.forLanguageTag("tr")).withZone(ZoneId.systemDefault())

private fun formatTr(millis: Long): String = if (millis > 0) trDateTime.format(Instant.ofEpochMilli(millis)) else "-"

@Composable
private fun FadeInItem(index: Int, enabled: Boolean, content: @Composable () -> Unit) {
    val reduce = rememberReduceMotion()
    val alpha = remember { Animatable(if (reduce || !enabled) 1f else 0f) }
    LaunchedEffect(Unit) { alpha.animateTo(1f, tween(KmMotion.BASE, delayMillis = minOf(index * 30, 300))) }
    Box(Modifier.graphicsLayer { this.alpha = alpha.value }) { content() }
}

@Composable
private fun cardModifier() = Modifier
    .fillMaxWidth()
    .clip(RoundedCornerShape(KmRadius.lg))
    .background(KmColors.surface)
    .border(1.dp, KmColors.border, RoundedCornerShape(KmRadius.lg))

@Composable
private fun NotFoundCard(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String, text: String) {
    Column(
        cardModifier().padding(KmSpace.xxl).padding(top = 0.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        KmIcon(icon, KmColors.textMuted, 48.dp, Modifier.padding(bottom = KmSpace.lg))
        Text(title, style = KmType.headline, color = KmColors.text, modifier = Modifier.padding(bottom = KmSpace.sm))
        Text(text, style = KmType.subhead, color = KmColors.textMuted, textAlign = TextAlign.Center)
    }
}

/** admin.tsx: kayıtlı kullanıcılar, arama, çekip yenileme. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdminScreen(api: AdminApi?, onBack: () -> Unit, onOpenUser: (AdminUserRow) -> Unit, modifier: Modifier = Modifier) {
    var users by remember { mutableStateOf<List<AdminUserRow>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var refreshing by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var firstLoad by remember { mutableStateOf(true) }
    val scope = rememberCoroutineScope()

    suspend fun fetch() {
        try {
            users = api?.users().orEmpty()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // Eski uygulama da hatayı yalnızca günlüğe yazıyordu; liste boş kalır.
        } finally {
            loading = false
            refreshing = false
        }
    }
    LaunchedEffect(Unit) { fetch() }
    LaunchedEffect(loading) { if (!loading) firstLoad = false }
    val visible = adminVisibleUsers(users, query)

    Column(modifier) {
        BackTitleHeader("Admin Paneli", onBack)
        Column(
            Modifier.widthIn(max = 920.dp).fillMaxWidth().align(Alignment.CenterHorizontally).padding(horizontal = KmSpace.lg).padding(top = KmSpace.lg),
        ) {
            Column(cardModifier().padding(KmSpace.lg)) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = KmSpace.sm)) {
                    KmIcon(KmIcons.Database, KmColors.brand, 28.dp)
                    Spacer(Modifier.width(KmSpace.md))
                    Text("Kullanıcı Veritabanı", style = KmType.title, color = KmColors.text)
                }
                Text(
                    "Sisteme kayıtlı tüm kullanıcılar burada listelenir.",
                    style = KmType.subhead,
                    color = KmColors.textMuted,
                    modifier = Modifier.padding(bottom = KmSpace.lg),
                )
                Text(
                    "Toplam: ${users.size} Kullanıcı",
                    style = KmType.caption,
                    color = KmColors.brand,
                    modifier = Modifier.clip(RoundedCornerShape(KmRadius.pill)).background(KmColors.brandMuted).padding(horizontal = KmSpace.md, vertical = 6.dp),
                )
            }
            Spacer(Modifier.height(KmSpace.lg))
            val searchShape = RoundedCornerShape(KmRadius.md)
            Row(
                Modifier.fillMaxWidth().clip(searchShape).background(KmColors.surface).border(1.dp, KmColors.border, searchShape).padding(KmSpace.xs),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                KmIcon(KmIcons.Search, KmColors.textMuted, 20.dp, Modifier.padding(start = KmSpace.md, end = KmSpace.sm))
                BasicTextField(
                    value = query,
                    onValueChange = { query = it },
                    singleLine = true,
                    textStyle = KmType.body.copy(color = KmColors.text),
                    cursorBrush = SolidColor(KmColors.brand),
                    modifier = Modifier.weight(1f).height(44.dp).padding(top = 10.dp),
                    decorationBox = { inner ->
                        if (query.isEmpty()) Text("İsim, e-posta veya ID ara...", style = KmType.body, color = KmColors.textMuted)
                        inner()
                    },
                )
            }
            Spacer(Modifier.height(KmSpace.lg))
            if (loading) {
                Column(verticalArrangement = Arrangement.spacedBy(KmSpace.md)) {
                    repeat(4) { KmSkeleton(Modifier.fillMaxWidth(), height = 112.dp, radius = KmRadius.lg) }
                }
            } else {
                PullToRefreshBox(
                    isRefreshing = refreshing,
                    onRefresh = { refreshing = true; scope.launch { fetch() } },
                    modifier = Modifier.fillMaxSize(),
                ) {
                    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 40.dp)) {
                        itemsIndexed(visible, key = { _, u -> u.id }) { index, user ->
                            FadeInItem(index, enabled = firstLoad) {
                                UserCard(user) { onOpenUser(user) }
                            }
                        }
                        if (visible.isEmpty()) {
                            item {
                                Spacer(Modifier.height(KmSpace.xl))
                                NotFoundCard(KmIcons.SearchX, "Sonuç bulunamadı", "Aramanıza uyan bir kullanıcı veritabanında yok.")
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun UserCard(user: AdminUserRow, onClick: () -> Unit) {
    Column(
        Modifier
            .padding(bottom = KmSpace.md)
            .pressableScale(onClick = onClick, pressedOpacity = 0.9f)
            .then(cardModifier())
            .padding(KmSpace.lg),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = KmSpace.md)) {
            Box(Modifier.size(44.dp).clip(CircleShape).background(KmColors.brandMuted), contentAlignment = Alignment.Center) {
                KmIcon(KmIcons.User, KmColors.brand, 24.dp)
            }
            Spacer(Modifier.width(KmSpace.md))
            Column(Modifier.weight(1f)) {
                Text(user.name ?: "İsimsiz Kullanıcı", style = KmType.headline, color = KmColors.text, modifier = Modifier.padding(bottom = KmSpace.xs))
                Text("ID: ${user.id}", style = KmType.caption, color = KmColors.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        Box(Modifier.fillMaxWidth().height(0.5.dp).background(KmColors.border))
        Spacer(Modifier.height(KmSpace.md))
        user.email?.let { InfoRow(KmIcons.Mail, it) }
        user.phone?.let { InfoRow(KmIcons.Phone, it) }
        user.lastLogin?.let { InfoRow(KmIcons.Calendar, "Son Giriş: ${formatTr(toMillis(it))}") }
    }
}

@Composable
private fun InfoRow(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = KmSpace.sm)) {
        KmIcon(icon, KmColors.textMuted, 16.dp)
        Spacer(Modifier.width(10.dp))
        Text(text, style = KmType.subhead, color = KmColors.textSecondary)
    }
}

/** admin-user.tsx: kullanıcının buluttaki sohbetleri. */
@Composable
fun AdminUserScreen(api: AdminApi?, uid: String, name: String, onBack: () -> Unit, modifier: Modifier = Modifier) {
    var chats by remember { mutableStateOf<List<AdminChat>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var expanded by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(uid) {
        try {
            chats = api?.chats(uid).orEmpty()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // Liste boş kalır.
        } finally {
            loading = false
        }
    }

    Column(modifier) {
        BackTitleHeader("${name.ifBlank { "Kullanıcı" }} Sohbetleri", onBack)
        Column(
            Modifier.widthIn(max = 920.dp).fillMaxWidth().align(Alignment.CenterHorizontally).padding(horizontal = KmSpace.lg).padding(top = KmSpace.lg),
        ) {
            Column(cardModifier().padding(KmSpace.lg), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("${chats.size} Adet Sohbet", style = KmType.title, color = KmColors.text, modifier = Modifier.padding(bottom = KmSpace.sm))
                Text(
                    "Kullanıcının bugüne kadar yapay zekayla yaptığı tüm sohbet geçmişi. Okumak için sohbetin üstüne tıklayın.",
                    style = KmType.subhead,
                    color = KmColors.textMuted,
                    textAlign = TextAlign.Center,
                )
            }
            Spacer(Modifier.height(KmSpace.lg))
            if (loading) {
                Column(verticalArrangement = Arrangement.spacedBy(KmSpace.md)) {
                    repeat(3) { KmSkeleton(Modifier.fillMaxWidth(), height = 72.dp, radius = KmRadius.lg) }
                }
            } else {
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 40.dp)) {
                    itemsIndexed(chats, key = { _, c -> c.id }) { _, chat ->
                        ChatCard(chat, expanded == chat.id) { expanded = if (expanded == chat.id) null else chat.id }
                    }
                    if (chats.isEmpty()) {
                        item {
                            Spacer(Modifier.height(KmSpace.xl))
                            NotFoundCard(KmIcons.MessageSquareOff, "Sohbet yok", "Bu kullanıcı henüz yapay zekaya hiçbir şey sormamış.")
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ChatCard(chat: AdminChat, isExpanded: Boolean, onToggle: () -> Unit) {
    Column(Modifier.padding(bottom = KmSpace.md).then(cardModifier())) {
        Row(
            Modifier
                .fillMaxWidth()
                .pressableScale(onClick = onToggle, pressedOpacity = 0.9f)
                .background(KmColors.surfaceElevated)
                .padding(KmSpace.lg),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = KmSpace.xs)) {
                    KmIcon(KmIcons.MessageSquare, KmColors.brand, 18.dp)
                    Spacer(Modifier.width(KmSpace.sm))
                    Text(chat.title.ifBlank { "Yeni Sohbet" }, style = KmType.headline, color = KmColors.text)
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    KmIcon(KmIcons.Clock, KmColors.textMuted, 14.dp)
                    Spacer(Modifier.width(KmSpace.xs))
                    Text(formatTr(chat.updatedAt), style = KmType.caption, color = KmColors.textMuted)
                }
            }
            KmIcon(if (isExpanded) KmIcons.ChevronUp else KmIcons.ChevronDown, KmColors.textMuted, 20.dp, Modifier.padding(start = KmSpace.md))
        }
        if (isExpanded) {
            Column(Modifier.background(KmColors.surface).padding(KmSpace.lg)) {
                if (chat.messages.isEmpty()) {
                    Text(
                        "Bu sohbette henüz mesaj yok.",
                        style = KmType.subhead.copy(fontStyle = FontStyle.Italic),
                        color = KmColors.textMuted,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                chat.messages.forEach { message ->
                    val isUser = message.role == "user"
                    Column(
                        Modifier
                            .padding(bottom = KmSpace.md)
                            .padding(start = if (isUser) 20.dp else 0.dp, end = if (isUser) 0.dp else 20.dp)
                            .fillMaxWidth()
                            .clip(
                                if (isUser) {
                                    RoundedCornerShape(topStart = KmRadius.md, topEnd = KmRadius.sm, bottomStart = KmRadius.md, bottomEnd = KmRadius.md)
                                } else {
                                    RoundedCornerShape(topStart = KmRadius.sm, topEnd = KmRadius.md, bottomStart = KmRadius.md, bottomEnd = KmRadius.md)
                                },
                            )
                            .background(if (isUser) KmColors.brandMuted else KmColors.successMuted)
                            .padding(KmSpace.md),
                    ) {
                        Text(
                            if (isUser) "Kullanıcı:" else "Yapay Zeka:",
                            style = KmType.caption.copy(fontWeight = FontWeight.Bold),
                            color = if (isUser) KmColors.brand else KmColors.success,
                            modifier = Modifier.padding(bottom = KmSpace.xs),
                        )
                        Text(message.content, style = KmType.subhead.copy(fontWeight = FontWeight.Normal), color = KmColors.text)
                    }
                }
            }
        }
    }
}
