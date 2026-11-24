package com.tyler.kocamind.ui.chat

import com.tyler.kocamind.data.backend.badgeLabel

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.StartOffset
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.font.FontWeight
import com.tyler.kocamind.data.backend.RemoteModel
import com.tyler.kocamind.ui.components.KmIcon
import com.tyler.kocamind.ui.components.KmSheet
import com.tyler.kocamind.ui.components.pressableScale
import com.tyler.kocamind.ui.components.rememberReduceMotion
import com.tyler.kocamind.ui.icons.KmIcons
import com.tyler.kocamind.ui.theme.KmColors
import com.tyler.kocamind.ui.theme.KmMotion
import com.tyler.kocamind.ui.theme.KmRadius
import com.tyler.kocamind.ui.theme.KmSpace
import com.tyler.kocamind.ui.theme.KmType

/** ThinkingDots.tsx: sırayla yanıp sönen üç nokta + etiket. */
@Composable
fun ThinkingDots(label: String = "KocaMind düşünüyor", modifier: Modifier = Modifier) {
    val reduce = rememberReduceMotion()
    val transition = rememberInfiniteTransition(label = "thinking")
    Row(modifier.heightIn(min = 28.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(KmSpace.md)) {
        Row(horizontalArrangement = Arrangement.spacedBy(KmSpace.xs)) {
            repeat(3) { index ->
                val alpha = if (reduce) {
                    0.6f
                } else {
                    val a by transition.animateFloat(
                        initialValue = 0.25f,
                        targetValue = 1f,
                        animationSpec = infiniteRepeatable(
                            tween(KmMotion.BASE, easing = KmMotion.standard),
                            RepeatMode.Reverse,
                            initialStartOffset = StartOffset(index * KmMotion.FAST),
                        ),
                        label = "dot$index",
                    )
                    a
                }
                Box(
                    Modifier
                        .size(6.dp)
                        .graphicsLayer { this.alpha = alpha }
                        .clip(CircleShape)
                        .background(KmColors.brand),
                )
            }
        }
        Text(label, style = KmType.footnote, color = KmColors.textMuted)
    }
}

/** MessageRow.tsx `StreamCursor`: yanıp sönen ▍. */
@Composable
fun StreamCursor() {
    val reduce = rememberReduceMotion()
    val alpha = if (reduce) {
        0.6f
    } else {
        val transition = rememberInfiniteTransition(label = "cursor")
        val a by transition.animateFloat(
            initialValue = 1f,
            targetValue = 0.2f,
            animationSpec = infiniteRepeatable(tween(KmMotion.SLOW, easing = KmMotion.standard), RepeatMode.Reverse),
            label = "cursorAlpha",
        )
        a
    }
    Text("▍", style = KmType.body, color = KmColors.brand, modifier = Modifier.graphicsLayer { this.alpha = alpha })
}

/** Reanimated FadeInDown: verilen gecikmeyle yukarıdan süzülerek belirir. */
@Composable
fun FadeInDown(
    key: Any?,
    delayMs: Int = 0,
    durationMs: Int = KmMotion.SLOW,
    distance: Float = 25f,
    enabled: Boolean = true,
    content: @Composable () -> Unit,
) {
    val reduce = rememberReduceMotion()
    val skip = reduce || !enabled
    val progress = remember(key) { Animatable(if (skip) 1f else 0f) }
    LaunchedEffect(key) {
        if (!skip) progress.animateTo(1f, tween(durationMs, delayMillis = delayMs, easing = KmMotion.decelerate))
    }
    Box(
        Modifier.graphicsLayer {
            alpha = progress.value
            translationY = (1f - progress.value) * -distance * density
        },
    ) { content() }
}

/** Klon tasarımının "Model seç" sayfası: gruplu satırlar, seçilide mavi tik. */
@Composable
fun ModelSheet(
    visible: Boolean,
    models: List<RemoteModel>,
    selected: RemoteModel?,
    onSelect: (RemoteModel) -> Unit,
    onClose: () -> Unit,
) {
    KmSheet(visible = visible, onClose = onClose, title = "Model seç") {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            models.forEachIndexed { index, model ->
                val active = selected?.id == model.id
                val top = if (index == 0) 20.dp else 4.dp
                val bottom = if (index == models.lastIndex) 20.dp else 4.dp
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(top, top, bottom, bottom))
                        .background(KmColors.surface)
                        .pressableScale(onClick = { onSelect(model); onClose() }, pressedOpacity = 0.8f, onClickLabel = model.label)
                        .padding(horizontal = 17.dp, vertical = 13.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                model.label,
                                style = KmType.body.copy(fontSize = 17.sp),
                                color = if (model.available) KmColors.text else KmColors.textSecondary,
                            )
                            model.badgeLabel?.let { badge ->
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    badge,
                                    style = KmType.caption,
                                    color = KmColors.text,
                                    modifier = Modifier
                                        .clip(CircleShape)
                                        .background(KmColors.surfaceElevated)
                                        .padding(horizontal = 8.dp, vertical = 2.dp),
                                )
                            }
                        }
                        Text(model.providerName, style = KmType.subhead.copy(fontWeight = FontWeight.Normal), color = KmColors.textSecondary, modifier = Modifier.padding(top = 3.dp))
                    }
                    if (active) KmIcon(KmIcons.Check, KmColors.info, 23.dp)
                }
            }
        }
        if (models.isEmpty()) {
            Text(
                "Kullanılabilir model bulunamadı.",
                style = KmType.subhead,
                color = KmColors.textMuted,
                modifier = Modifier.fillMaxWidth().padding(vertical = KmSpace.xl),
            )
        }
    }
}
