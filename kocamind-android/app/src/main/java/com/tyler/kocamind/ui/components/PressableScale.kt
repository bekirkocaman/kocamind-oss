package com.tyler.kocamind.ui.components

import android.provider.Settings
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.composed
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import com.tyler.kocamind.ui.theme.KmMotion

/** Uygulama içi "Azaltılmış hareket" ayarı (ThemeHost sağlar). */
val LocalAppReduceMotion = staticCompositionLocalOf { false }

/** Sistem animasyonları kapalıysa (erişilebilirlik) ya da uygulama ayarı açıksa true. RN `useReducedMotion` karşılığı. */
@Composable
fun rememberReduceMotion(): Boolean {
    val resolver = LocalContext.current.contentResolver
    val system = remember(resolver) {
        runCatching { Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }
            .getOrDefault(false)
    }
    return system || LocalAppReduceMotion.current
}

/**
 * Uzun basmanın ekran konumunu da veren PressableScale (drawer bağlam menüsü için).
 * [onLongPress] pencere koordinatında konum alır.
 */
fun Modifier.pressableScaleWithPosition(
    onClick: () -> Unit,
    onLongPress: (Offset) -> Unit,
    pressedOpacity: Float = 1f,
): Modifier = composed {
    var pressed by remember { mutableStateOf(false) }
    var origin by remember { mutableStateOf(Offset.Zero) }
    val reduceMotion = rememberReduceMotion()
    val progress by animateFloatAsState(
        targetValue = if (pressed) 1f else 0f,
        animationSpec = if (reduceMotion) tween(0) else tween(KmMotion.FAST, easing = KmMotion.standard),
        label = "press",
    )
    this
        .onGloballyPositioned { origin = it.positionInWindow() }
        .graphicsLayer {
            val scale = 1f - progress * (1f - KmMotion.PRESS_SCALE)
            scaleX = scale
            scaleY = scale
            alpha = 1f - progress * (1f - pressedOpacity)
        }
        .semantics { role = Role.Button }
        .pointerInput(Unit) {
            detectTapGestures(
                onPress = {
                    pressed = true
                    tryAwaitRelease()
                    pressed = false
                },
                onTap = { onClick() },
                onLongPress = { onLongPress(origin + it) },
            )
        }
}

/**
 * PressableScale karşılığı: basılıyken 0.97'ye küçülür, isteğe bağlı saydamlaşır.
 * Ripple yok (eski uygulamada da yoktu). Devre dışıyken %50 saydam.
 */
@OptIn(ExperimentalFoundationApi::class)
fun Modifier.pressableScale(
    onClick: () -> Unit,
    enabled: Boolean = true,
    pressedOpacity: Float = 1f,
    onLongClick: (() -> Unit)? = null,
    role: Role? = Role.Button,
    onClickLabel: String? = null,
): Modifier = composed {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val reduceMotion = rememberReduceMotion()
    val progress by animateFloatAsState(
        targetValue = if (pressed && enabled) 1f else 0f,
        animationSpec = if (reduceMotion) tween(0) else tween(KmMotion.FAST, easing = KmMotion.standard),
        label = "press",
    )
    this
        .graphicsLayer {
            val scale = 1f - progress * (1f - KmMotion.PRESS_SCALE)
            scaleX = scale
            scaleY = scale
            alpha = if (!enabled) 0.5f else 1f - progress * (1f - pressedOpacity)
        }
        .combinedClickable(
            interactionSource = interaction,
            indication = null,
            enabled = enabled,
            role = role,
            onClickLabel = onClickLabel,
            onLongClick = onLongClick,
            onClick = onClick,
        )
}
