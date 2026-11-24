package com.tyler.kocamind.ui.icons

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** KmIcons'ta olmayan, elle çizilmiş birkaç ikon (üretilen dosyaya dokunmamak için ayrı). */
object ExtraIcons {
    /** Dikey üç nokta: "Diğer seçenekler". */
    val DotsVertical: ImageVector by lazy {
        ImageVector.Builder("DotsVertical", 24.dp, 24.dp, 24f, 24f).apply {
            path(fill = SolidColor(Color.Black)) {
                listOf(5f, 12f, 19f).forEach { y ->
                    moveTo(12f, y - 1.6f)
                    arcToRelative(1.6f, 1.6f, 0f, true, true, 0f, 3.2f)
                    arcToRelative(1.6f, 1.6f, 0f, true, true, 0f, -3.2f)
                    close()
                }
            }
        }.build()
    }
}
