package com.tyler.kocamind.ui.settings

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tyler.kocamind.data.memory.Memory
import com.tyler.kocamind.data.memory.MemoryRepository
import com.tyler.kocamind.ui.components.ButtonSize
import com.tyler.kocamind.ui.components.ButtonVariant
import com.tyler.kocamind.ui.components.KmButton
import com.tyler.kocamind.ui.components.KmIcon
import com.tyler.kocamind.ui.components.KmSkeleton
import com.tyler.kocamind.ui.components.pressableScale
import com.tyler.kocamind.ui.icons.KmIcons
import com.tyler.kocamind.ui.theme.KmColors
import com.tyler.kocamind.ui.theme.KmSpace
import com.tyler.kocamind.ui.theme.KmType
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** Backend'in hafıza sınırı (memoryAssist.MAX_MEMORIES_PER_USER). */
private const val MEMORY_LIMIT = 100

private val CATEGORY_LABELS = linkedMapOf(
    "kisisel" to "Kişisel",
    "tercih" to "Tercihler",
    "is" to "İş",
    "saglik" to "Sağlık",
    "proje" to "Projeler",
    "genel" to "Diğer",
)

/** Hafızayı kategori sırasına göre gruplar; bilinmeyen ya da boş kategori "Diğer"e düşer. */
fun groupMemories(memories: List<Memory>): List<Pair<String, List<Memory>>> {
    val byCategory = memories.groupBy { it.category?.takeIf { c -> c in CATEGORY_LABELS } ?: "genel" }
    return CATEGORY_LABELS.mapNotNull { (id, label) -> byCategory[id]?.let { label to it } }
}

/** Yapay zekânın kullanıcı hakkındaki yorumunun durumu. */
sealed interface InsightUi {
    data object Loading : InsightUi
    data class Ready(val text: String, val basedOn: Int, val chats: Int = 0) : InsightUi
    data object Few : InsightUi
    data object Failed : InsightUi
}

data class MemoryUiState(
    /** null: yükleniyor ya da yüklenemedi. */
    val memories: List<Memory>?,
    val failed: Boolean = false,
    val enabled: Boolean = true,
    val autoSave: Boolean = true,
    val deleting: String? = null,
    val insight: InsightUi? = null,
    val refreshingInsight: Boolean = false,
)

class MemoryActions(
    val onRetry: () -> Unit = {},
    val onDelete: (String) -> Unit = {},
    val onDeleteAll: () -> Unit = {},
    val onEnabled: (Boolean) -> Unit = {},
    val onAutoSave: (Boolean) -> Unit = {},
    val onRefreshInsight: () -> Unit = {},
    val onImport: () -> Unit = {},
)

/** Ayarlar > Hafıza. */
@Composable
fun MemoryScreen(repo: MemoryRepository, onBack: () -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val memories by repo.memories.collectAsStateWithLifecycle()
    val enabled by repo.prefs.enabled.collectAsStateWithLifecycle()
    val autoSave by repo.prefs.autoSave.collectAsStateWithLifecycle()
    var failed by remember { mutableStateOf(false) }
    var attempt by remember { mutableStateOf(0) }
    var deleting by remember { mutableStateOf<String?>(null) }
    var askDeleteAll by remember { mutableStateOf(false) }
    var insight by remember { mutableStateOf<InsightUi>(InsightUi.Loading) }
    var insightAttempt by remember { mutableStateOf(0) }
    var forceInsight by remember { mutableStateOf(false) }
    var importing by remember { mutableStateOf(false) }

    LaunchedEffect(attempt) {
        failed = false
        failed = !repo.refresh()
    }
    // Hafıza değişince (silme, içe aktarma) yorum da yenilenir; backend aynı hafıza için önbellekten verir.
    val memoryKey = memories?.joinToString("|") { it.key + "=" + it.value }
    LaunchedEffect(memoryKey, insightAttempt) {
        if (memories == null) return@LaunchedEffect
        if (insight !is InsightUi.Ready) insight = InsightUi.Loading
        val result = repo.insight(refresh = forceInsight)
        forceInsight = false
        insight = when {
            result == null -> InsightUi.Failed
            result.text == null -> InsightUi.Few
            else -> InsightUi.Ready(result.text, result.basedOn, result.chats)
        }
    }

    fun guarded(key: String, block: suspend () -> Unit) {
        deleting = key
        scope.launch {
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Toast.makeText(context, "Silinemedi, internet bağlantını kontrol edip tekrar dene.", Toast.LENGTH_LONG).show()
            } finally {
                deleting = null
            }
        }
    }

    Column(modifier) {
        BackTitleHeader(title = "Hafıza", onBack = onBack)
        MemoryContent(
            MemoryUiState(
                memories, failed = failed && memories == null, enabled = enabled, autoSave = autoSave, deleting = deleting,
                insight = insight, refreshingInsight = forceInsight,
            ),
            MemoryActions(
                onRetry = { attempt++ },
                onDelete = { key -> guarded(key) { repo.delete(key) } },
                onDeleteAll = { askDeleteAll = true },
                onEnabled = repo.prefs::setEnabled,
                onAutoSave = repo.prefs::setAutoSave,
                onRefreshInsight = {
                    forceInsight = true
                    insightAttempt++
                },
                onImport = { importing = true },
            ),
        )
    }

    MemoryImportSheet(visible = importing, onDismiss = { importing = false }, onImport = { repo.importText(it) })

    if (askDeleteAll) {
        AlertDialog(
            onDismissRequest = { askDeleteAll = false },
            icon = {
                Box(Modifier.size(40.dp).clip(CircleShape).background(KmColors.dangerMuted), contentAlignment = Alignment.Center) {
                    KmIcon(KmIcons.Trash2, KmColors.danger, 20.dp)
                }
            },
            title = { Text("Tüm hafıza silinsin mi?", style = KmType.title.copy(fontWeight = FontWeight.Medium), textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()) },
            text = {
                Text(
                    "KocaMind seninle ilgili hatırladığı her şeyi unutur. Sohbetlerin silinmez.",
                    style = KmType.subhead, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    askDeleteAll = false
                    guarded("*") { repo.deleteAll() }
                }) { Text("Tümünü sil", color = KmColors.danger, fontWeight = FontWeight.SemiBold) }
            },
            dismissButton = { TextButton(onClick = { askDeleteAll = false }) { Text("Vazgeç", color = KmColors.brand, fontWeight = FontWeight.SemiBold) } },
            containerColor = KmColors.surface,
            titleContentColor = KmColors.text,
            textContentColor = KmColors.textSecondary,
            shape = RoundedCornerShape(28.dp),
        )
    }
}

