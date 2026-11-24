package com.tyler.kocamind.ui.theme

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.SpringSpec
import androidx.compose.animation.core.spring
import androidx.compose.ui.unit.dp

/** Köşe yuvarlaklığı: theme.ts içindeki radius ölçeği. */
object KmRadius {
    val sm = 8.dp
    val md = 12.dp
    val lg = 20.dp
    val xl = 28.dp
    val pill = 999.dp
}

/** Boşluk ölçeği: theme.ts `space`. */
object KmSpace {
    val xxs = 2.dp
    val xs = 4.dp
    val sm = 8.dp
    val md = 12.dp
    val lg = 16.dp
    val xl = 24.dp
    val xxl = 32.dp
    val xxxl = 48.dp
}

/** Hareket: theme.ts `motion` (süreler, eğriler, zıplamasız yay). */
object KmMotion {
    const val FAST = 150
    const val BASE = 220
    const val SLOW = 320

    val standard = CubicBezierEasing(0.2f, 0f, 0f, 1f)
    val decelerate = CubicBezierEasing(0f, 0f, 0f, 1f)
    val accelerate = CubicBezierEasing(0.3f, 0f, 1f, 1f)

    /** damping 28, stiffness 320, mass 1 → sönüm oranı 28 / (2·√320) ≈ 0.78; overshootClamping. */
    fun <T> spring(): SpringSpec<T> = spring(dampingRatio = 0.78f, stiffness = 320f)

    const val PRESS_SCALE = 0.97f
}

/** theme.ts `elevation` → Compose shadow yükseklikleri. */
object KmElevation {
    val sm = 2.dp
    val md = 6.dp
    val lg = 12.dp
}

/** theme.ts `layout`. */
object KmLayout {
    val maxContentWidth = 920.dp
    val minTouch = 44.dp
}
