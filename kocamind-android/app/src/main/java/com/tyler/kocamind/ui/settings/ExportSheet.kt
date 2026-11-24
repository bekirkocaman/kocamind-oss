package com.tyler.kocamind.ui.settings

import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
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
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tyler.kocamind.data.chat.ChatStore
import com.tyler.kocamind.data.chat.StoredChat
import com.tyler.kocamind.ui.components.KmButton
import com.tyler.kocamind.ui.components.KmIcon
import com.tyler.kocamind.ui.components.KmMark
import com.tyler.kocamind.ui.components.KmSheet
import com.tyler.kocamind.ui.components.MarkState
import com.tyler.kocamind.ui.components.rememberReduceMotion
import com.tyler.kocamind.ui.icons.KmIcons
import com.tyler.kocamind.ui.theme.KmColors
import com.tyler.kocamind.ui.theme.KmMotion
import com.tyler.kocamind.ui.theme.KmType
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.ZonedDateTime

private enum class Scope { Open, All }

private sealed interface SaveState {
    data object Idle : SaveState
    data object Busy : SaveState
    data object Done : SaveState
}

/** Ayarlar > Sohbetleri Dışa Aktar: kapsam, biçim, canlı önizleme; dosya "dosya oluştur" penceresiyle kaydedilir. */
@Composable
fun ExportSheet(visible: Boolean, store: ChatStore, openChatId: String?, onClose: () -> Unit) {
    KmSheet(visible = visible, onClose = onClose, title = "Sohbetleri dışa aktar") {
        val context = LocalContext.current
        val scope = rememberCoroutineScope()
        var openChat by remember { mutableStateOf<StoredChat?>(null) }
        var all by remember { mutableStateOf<List<StoredChat>?>(null) }
        LaunchedEffect(openChatId) {
            all = store.all().filter { exportMessageCount(listOf(it)) > 0 }
            openChat = openChatId?.let { id -> all?.firstOrNull { it.id == id } }
        }
        var chosenScope by remember { mutableStateOf<Scope?>(null) }
        val effectiveScope = chosenScope ?: if (openChat != null) Scope.Open else Scope.All
        var format by remember { mutableStateOf(ExportFormat.Html) }
        var save by remember { mutableStateOf<SaveState>(SaveState.Idle) }
        val chats = when (effectiveScope) {
            Scope.Open -> listOfNotNull(openChat)
            Scope.All -> all.orEmpty()
        }
        val count = exportMessageCount(chats)

        val launcher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument(format.mime)) { uri: Uri? ->
            if (uri == null) {
                save = SaveState.Idle
                return@rememberLauncherForActivityResult
            }
            val picked = format
            scope.launch {
                try {
                    val text = buildExport(picked, chats, ZonedDateTime.now())
                    withContext(Dispatchers.IO) {
                        context.contentResolver.openOutputStream(uri)?.use { it.write(text.toByteArray()) }
                            ?: error("Dosya açılamadı")
                    }
                    save = SaveState.Done
                    delay(700)
                    onClose()
                    Toast.makeText(context, "${picked.title} olarak dışa aktarıldı", Toast.LENGTH_SHORT).show()
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    save = SaveState.Idle
                    Toast.makeText(context, "Dışa aktarma başarısız oldu, tekrar dene", Toast.LENGTH_LONG).show()
                }
            }
        }

        KmSegmented(
            options = listOf(Scope.Open to "Bu sohbet", Scope.All to "Tüm sohbetler"),
            selected = effectiveScope,
            onSelect = { chosenScope = it },
            enabled = { it != Scope.Open || openChat != null },
            background = KmColors.bg,
            selectedBackground = KmColors.surfaceElevated,
        )
        GapV(14.dp)
        ExportPreview(format, chats, count, loading = all == null)
        GapV(12.dp)
        Column(Modifier.selectableGroup()) {
            ExportFormat.entries.forEach { f -> FormatRow(f, f == format) { format = f } }
        }
        GapV(10.dp)
        val label = when {
            save == SaveState.Done -> "Kaydedildi"
            save == SaveState.Busy -> "Hazırlanıyor"
            count == 0 -> "Aktarılacak sohbet yok"
            chats.size > 1 -> "Dışa aktar · ${chats.size} sohbet, $count mesaj"
            else -> "Dışa aktar · $count mesaj"
        }
        KmButton(
            text = label,
            onClick = {
                save = SaveState.Busy
                launcher.launch(exportFileName(format, chats.size, java.time.LocalDate.now()))
            },
            enabled = count > 0 && save == SaveState.Idle,
            loading = save == SaveState.Busy,
            fullWidth = true,
            leftIcon = { KmIcon(if (save == SaveState.Done) KmIcons.Check else KmIcons.Download, KmColors.textOnBrand, 17.dp) },
        )
    }
}

