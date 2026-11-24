package com.tyler.kocamind.ui.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.tyler.kocamind.ui.components.ButtonVariant
import com.tyler.kocamind.ui.components.KmButton
import com.tyler.kocamind.ui.components.KmSheet
import com.tyler.kocamind.ui.theme.KmColors
import com.tyler.kocamind.ui.theme.KmSpace
import com.tyler.kocamind.ui.theme.KmType

private const val NOTE_LIMIT = 500

private val reasons = listOf(
    "wrong" to "Yanlış bilgi",
    "incomplete" to "Eksik",
    "cut_off" to "Yarıda kesildi",
    "language" to "Dil/üslup kötü",
    "unsafe" to "Uygunsuz",
    "slow" to "Çok yavaş",
    "other" to "Diğer",
)

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun FeedbackReasonSheet(
    onSubmit: (reason: String?, note: String?) -> Unit,
    onSkip: () -> Unit,
) {
    var reason by rememberSaveable { mutableStateOf<String?>(null) }
    var note by rememberSaveable { mutableStateOf("") }

    KmSheet(visible = true, title = "Yanıtı neden beğenmedin?", onClose = onSkip) {
        Column(verticalArrangement = Arrangement.spacedBy(KmSpace.md)) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(KmSpace.sm)) {
                reasons.forEach { (code, label) ->
                    FilterChip(
                        selected = reason == code,
                        onClick = { reason = code.takeUnless { it == reason } },
                        label = { Text(label, style = KmType.subhead) },
                        colors = FilterChipDefaults.filterChipColors(
                            labelColor = KmColors.text,
                            selectedLabelColor = KmColors.textOnBrand,
                            selectedContainerColor = KmColors.brand,
                        ),
                    )
                }
            }
            OutlinedTextField(
                value = note,
                onValueChange = { note = it.take(NOTE_LIMIT) },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Not (isteğe bağlı)") },
                supportingText = { Text("${note.length} / $NOTE_LIMIT") },
                minLines = 2,
                maxLines = 4,
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(KmSpace.sm),
            ) {
                KmButton("Geç", onClick = onSkip, modifier = Modifier.weight(1f), variant = ButtonVariant.Secondary)
                KmButton(
                    "Gönder",
                    onClick = { onSubmit(reason, note.trim().takeIf { it.isNotEmpty() }) },
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}
