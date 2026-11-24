package com.tyler.kocamind.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import com.tyler.kocamind.data.backend.BackendException
import com.tyler.kocamind.data.backend.BugReportDailyLimitException
import com.tyler.kocamind.ui.components.KmButton
import com.tyler.kocamind.ui.components.KmSheet
import com.tyler.kocamind.ui.theme.KmColors
import com.tyler.kocamind.ui.theme.KmSpace
import com.tyler.kocamind.ui.theme.KmType
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

private const val MIN_REPORT_LENGTH = 10
private const val MAX_REPORT_LENGTH = 4000
private const val REPORT_ERROR = "Hata bildirimi gönderilemedi. Tekrar dene."

@Composable
internal fun BugReportSheet(
    signedIn: Boolean,
    onReport: suspend (String) -> Unit,
    onClose: () -> Unit,
) {
    var text by rememberSaveable { mutableStateOf("") }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    var sent by rememberSaveable { mutableStateOf(false) }
    var sending by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val status = Modifier.semantics { liveRegion = LiveRegionMode.Polite }

    KmSheet(visible = true, onClose = onClose, title = "Hata bildir") {
        Column(verticalArrangement = Arrangement.spacedBy(KmSpace.md)) {
            when {
                !signedIn -> Text("Bildirim göndermek için hesabına giriş yap.", style = KmType.subhead, color = KmColors.textSecondary)
                sent -> {
                    Text("Teşekkürler, bildirimin alındı.", status, style = KmType.body, color = KmColors.text)
                    KmButton("Tamam", onClick = onClose, fullWidth = true)
                }
                else -> {
                    OutlinedTextField(
                        value = text,
                        onValueChange = {
                            text = it.take(MAX_REPORT_LENGTH)
                            error = null
                        },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("Karşılaştığın sorun") },
                        supportingText = { Text("${text.length} / $MAX_REPORT_LENGTH • En az $MIN_REPORT_LENGTH karakter") },
                        enabled = !sending,
                        minLines = 4,
                        maxLines = 8,
                    )
                    error?.let { Text(it, status, style = KmType.subhead, color = KmColors.danger) }
                    KmButton(
                        text = "Gönder",
                        fullWidth = true,
                        enabled = !sending && text.trim().length >= MIN_REPORT_LENGTH,
                        loading = sending,
                        onClick = {
                            if (sending || sent) return@KmButton
                            sending = true
                            error = null
                            val report = text.trim()
                            scope.launch {
                                try {
                                    onReport(report)
                                    text = ""
                                    sent = true
                                } catch (e: CancellationException) {
                                    throw e
                                } catch (e: BugReportDailyLimitException) {
                                    error = e.message
                                } catch (e: BackendException) {
                                    error = e.message ?: REPORT_ERROR
                                } catch (e: Exception) {
                                    error = REPORT_ERROR
                                } finally {
                                    sending = false
                                }
                            }
                        },
                    )
                }
            }
        }
    }
}
