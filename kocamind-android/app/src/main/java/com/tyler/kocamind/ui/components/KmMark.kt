package com.tyler.kocamind.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.tyler.kocamind.ui.theme.KmColors
import com.tyler.kocamind.ui.theme.KmMotion
import kotlin.math.PI
import kotlin.math.sin

/** Canlı KocaMind işaretinin durumları. */
enum class MarkState { Idle, Think, Stream, Done }

/**
 * Dört noktalı KocaMind işareti. Düşünürken döner ve nefes alır, yazarken yavaşlar,
 * bitince küçük bir sekmeyle yerine oturur. Azaltılmış harekette durağandır.
 */
@Composable
fun KmMark(
    state: MarkState,
    modifier: Modifier = Modifier,
    size: Dp = 22.dp,
    accent: Color = KmColors.brand,
    ink: Color = KmColors.text,
) {
    val reduce = rememberReduceMotion()
    val moving = !reduce && (state == MarkState.Think || state == MarkState.Stream)
    val transition = rememberInfiniteTransition(label = "mark")
    val period = if (state == MarkState.Think) 1500 else 3400
    val spin by transition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(period, easing = if (state == MarkState.Think) KmMotion.standard else LinearEasing)),
        label = "spin",
    )
    val phase by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(if (state == MarkState.Think) 1500 else 1700, easing = LinearEasing), RepeatMode.Restart),
        label = "phase",
    )
    // Bitişte: geri dönüp hafifçe büyüyerek yerine oturur.
    val settle = remember { Animatable(1f) }
    val settleTurn = remember { Animatable(0f) }
    LaunchedEffect(state) {
        if (state == MarkState.Done && !reduce) {
            settle.snapTo(0.7f); settleTurn.snapTo(-60f)
            settleTurn.animateTo(0f, tween(700, easing = KmMotion.decelerate))
        }
    }
    LaunchedEffect(state) {
        if (state == MarkState.Done && !reduce) {
            settle.animateTo(1f, keyframes { durationMillis = 700; 1.12f at 420 })
        }
    }

    Canvas(modifier.size(size).semantics { contentDescription = "KocaMind" }) {
        val u = this.size.minDimension / 24f
        val gather = if (moving && state == MarkState.Stream) 0.74f else 1f
        val angle = when {
            moving -> spin
            state == MarkState.Done -> settleTurn.value
            else -> 0f
        }
        val scale = if (state == MarkState.Done) settle.value else 1f
        rotate(angle) {
            val centers = listOf(Offset(12f, 5f), Offset(19f, 12f), Offset(12f, 19f), Offset(5f, 12f))
            centers.forEachIndexed { i, c ->
                val pulse = if (moving) {
                    val t = (phase + i * 0.25f) % 1f
                    1f - 0.58f * ((sin(t * 2 * PI) + 1) / 2).toFloat()
                } else {
                    1f
                }
                val cx = 12f + (c.x - 12f) * gather * scale
                val cy = 12f + (c.y - 12f) * gather * scale
                drawCircle(
                    color = if (i == 0) accent else ink,
                    radius = 3f * u * pulse * scale.coerceAtMost(1.05f),
                    center = Offset(cx * u, cy * u),
                )
            }
        }
    }
}
