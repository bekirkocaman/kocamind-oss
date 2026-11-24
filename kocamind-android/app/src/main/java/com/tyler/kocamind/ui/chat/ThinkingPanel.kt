package com.tyler.kocamind.ui.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tyler.kocamind.ui.components.KmIcon
import com.tyler.kocamind.ui.components.pressableScale
import com.tyler.kocamind.ui.components.rememberReduceMotion
import com.tyler.kocamind.ui.icons.KmIcons
import com.tyler.kocamind.ui.theme.KmColors
import com.tyler.kocamind.ui.theme.KmMotion
import com.tyler.kocamind.ui.theme.KmSpace
import com.tyler.kocamind.ui.theme.KmType
import kotlinx.coroutines.delay
import kotlin.math.roundToInt

/** "4 saniye düşündü" metni; en az 1 saniye gösterilir. */
internal fun thoughtForLabel(ms: Long): String = "${(ms / 1000.0).roundToInt().coerceAtLeast(1)} saniye düşündü"

/**
 * Düşünme penceresi. Yanıt gelmeden önce açıktır: "Düşünüyor" ışıltısı, canlı sayaç ve
 * modelin düşünce özeti akar. İlk yanıt metni gelince "N saniye düşündü" olarak kapanır;
 * düşünce metni varsa dokununca yeniden açılır.
 */
@Composable
fun ThinkingPanel(
    messageId: String,
    active: Boolean,
    thinking: String?,
    thinkingMs: Long?,
    modifier: Modifier = Modifier,
) {
    val reduce = rememberReduceMotion()
    val hasText = !thinking.isNullOrBlank()
    var userOpen by rememberSaveable(messageId) { mutableStateOf(false) }
    val open = active || userOpen

    // Canlı sayaç: yalnız düşünürken saniyede birkaç kez güncellenir.
    val startedAt = remember(messageId) { System.currentTimeMillis() }
    var elapsed by remember(messageId) { mutableLongStateOf(0L) }
    LaunchedEffect(active) {
        while (active) {
            elapsed = System.currentTimeMillis() - startedAt
            delay(250)
        }
    }

    val chevron by animateFloatAsState(if (open) 0f else -90f, tween(if (reduce) 0 else KmMotion.SLOW, easing = KmMotion.standard), label = "chev")
    val label = if (active) "Düşünüyor" else thoughtForLabel(thinkingMs ?: elapsed)

    Column(modifier.fillMaxWidth().padding(bottom = KmSpace.sm)) {
        Row(
            Modifier
                .heightIn(min = 36.dp)
                .then(
                    if (!active && hasText) {
                        Modifier.pressableScale(onClick = { userOpen = !userOpen }, onClickLabel = if (userOpen) "Düşünceyi gizle" else "Düşünceyi göster")
                    } else {
                        Modifier
                    },
                )
                .semantics {
                    contentDescription = if (active) "Düşünüyor, ${elapsed / 1000} saniye" else label
                    if (!active && hasText) stateDescription = if (userOpen) "Açık" else "Kapalı"
                },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(KmSpace.sm),
        ) {
            if (active) ShimmerText(label, reduce) else Text(label, style = KmType.subhead, color = KmColors.textSecondary)
            if (active) Text("${elapsed / 1000} sn", style = KmType.footnote, color = KmColors.textMuted)
            if (!active && hasText) {
                KmIcon(KmIcons.ChevronDown, KmColors.textMuted, 15.dp, Modifier.graphicsLayer { rotationZ = chevron })
            }
        }
        AnimatedVisibility(
            visible = open && hasText,
            enter = fadeIn(tween(if (reduce) 0 else KmMotion.BASE)) + expandVertically(tween(if (reduce) 0 else KmMotion.SLOW, easing = KmMotion.standard)),
            exit = fadeOut(tween(if (reduce) 0 else KmMotion.FAST)) + shrinkVertically(tween(if (reduce) 0 else KmMotion.SLOW, easing = KmMotion.standard)),
        ) {
            ThoughtText(thinking.orEmpty(), live = active)
        }
    }
}

/** Sol çizgili düşünce metni. Canlıyken üstü solar ve en alta kendiliğinden kayar. */
@Composable
private fun ThoughtText(text: String, live: Boolean) {
    val scroll = rememberScrollState()
    LaunchedEffect(live) {
        if (live) snapshotFlow { scroll.maxValue }.collect { scroll.scrollTo(it) }
    }
    val line = KmColors.border
    Box(
        Modifier
            .padding(start = 1.dp, top = KmSpace.xs, bottom = KmSpace.xs)
            .drawBehind { drawLine(line, Offset(0f, 0f), Offset(0f, size.height), strokeWidth = 2.dp.toPx()) }
            .padding(start = KmSpace.md)
            .then(if (live) Modifier.heightIn(max = 132.dp) else Modifier)
            .then(
                if (live) {
                    Modifier
                        .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
                        .drawWithContent {
                            drawContent()
                            val fade = 40.dp.toPx() / size.height.coerceAtLeast(1f)
                            drawRect(
                                Brush.verticalGradient(0f to Color.Transparent, fade.coerceAtMost(1f) to Color.Black),
                                blendMode = BlendMode.DstIn,
                            )
                        }
                } else {
                    Modifier
                },
            )
            .then(if (live) Modifier.verticalScroll(scroll, enabled = false) else Modifier),
    ) {
        Text(text, style = KmType.footnote.copy(fontSize = 14.sp, lineHeight = 21.sp), color = KmColors.textMuted)
    }
}

/** "Düşünüyor" yazısı üzerinde soldan sağa akan ışıltı. */
@Composable
private fun ShimmerText(text: String, reduce: Boolean) {
    if (reduce) {
        Text(text, style = KmType.subhead, color = KmColors.textSecondary)
        return
    }
    val transition = rememberInfiniteTransition(label = "shimmer")
    val x by transition.animateFloat(
        initialValue = -1f,
        targetValue = 2f,
        animationSpec = infiniteRepeatable(tween(1600, easing = LinearEasing)),
        label = "shimmerX",
    )
    val base = KmColors.textMuted
    val shine = KmColors.text
    Text(
        text,
        style = KmType.subhead.copy(
            brush = Brush.linearGradient(
                colors = listOf(base, base, shine, base, base),
                start = Offset(x * 260f - 260f, 0f),
                end = Offset(x * 260f + 260f, 0f),
            ),
        ),
    )
}
