package com.tyler.kocamind

import android.content.pm.ActivityInfo
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MainActivityTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Test
    fun appLaunches_withoutAccount_showsSignIn() {
        composeRule.onNodeWithTag("screen-auth").assertIsDisplayed()
    }

    @Test
    fun activity_isPortraitLikeOldApp() {
        val activity = composeRule.activity
        val info = activity.packageManager.getActivityInfo(android.content.ComponentName(activity, MainActivity::class.java), 0)
        assertEquals(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT, info.screenOrientation)
    }
}