@Composable
private fun FormatRow(f: ExportFormat, selected: Boolean, onClick: () -> Unit) {
    val reduce = rememberReduceMotion()
    val bg by animateColorAsState(if (selected) KmColors.bg else Color.Transparent, tween(if (reduce) 0 else 180), label = "fmtBg")
    val ring by animateColorAsState(if (selected) KmColors.brand else KmColors.textMuted, tween(if (reduce) 0 else 200), label = "ring")
    val dot by animateFloatAsState(if (selected) 1f else 0f, tween(if (reduce) 0 else 250, easing = KmMotion.standard), label = "dot")
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(bg)
            .selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(Modifier.size(38.dp).clip(CircleShape).background(if (selected) KmColors.surface else KmColors.bg), contentAlignment = Alignment.Center) {
            KmIcon(if (f == ExportFormat.Json) KmIcons.BracketsCurly else KmIcons.FileText, if (selected) KmColors.brand else KmColors.textSecondary, 19.dp)
        }
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text(f.title, style = KmType.callout, color = KmColors.text)
                Text(" .${f.ext}", style = KmType.footnote, color = KmColors.textMuted)
            }
            Text(f.subtitle, style = KmType.footnote, color = KmColors.textMuted)
        }
        Box(Modifier.size(22.dp).clip(CircleShape).border(2.dp, ring, CircleShape), contentAlignment = Alignment.Center) {
            Box(Modifier.size(12.dp).graphicsLayer { scaleX = dot; scaleY = dot }.clip(CircleShape).background(KmColors.brand))
        }
    }
}

/** 188dp önizleme kutusu; altı yumuşakça kaybolur. Biçim değişince yeni içerik yukarı kayarak gelir. */
@Composable
private fun ExportPreview(format: ExportFormat, chats: List<StoredChat>, count: Int, loading: Boolean) {
    val reduce = rememberReduceMotion()
    val surface = KmColors.surfaceElevated
    Box(
        Modifier
            .fillMaxWidth()
            .height(188.dp)
            .clip(RoundedCornerShape(18.dp))
            .background(surface)
            .drawWithContent {
                drawContent()
                drawRect(Brush.verticalGradient(listOf(Color.Transparent, surface), startY = size.height - 44.dp.toPx(), endY = size.height))
            },
    ) {
        AnimatedContent(
            targetState = Triple(format, chats.map { it.id }, loading),
            transitionSpec = {
                if (reduce) fadeIn(tween(0)) togetherWith fadeOut(tween(0))
                else (fadeIn(tween(350)) + slideInVertically(tween(350, easing = KmMotion.standard)) { it / 12 }) togetherWith fadeOut(tween(120))
            },
            label = "preview",
        ) { (f, _, isLoading) ->
            when {
                isLoading -> Box(Modifier.fillMaxSize())
                count == 0 -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("Henüz dışa aktarılacak mesaj yok.", style = KmType.subhead, color = KmColors.textMuted)
                }
                f == ExportFormat.Html -> DocPreview(chats, count)
                else -> Text(
                    remember(f, chats) { buildExport(f, chats, ZonedDateTime.now()).lineSequence().take(11).joinToString("\n") },
                    style = KmType.caption.copy(fontFamily = FontFamily.Monospace, fontSize = 11.5.sp, lineHeight = 17.sp),
                    color = KmColors.textSecondary,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                )
            }
        }
    }
}

@Composable
private fun DocPreview(chats: List<StoredChat>, count: Int) {
    val c = chats.first()
    val msgs = c.messages.filter { it.content.isNotBlank() && (it.role == "user" || it.role == "model") }.take(2)
    Column(Modifier.padding(horizontal = 16.dp, vertical = 14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            KmMark(MarkState.Idle, size = 14.dp)
            Text("KocaMind", style = KmType.caption, color = KmColors.text)
        }
        Text(
            if (chats.size == 1) c.title else "${chats.size} sohbet",
            style = KmType.headline, color = KmColors.text, maxLines = 1, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 8.dp),
        )
        Text("$count mesaj", style = KmType.caption, color = KmColors.textMuted, modifier = Modifier.padding(bottom = 8.dp))
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(KmColors.bg).padding(horizontal = 12.dp, vertical = 10.dp)) {
            msgs.forEach { m ->
                if (m.role == "user") {
                    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
                        Text(
                            m.content.take(70), style = KmType.caption, color = KmColors.text, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.widthIn(max = 220.dp).clip(RoundedCornerShape(12.dp, 12.dp, 4.dp, 12.dp)).background(KmColors.surfaceElevated).padding(horizontal = 10.dp, vertical = 5.dp),
                        )
                    }
                    GapV(8.dp)
                } else {
                    Text(
                        plainPreview(m.content), style = KmType.caption, color = KmColors.textSecondary, maxLines = 4, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.heightIn(max = 80.dp),
                    )
                }
            }
        }
    }
}

/** Önizleme için markdown işaretleri kaldırılmış tek satırlık metin. */
private fun plainPreview(md: String): String = markdownToText(md).replace(Regex("\\s+"), " ").trim()