@Composable
fun MemoryContent(state: MemoryUiState, actions: MemoryActions, modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = KmSpace.lg).padding(top = KmSpace.sm, bottom = KmSpace.xl),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(Modifier.widthIn(max = 800.dp).fillMaxWidth()) {
            Rise(0) {
                Text(
                    "KocaMind sohbetlerinden önemli bilgileri hatırlar ve cevaplarını sana göre şekillendirir. Hatırladıklarını buradan görebilir, silebilirsin.",
                    style = KmType.subhead, color = KmColors.textSecondary,
                    modifier = Modifier.padding(start = 4.dp, end = 4.dp, top = KmSpace.sm),
                )
            }
            state.insight?.let { InsightCard(it, state.refreshingInsight, actions.onRefreshInsight) }
            SettingsGroup(null, 1) {
                SettingSwitchRow(KmIcons.Notebook, "Hafızayı kullan", "Cevaplarda hatırladıklarını dikkate alır", state.enabled, actions.onEnabled)
                SettingSwitchRow(
                    KmIcons.NotePencil, "Otomatik hatırla",
                    if (state.enabled) "Yeni bilgileri mesajlarından kendiliğinden kaydeder" else "Hafıza kapalıyken çalışmaz",
                    state.enabled && state.autoSave,
                ) { if (state.enabled) actions.onAutoSave(it) }
                SettingRow(KmIcons.Download, "Başka uygulamadan taşı", "ChatGPT, Gemini ya da Claude'daki hafızanı getir", onClick = actions.onImport)
            }
            when {
                state.memories == null && state.failed -> SettingsGroup(null, 2) {
                    SettingBlock {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text("Hafıza yüklenemedi", style = KmType.callout, color = KmColors.text)
                                Text("İnternet bağlantını kontrol et.", style = KmType.footnote, color = KmColors.textMuted)
                            }
                            KmButton(text = "Tekrar dene", onClick = actions.onRetry, size = ButtonSize.Sm, variant = ButtonVariant.Secondary)
                        }
                    }
                }
                state.memories == null -> SettingsGroup(null, 2) {
                    repeat(3) { SettingBlock { KmSkeleton(Modifier.fillMaxWidth(0.4f), height = 12.dp); GapV(8.dp); KmSkeleton(Modifier.fillMaxWidth(), height = 14.dp) } }
                }
                state.memories.isEmpty() -> SettingsGroup(null, 2) {
                    SettingBlock {
                        Column(Modifier.fillMaxWidth().padding(vertical = KmSpace.md), horizontalAlignment = Alignment.CenterHorizontally) {
                            KmIcon(KmIcons.Notebook, KmColors.textMuted, 24.dp)
                            GapV(10.dp)
                            Text("Henüz bir şey hatırlamıyorum", style = KmType.callout, color = KmColors.text)
                            Text(
                                "Adın, işin ya da tercihlerin gibi bilgileri sohbette söylediğinde burada görünür.",
                                style = KmType.footnote, color = KmColors.textMuted, textAlign = TextAlign.Center,
                                modifier = Modifier.padding(top = 4.dp),
                            )
                        }
                    }
                }
                else -> {
                    groupMemories(state.memories).forEachIndexed { i, (label, items) ->
                        SettingsGroup(label, 2 + i) {
                            items.forEach { MemoryRow(it, deleting = state.deleting == it.key || state.deleting == "*") { actions.onDelete(it.key) } }
                        }
                    }
                    Text(
                        "${state.memories.size} / $MEMORY_LIMIT bilgi",
                        style = KmType.caption, color = KmColors.textMuted,
                        modifier = Modifier.padding(start = 6.dp, top = 10.dp),
                    )
                    SettingsGroup(null, 8) {
                        SettingRow(KmIcons.Trash2, "Tüm hafızayı sil", "Hatırlanan her şey unutulur", danger = true, chevron = false, onClick = actions.onDeleteAll)
                    }
                }
            }
        }
    }
}

