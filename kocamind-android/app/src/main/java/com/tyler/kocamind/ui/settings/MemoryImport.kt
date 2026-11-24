package com.tyler.kocamind.ui.settings

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tyler.kocamind.data.memory.ImportResult
import com.tyler.kocamind.ui.components.ButtonSize
import com.tyler.kocamind.ui.components.ButtonVariant
import com.tyler.kocamind.ui.components.KmButton
import com.tyler.kocamind.ui.components.KmIcon
import com.tyler.kocamind.ui.components.KmSheet
import com.tyler.kocamind.ui.icons.KmIcons
import com.tyler.kocamind.ui.theme.KmColors
import com.tyler.kocamind.ui.theme.KmType
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Kullanıcının ChatGPT, Gemini, Claude gibi uygulamalara yapıştıracağı istem; cevabı KocaMind'e aktarılır. */
const val MEMORY_IMPORT_PROMPT = """Bir yapay zeka asistanından diğerine bağlam aktarmama yardımcı oluyorsun. Görevin, geçmişteki sohbetlerimizi inceleyerek benimle ilgili bildiklerini özetlemek.
Çıktıda lütfen birinci şahıs zamirlerini (ben, bana, beni, bende, benden, benim, biz, bize, bizi, bizde, bizden, bizim) ve ikinci şahıs zamirlerini (sen, sana, seni, sende, senden, senin, siz, size, sizi, sizde, sizden, sizin) kullanma. Bunun yerine, hakkında bilgi edindiğin kişiden "kullanıcı" olarak bahset veya tarafsız ifadeler kullan.
Talimatlar ve tercihler başta olmak üzere kullanıcının sözlerini mümkün olduğunca harfiyen koru.
Kategoriler (bu sırayla sunulacak):

1. Demografik Bilgiler: Tercih edilen adlar, meslek, eğitim ve genel ikamet yeri
2. İlgi Alanları ve Tercihler: Devamlılığı olan aktif etkileşimler (yalnızca bir nesneye sahip olmak veya tek seferlik satın alım değil)
3. İlişkiler: Doğrulanmış ve devamlılığı olan ilişkiler
4. Tarihli Etkinlikler, Projeler ve Planlar: Önemli ve son etkinliklerin günlüğü
5. Talimatlar: Bundan sonra uymanı açıkça istediğim kurallar ("her zaman X yap", "asla Y yapma") ve davranışınla ilgili düzeltmeler. Yalnızca kayıtlı hafızalardaki kuralları dahil et, sohbetlerdekileri ekleme.

Biçim:
Yukarıdaki kategorileri kullanarak içeriği etiketli bölümlere ayır. İstemlerimden kelimesi kelimesine alıntılar ekleyerek her girişi kanıta dayandırmaya çalış. Her girişi şu biçimi kullanarak yapılandır:
Kullanıcının adı <name>.

* Kanıt: Kullanıcı, "Bana <name> de" dedi. Tarih: [YYYY-AA-GG].

Çıktı:

* YALNIZCA istenen bilgileri çıktı olarak sun. Sohbetlerde kullanılan dolgu sözcükleri, giriş metni veya kapanış ifadesi ekleme.

Son olarak, "Şuradan içe aktarıldı: <ad>" cümlesini tamamla (burada ad olarak ChatGPT, Claude, Grok vb. yazabilirsin). Bu, yanıtındaki en son metin olmalıdır."""

private sealed interface ImportState {
    data object Idle : ImportState
    data object Busy : ImportState
    data class Done(val result: ImportResult) : ImportState
}

