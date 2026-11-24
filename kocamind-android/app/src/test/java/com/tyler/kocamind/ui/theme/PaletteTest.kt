package com.tyler.kocamind.ui.theme

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

class PaletteTest {
    private fun channel(c: Float) = if (c <= 0.03928f) c / 12.92 else ((c + 0.055) / 1.055).pow(2.4)
    private fun luminance(c: Color) = 0.2126 * channel(c.red) + 0.7152 * channel(c.green) + 0.0722 * channel(c.blue)
    private fun contrast(a: Color, b: Color): Double {
        val la = luminance(a); val lb = luminance(b)
        return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
    }

    private fun check(name: String, p: KmPalette) {
        fun need(label: String, fg: Color, bg: Color, min: Double) {
            val r = contrast(fg, bg)
            assertTrue("$name $label kontrast $r < $min", r >= min)
        }
        need("text/bg", p.text, p.bg, 7.0)
        need("textSecondary/surface", p.textSecondary, p.surface, 4.5)
        need("textMuted/bg", p.textMuted, p.bg, 4.5)
        need("textMuted/surfaceElevated", p.textMuted, p.surfaceElevated, 4.5)
        need("textOnBrand/brand", p.textOnBrand, p.brand, 4.5)
    }

    @Test fun light_isReadable() = check("açık", LightPalette)
    @Test fun dark_isReadable() = check("koyu", DarkPalette)
}
