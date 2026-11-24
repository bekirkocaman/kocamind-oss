package com.tyler.kocamind.ui.nav

import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.tyler.kocamind.data.auth.AuthUser
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AuthGateTest {
    @get:Rule
    val composeRule = createComposeRule()

    private fun user(verified: Boolean) = AuthUser(uid = "u1", email = "a@b.c", displayName = "A", photoUrl = null, emailVerified = verified)

    @Test
    fun signInRequired_forGuestAndUnverified() {
        assertTrue(requiresSignIn(null))
        assertTrue(requiresSignIn(user(verified = false)))
        assertFalse(requiresSignIn(user(verified = true)))
    }

    @Test
    fun gate_swapsBetweenAuthAndApp() {
        var current by mutableStateOf<AuthUser?>(null)
        composeRule.setContent { AuthGate(current, auth = { Text("giriş") }) { Text("uygulama") } }
        composeRule.onNodeWithText("giriş").assertExists()
        composeRule.onNodeWithText("uygulama").assertDoesNotExist()
        current = user(verified = true)
        composeRule.onNodeWithText("uygulama").assertExists()
        composeRule.onNodeWithText("giriş").assertDoesNotExist()
        current = null
        composeRule.onNodeWithText("giriş").assertExists()
    }
}