/** Yorumun neye dayandığı: "12 sohbete ve 4 bilgiye dayanır". */
fun insightBasis(chats: Int, memories: Int): String {
    val parts = listOfNotNull(chats.takeIf { it > 0 }?.let { "$it sohbete" }, memories.takeIf { it > 0 }?.let { "$it bilgiye" })
    val basis = if (parts.isEmpty()) "Sohbetlerine dayanır" else parts.joinToString(" ve ") + " dayanır"
    return "$basis · başka uygulamalardan taşınanlar dahil değil"
}

/** "KocaMind'in yorumu": sohbetlere ve hafızaya dayanan kısa, objektif değerlendirme. */
@Composable
private fun InsightCard(insight: InsightUi, refreshing: Boolean, onRefresh: () -> Unit) {
    Rise(1) {
        Column(
            Modifier
                .padding(top = 22.dp)
                .fillMaxWidth()
                .clip(GroupOuter)
                .background(KmColors.brandMuted)
                .padding(start = 18.dp, end = 8.dp, top = 12.dp, bottom = 16.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                KmIcon(KmIcons.Quotes, KmColors.brand, 16.dp)
                Text(
                    "KocaMind'in yorumu", style = KmType.subhead.copy(fontWeight = FontWeight.SemiBold), color = KmColors.brand,
                    modifier = Modifier.padding(start = 8.dp).weight(1f),
                )
                if (insight !is InsightUi.Few) {
                    Box(
                        Modifier
                            .size(40.dp)
                            .clip(CircleShape)
                            .pressableScale(enabled = !refreshing && insight !is InsightUi.Loading, onClick = onRefresh, onClickLabel = "Yenile")
                            .semantics { contentDescription = "Yorumu yenile" },
                        contentAlignment = Alignment.Center,
                    ) { KmIcon(KmIcons.RotateCcw, KmColors.brand, 16.dp) }
                }
            }
            Column(Modifier.padding(end = 10.dp, top = 6.dp)) {
                when (insight) {
                    InsightUi.Loading -> {
                        KmSkeleton(Modifier.fillMaxWidth(), height = 14.dp)
                        GapV(8.dp)
                        KmSkeleton(Modifier.fillMaxWidth(0.85f), height = 14.dp)
                        GapV(8.dp)
                        KmSkeleton(Modifier.fillMaxWidth(0.6f), height = 14.dp)
                    }
                    is InsightUi.Ready -> {
                        Text(insight.text, style = KmType.body, color = KmColors.text)
                        Text(
                            insightBasis(insight.chats, insight.basedOn),
                            style = KmType.caption.copy(fontWeight = FontWeight.Normal), color = KmColors.textSecondary,
                            modifier = Modifier.padding(top = 10.dp),
                        )
                    }
                    InsightUi.Few -> Text(
                        "Seni yorumlamak için biraz daha tanımam lazım. Benimle sohbet ettikçe ya da hafızanı başka bir uygulamadan taşıdıkça, neyle uğraştığına ve nasıl çalıştığına dair objektif bir yorum burada görünecek.",
                        style = KmType.subhead, color = KmColors.textSecondary,
                    )
                    InsightUi.Failed -> Text("Yorum şu anda oluşturulamadı.", style = KmType.subhead, color = KmColors.textSecondary)
                }
            }
        }
    }
}

@Composable
private fun MemoryRow(memory: Memory, deleting: Boolean, onDelete: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 64.dp)
            .clip(RoundedCornerShape(6.dp))
            .background(KmColors.surface)
            .padding(start = 16.dp, top = 10.dp, bottom = 10.dp, end = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(memory.key, style = KmType.caption, color = KmColors.textMuted)
            Text(memory.value, style = KmType.callout, color = KmColors.text, modifier = Modifier.padding(top = 2.dp))
        }
        Box(
            Modifier
                .size(44.dp)
                .clip(CircleShape)
                .pressableScale(enabled = !deleting, onClick = onDelete, onClickLabel = "Sil")
                .semantics { contentDescription = "${memory.key} bilgisini sil" },
            contentAlignment = Alignment.Center,
        ) {
            KmIcon(KmIcons.X, if (deleting) KmColors.border else KmColors.textMuted, 18.dp)
        }
    }
}
