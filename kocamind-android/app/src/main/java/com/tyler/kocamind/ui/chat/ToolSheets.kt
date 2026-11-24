package com.tyler.kocamind.ui.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tyler.kocamind.ui.components.KmDivider
import com.tyler.kocamind.ui.components.KmIcon
import com.tyler.kocamind.ui.components.KmIconButton
import com.tyler.kocamind.ui.components.KmSheet
import com.tyler.kocamind.ui.components.pressableScale
import com.tyler.kocamind.ui.components.rememberReduceMotion
import com.tyler.kocamind.ui.icons.KmIcons
import com.tyler.kocamind.ui.settings.GroupOuter
import com.tyler.kocamind.ui.settings.SettingSwitchRow
import com.tyler.kocamind.ui.theme.KmColors
import com.tyler.kocamind.ui.theme.KmMotion
import com.tyler.kocamind.ui.theme.KmRadius
import com.tyler.kocamind.ui.theme.KmSpace
import com.tyler.kocamind.ui.theme.KmType

/** Kamera / Fotoğraflar / Dosyalar kutucuğu (klon düzeni: yuvarlak ikon, altında ad). */
@Composable
private fun AttachTile(icon: ImageVector, label: String, modifier: Modifier, onClick: () -> Unit) {
    Column(
        modifier
            .clip(RoundedCornerShape(20.dp))
            .background(KmColors.surface)
            .pressableScale(onClick = onClick, pressedOpacity = 0.9f, onClickLabel = label)
            .padding(vertical = 17.dp, horizontal = KmSpace.xs),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(47.dp).clip(CircleShape).background(KmColors.surfaceElevated), contentAlignment = Alignment.Center) {
            KmIcon(icon, KmColors.text, 22.dp)
        }
        Text(label, style = KmType.body.copy(fontSize = 15.sp), color = KmColors.text, maxLines = 1)
    }
}

/**
 * "+" paneli: üstte ekleme kutucukları, altta Derin düşünce. Fotoğraf/video üretme, araştırma ve agent
 * mesajdan anlaşılır (IntentRouter).
 */
@Composable
fun AttachSheet(
    visible: Boolean,
    onClose: () -> Unit,
    onImage: () -> Unit,
    onCamera: () -> Unit,
    onDocument: () -> Unit,
    deepThink: Boolean = false,
    onDeepThinkChange: ((Boolean) -> Unit)? = null,
) {
    KmSheet(visible = visible, onClose = onClose, title = "Sohbete ekle") {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(KmSpace.sm)) {
            AttachTile(KmIcons.Camera, "Kamera", Modifier.weight(1f)) { onClose(); onCamera() }
            AttachTile(KmIcons.Image, "Fotoğraflar", Modifier.weight(1f)) { onClose(); onImage() }
            AttachTile(KmIcons.FileText, "Dosyalar", Modifier.weight(1f)) { onClose(); onDocument() }
        }
        if (onDeepThinkChange != null) {
            Column(Modifier.fillMaxWidth().padding(top = KmSpace.md).clip(GroupOuter)) {
                SettingSwitchRow(
                    KmIcons.Lightbulb, "Derin düşünce",
                    if (deepThink) "Cevap vermeden önce uzun düşünür" else "Zor sorular için daha dikkatli cevap",
                    deepThink, onDeepThinkChange,
                )
            }
        }
        Text(
            "Görsel, video ya da araştırma için yazman yeterli: \"deniz kenarında bir ev çiz\" gibi.",
            style = KmType.footnote, color = KmColors.textMuted, textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(horizontal = KmSpace.sm).padding(top = KmSpace.lg),
        )
    }
}
