package com.tyler.kocamind.ui.settings

import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.tyler.kocamind.ui.components.KmIcon
import com.tyler.kocamind.ui.components.pressableScale
import com.tyler.kocamind.ui.components.rememberReduceMotion
import com.tyler.kocamind.ui.icons.KmIcons
import com.tyler.kocamind.ui.theme.KmColors
import com.tyler.kocamind.ui.theme.KmSpace
import com.tyler.kocamind.ui.theme.KmType

const val INSTRUCTIONS_MAX = 600
private val IDEAS = listOf("Kısa ve öz ol", "Örnekle anlat", "Samimi konuş", "Adım adım açıkla", "Kaynak belirt")

/** Öneriyi metnin sonuna cümle olarak ekler; zaten varsa metni değiştirmez. */
fun appendInstruction(current: String, idea: String): String {
    if (current.contains(idea)) return current
    val base = current.trim()
    val joined = if (base.isEmpty()) "$idea." else "${base.trimEnd('.')}. $idea."
    return joined.take(INSTRUCTIONS_MAX)
}

/** Ayarlar > Özel Talimatlar sayfası. `custom_instructions_<e-posta>` anahtarı korunur. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CustomInstructionsScreen(initial: String, onSave: (String) -> Unit, onBack: () -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val reduce = rememberReduceMotion()
    var text by remember { mutableStateOf(initial) }
    var focused by remember { mutableStateOf(false) }
    val changed = text.trim() != initial.trim()
    val edge by animateColorAsState(if (focused) KmColors.brand else KmColors.border, tween(if (reduce) 0 else 200), label = "edge")
    var askLeave by remember { mutableStateOf(false) }
    fun save() {
        onSave(text.trim())
        Toast.makeText(context, "Özel talimatların kaydedildi.", Toast.LENGTH_SHORT).show()
        onBack()
    }
    fun leave() = if (changed) askLeave = true else onBack()
    BackHandler(enabled = changed) { askLeave = true }

    if (askLeave) {
        AlertDialog(
            onDismissRequest = { askLeave = false },
            title = { Text("Değişiklikler kaydedilmedi", style = KmType.title.copy(fontWeight = FontWeight.Medium), textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()) },
            text = { Text("Yazdığın talimatlar kaydedilmeden çıkılsın mı?", style = KmType.subhead, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()) },
            confirmButton = { TextButton(onClick = { askLeave = false; save() }) { Text("Kaydet", color = KmColors.brand, fontWeight = FontWeight.SemiBold) } },
            dismissButton = { TextButton(onClick = { askLeave = false; onBack() }) { Text("Kaydetmeden çık", color = KmColors.danger, fontWeight = FontWeight.SemiBold) } },
            containerColor = KmColors.surface,
            titleContentColor = KmColors.text,
            textContentColor = KmColors.textSecondary,
            shape = RoundedCornerShape(28.dp),
        )
    }

    Column(modifier.imePadding()) {
        BackTitleHeader(title = "Özel Talimatlar", onBack = ::leave) {
            Box(
                Modifier
                    .clip(RoundedCornerShape(99.dp))
                    .pressableScale(enabled = changed, onClick = ::save, onClickLabel = "Kaydet")
                    .padding(horizontal = 14.dp, vertical = 10.dp),
            ) {
                Text("Kaydet", style = KmType.callout, color = if (changed) KmColors.brand else KmColors.textMuted)
            }
        }
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(KmSpace.lg),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(Modifier.widthIn(max = 800.dp).fillMaxWidth()) {
                Rise(0) {
                    Text(
                        "KocaMind her sohbette bunları dikkate alır.",
                        style = KmType.subhead, color = KmColors.textSecondary,
                        modifier = Modifier.padding(start = 4.dp, bottom = 18.dp),
                    )
                }
                Rise(1) {
                    val shape = RoundedCornerShape(20.dp)
                    Box(Modifier.fillMaxWidth().clip(shape).background(KmColors.surface).border(1.dp, edge, shape)) {
                        BasicTextField(
                            value = text,
                            onValueChange = { text = it.take(INSTRUCTIONS_MAX) },
                            textStyle = KmType.body.copy(color = KmColors.text),
                            cursorBrush = SolidColor(KmColors.brand),
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(min = 170.dp)
                                .onFocusChanged { focused = it.isFocused }
                                .semantics { contentDescription = "Talimatlar" }
                                .padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 34.dp),
                            decorationBox = { inner ->
                                if (text.isEmpty()) Text("Örn: Her zaman Türkçe cevap ver, kısa ve öz ol.", style = KmType.body, color = KmColors.textMuted)
                                inner()
                            },
                        )
                        Text(
                            "${text.length} / $INSTRUCTIONS_MAX",
                            style = KmType.caption, color = KmColors.textMuted,
                            modifier = Modifier.align(Alignment.BottomEnd).padding(end = 14.dp, bottom = 12.dp),
                        )
                    }
                }
                Rise(2) {
                    FlowRow(
                        Modifier.padding(top = 14.dp, bottom = 22.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        IDEAS.forEach { idea ->
                            val used = text.contains(idea)
                            val bg by animateColorAsState(if (used) KmColors.brandMuted else KmColors.surface, tween(if (reduce) 0 else 200), label = "chip")
                            Row(
                                Modifier
                                    .clip(RoundedCornerShape(99.dp))
                                    .background(bg)
                                    .border(1.dp, if (used) bg else KmColors.border, RoundedCornerShape(99.dp))
                                    .pressableScale(enabled = !used, onClick = { text = appendInstruction(text, idea) }, onClickLabel = "$idea ekle")
                                    .padding(horizontal = 12.dp, vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(4.dp),
                            ) {
                                KmIcon(if (used) KmIcons.Check else KmIcons.Plus, if (used) KmColors.brand else KmColors.textSecondary, 14.dp)
                                Text(idea, style = KmType.subhead, color = if (used) KmColors.brand else KmColors.text)
                            }
                        }
                    }
                }
            }
        }
    }
}
