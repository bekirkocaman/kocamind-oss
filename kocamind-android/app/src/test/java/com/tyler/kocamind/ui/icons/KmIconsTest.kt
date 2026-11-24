package com.tyler.kocamind.ui.icons

import androidx.compose.ui.graphics.vector.ImageVector
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class KmIconsTest {
    private val icons: Map<String, ImageVector> =
        KmIcons::class.java.declaredMethods
            .filter { it.name.startsWith("get") && it.returnType == ImageVector::class.java && it.parameterCount == 0 }
            .associate { it.name.removePrefix("get") to it.invoke(KmIcons) as ImageVector }

    @Test
    fun everyIcon_buildsOnPhosphorGrid() {
        assertTrue(icons.size >= 60)
        icons.forEach { (name, icon) ->
            assertEquals(name, 256f, icon.viewportWidth)
            assertTrue(name, icon.root.size > 0)
        }
    }

    /** Yapay zekâ klişesi semboller (parıltı, robot kafası, çip) kullanılmaz. */
    @Test
    fun noAiClicheSymbols() {
        listOf("Sparkles", "Sparkle", "Bot", "Robot", "Cpu").forEach { assertFalse(it, it in icons) }
    }
}
