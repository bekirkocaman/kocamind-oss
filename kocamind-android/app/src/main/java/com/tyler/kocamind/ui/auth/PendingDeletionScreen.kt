package com.tyler.kocamind.ui.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import com.tyler.kocamind.ui.components.ButtonVariant
import com.tyler.kocamind.ui.components.KmButton
import com.tyler.kocamind.ui.components.KmMark
import com.tyler.kocamind.ui.components.MarkState
import com.tyler.kocamind.ui.theme.KmColors
import com.tyler.kocamind.ui.theme.KmLayout
import com.tyler.kocamind.ui.theme.KmSpace
import com.tyler.kocamind.ui.theme.KmType
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private const val CONFIRM_WORD = "SİL"

/** "11 Aralık 2026" ve kalan gün; tarih okunamazsa null. */
internal fun describePurge(iso: String?, now: Instant = Instant.now()): Pair<String, Long>? {
    val instant = iso?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: return null
    val date = DateTimeFormatter.ofPattern("d MMMM yyyy", Locale.forLanguageTag("tr-TR"))
        .withZone(ZoneId.of("Europe/Istanbul"))
        .format(instant)
    val days = Duration.between(now, instant).toHours().coerceAtLeast(0).let { (it + 23) / 24 }
    return date to days
}

/**
 * Silinmeyi bekleyen (60 günlük süre) hesabın tek ekranı. Uygulamanın geri kalanı
 * kilitli; kullanıcı hesabını geri alabilir, hemen silebilir ya da çıkış yapabilir.
 */
@Composable
fun PendingDeletionScreen(
    email: String?,
    loadPurgeAfter: suspend () -> String?,
    onRestore: suspend () -> Unit,
    onDeleteNow: suspend () -> Unit,
    onSignOut: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val scope = rememberCoroutineScope()
    var purgeAfter by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirming by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        purgeAfter = try { loadPurgeAfter() } catch (e: CancellationException) { throw e } catch (e: Exception) { null }
    }

    fun run(kind: String, action: suspend () -> Unit) {
        busy = kind
        error = null
        scope.launch {
            try {
                action()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = e.message ?: "İşlem tamamlanamadı."
                busy = null
            }
        }
    }

    val purge = describePurge(purgeAfter)
    Box(modifier.fillMaxSize().padding(KmSpace.lg), contentAlignment = Alignment.Center) {
        Column(
            Modifier.widthIn(max = KmLayout.maxContentWidth).fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(KmSpace.md),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            KmMark(MarkState.Idle)
            Text("Hesabın silinmeye planlandı", style = KmType.title, color = KmColors.text, textAlign = TextAlign.Center)
            Text(
                buildString {
                    append(email?.let { "$it hesabın kilitli. " } ?: "Hesabın kilitli. ")
                    append(
                        purge?.let { (date, days) -> "Sohbetlerin, hafızan ve dosyaların $date tarihinde ($days gün sonra) kalıcı olarak silinecek." }
                            ?: "Verilerin 60 günlük bekleme süresinin sonunda kalıcı olarak silinecek.",
                    )
                },
                style = KmType.body,
                color = KmColors.textSecondary,
                textAlign = TextAlign.Center,
            )
            Text(
                "Fikrini değiştirdiysen hesabını geri alabilirsin; her şey kaldığı yerden devam eder.",
                style = KmType.footnote,
                color = KmColors.textMuted,
                textAlign = TextAlign.Center,
            )
            error?.let { Text(it, style = KmType.footnote, color = KmColors.danger, textAlign = TextAlign.Center) }
            KmButton(
                "Hesabımı geri al",
                onClick = { run("restore", onRestore) },
                loading = busy == "restore",
                enabled = busy == null,
                fullWidth = true,
            )
            KmButton(
                "Beklemeden şimdi kalıcı olarak sil",
                onClick = { confirming = true },
                variant = ButtonVariant.Danger,
                loading = busy == "delete",
                enabled = busy == null,
                fullWidth = true,
            )
            TextButton(onClick = onSignOut, enabled = busy == null) {
                Text("Çıkış yap", style = KmType.subhead, color = KmColors.textMuted)
            }
        }
    }

    if (confirming) {
        var typed by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { confirming = false },
            title = { Text("Hemen kalıcı olarak sil", style = KmType.headline) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(KmSpace.sm)) {
                    Text("Hesabın ve tüm verilerin hemen, geri alınamaz şekilde silinecek. Onaylamak için $CONFIRM_WORD yaz.", style = KmType.body)
                    OutlinedTextField(
                        value = typed,
                        onValueChange = { typed = it },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
                    )
                }
            },
            confirmButton = {
                TextButton(
                    enabled = typed.trim() == CONFIRM_WORD,
                    onClick = {
                        confirming = false
                        run("delete", onDeleteNow)
                    },
                ) { Text("Kalıcı olarak sil", color = KmColors.danger) }
            },
            dismissButton = { TextButton(onClick = { confirming = false }) { Text("Vazgeç") } },
        )
    }
}
