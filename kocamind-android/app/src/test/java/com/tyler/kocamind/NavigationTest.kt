package com.tyler.kocamind

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.tyler.kocamind.ui.nav.KocaMindAppShell
import com.tyler.kocamind.ui.nav.SignedInShell
import com.tyler.kocamind.ui.theme.KocaMindTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NavigationTest {
    @get:Rule
    val composeRule = createComposeRule()

    private fun launchApp() {
        composeRule.setContent { KocaMindTheme { SignedInShell() } }
    }

    @Test
    fun guest_seesOnlySignIn_withoutMenuOrBack() {
        composeRule.setContent { KocaMindTheme { KocaMindAppShell() } }
        composeRule.onNodeWithTag("screen-auth").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("Menüyü aç").assertDoesNotExist()
        composeRule.onNodeWithContentDescription("Geri dön").assertDoesNotExist()
    }

    @Test
    fun drawer_settingsButtonOpensSettings() {
        launchApp()
        composeRule.onNodeWithTag("screen-chat").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("Menüyü aç").performClick()
        composeRule.onNodeWithContentDescription("Ayarlar").performClick()
        composeRule.onNodeWithTag("screen-settings").assertIsDisplayed()
    }

    @Test
    fun drawer_libraryOpensLibrary() {
        launchApp()
        composeRule.onNodeWithContentDescription("Menüyü aç").performClick()
        composeRule.onNodeWithText("Kitaplık").performClick()
        composeRule.onNodeWithTag("screen-library").assertIsDisplayed()
    }
}
