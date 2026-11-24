package com.tyler.kocamind.ui.components

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ReduceMotionTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun appSetting_turnsReduceMotionOn() {
        var off: Boolean? = null
        var on: Boolean? = null
        composeRule.setContent {
            off = rememberReduceMotion()
            CompositionLocalProvider(LocalAppReduceMotion provides true) { on = rememberReduceMotion() }
        }
        assertFalse(off!!)
        assertTrue(on!!)
    }
}
