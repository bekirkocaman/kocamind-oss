package com.tyler.kocamind.ui.chat

import org.junit.Assert.assertEquals
import org.junit.Test

class ThinkingPanelTest {
    @Test
    fun label_roundsToSeconds_andNeverShowsZero() {
        assertEquals("1 saniye düşündü", thoughtForLabel(0))
        assertEquals("1 saniye düşündü", thoughtForLabel(400))
        assertEquals("4 saniye düşündü", thoughtForLabel(3600))
        assertEquals("12 saniye düşündü", thoughtForLabel(12_200))
    }
}