/** Ayarlar > Hafıza > Başka uygulamadan taşı: istemi kopyala, diğer uygulamaya yapıştır, gelen cevabı içe aktar. */
@Composable
fun MemoryImportSheet(visible: Boolean, onDismiss: () -> Unit, onImport: suspend (String) -> ImportResult) {
    KmSheet(visible = visible, onClose = onDismiss, title = "Hafızanı KocaMind'e taşı") {
        val context = LocalContext.current
        val scope = rememberCoroutineScope()
        var pasted by remember { mutableStateOf("") }
        var copied by remember { mutableStateOf(false) }
        var state by remember { mutableStateOf<ImportState>(ImportState.Idle) }
        LaunchedEffect(copied) {
            if (copied) {
                delay(2000)
                copied = false
            }
        }

        Text(
            "ChatGPT, Gemini ya da Claude'un seninle ilgili hatırladıklarını üç adımda buraya getir. Taşınan bilgiler cevaplarda kullanılır ama KocaMind'in senin hakkındaki yorumunu etkilemez.",
            style = KmType.subhead, color = KmColors.textSecondary,
        )
        Step(1, "Bu istemi kopyala")
        Box(
            Modifier
                .fillMaxWidth()
                .heightIn(max = 168.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(KmColors.bg)
                .verticalScroll(rememberScrollState())
                .padding(14.dp),
        ) {
            Text(
                MEMORY_IMPORT_PROMPT,
                style = KmType.caption.copy(fontFamily = FontFamily.Monospace, fontSize = 12.sp, lineHeight = 18.sp, fontWeight = FontWeight.Normal),
                color = KmColors.textSecondary,
            )
        }
        GapV(10.dp)
        KmButton(
            text = if (copied) "Kopyalandı" else "İstemi kopyala",
            onClick = {
                copyToClipboard(context, MEMORY_IMPORT_PROMPT)
                copied = true
            },
            variant = ButtonVariant.Secondary,
            fullWidth = true,
            leftIcon = { KmIcon(if (copied) KmIcons.Check else KmIcons.Copy, KmColors.text, 16.dp) },
        )
        Step(2, "Diğer uygulamada yeni bir sohbete yapıştır ve gönder")
        Step(3, "Gelen cevabın tamamını buraya yapıştır")
        val shape = RoundedCornerShape(16.dp)
        Box(Modifier.fillMaxWidth().clip(shape).background(KmColors.bg).border(1.dp, KmColors.border, shape)) {
            BasicTextField(
                value = pasted,
                onValueChange = { pasted = it.take(20000); if (state is ImportState.Done) state = ImportState.Idle },
                textStyle = KmType.subhead.copy(color = KmColors.text, fontWeight = FontWeight.Normal),
                cursorBrush = SolidColor(KmColors.brand),
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 120.dp, max = 220.dp)
                    .semantics { contentDescription = "Gelen cevap" }
                    .padding(14.dp),
                decorationBox = { inner ->
                    if (pasted.isEmpty()) Text("- [Kişisel] isim: …", style = KmType.subhead, color = KmColors.textMuted)
                    inner()
                },
            )
        }
        Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            KmButton(
                text = "Panodan yapıştır",
                onClick = { readClipboard(context)?.let { pasted = it.take(20000) } },
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                leftIcon = { KmIcon(KmIcons.Paperclip, KmColors.text, 14.dp) },
            )
        }
        (state as? ImportState.Done)?.let { done ->
            Row(
                Modifier.padding(top = 12.dp).fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(KmColors.successMuted).padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                KmIcon(KmIcons.CircleCheck, KmColors.success, 18.dp)
                Text(importSummary(done.result), style = KmType.subhead, color = KmColors.text)
            }
        }
        GapV(14.dp)
        KmButton(
            text = "İçe aktar",
            onClick = {
                state = ImportState.Busy
                scope.launch {
                    state = try {
                        ImportState.Done(onImport(pasted.trim()))
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        Toast.makeText(context, e.message ?: "Hafıza aktarılamadı, tekrar dene.", Toast.LENGTH_LONG).show()
                        ImportState.Idle
                    }
                }
            },
            enabled = pasted.isNotBlank() && state is ImportState.Idle,
            loading = state is ImportState.Busy,
            fullWidth = true,
        )
    }
}

/** İçe aktarma sonucunun kullanıcıya gösterilen cümlesi. */
fun importSummary(result: ImportResult): String = buildString {
    val from = result.from?.let { "$it'den " }.orEmpty()
    append(if (result.saved > 0) "$from${result.saved} bilgi hafızana eklendi." else "Yeni bir bilgi bulunamadı.")
    if (result.skippedForLimit > 0) append(" ${result.skippedForLimit} bilgi 100 kayıt sınırı nedeniyle eklenmedi.")
}

@Composable
private fun Step(number: Int, text: String) {
    Row(Modifier.padding(top = 18.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(Modifier.size(24.dp).clip(CircleShape).background(KmColors.brandMuted), contentAlignment = Alignment.Center) {
            Text("$number", style = KmType.caption.copy(fontWeight = FontWeight.SemiBold), color = KmColors.brand)
        }
        Text(text, style = KmType.callout, color = KmColors.text)
    }
}

private fun copyToClipboard(context: Context, text: String) {
    context.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("KocaMind hafıza istemi", text))
}

private fun readClipboard(context: Context): String? =
    context.getSystemService(ClipboardManager::class.java)?.primaryClip?.takeIf { it.itemCount > 0 }
        ?.getItemAt(0)?.coerceToText(context)?.toString()?.takeIf { it.isNotBlank() }
