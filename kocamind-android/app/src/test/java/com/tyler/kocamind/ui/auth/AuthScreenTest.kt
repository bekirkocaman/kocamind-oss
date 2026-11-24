package com.tyler.kocamind.ui.auth

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.tyler.kocamind.data.auth.FakeAuthRepository
import com.tyler.kocamind.ui.theme.KocaMindTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AuthScreenTest {
    @get:Rule
    val composeRule = createComposeRule()

    private val fake = FakeAuthRepository()
    private var signedIn = false

    private fun launch() {
        val vm = AuthViewModel(fake)
        composeRule.setContent {
            KocaMindTheme { AuthScreen(viewModel = vm, onSignedIn = { signedIn = true }) }
        }
    }

    private fun openEmailForm() {
        composeRule.onNodeWithText("E-posta ile devam et").performClick()
    }

    private fun fill(email: String, password: String) {
        composeRule.onNodeWithTag("auth-email").performTextInput(email)
        composeRule.onNodeWithTag("auth-password").performTextInput(password)
    }

    @Test
    fun verifiedLogin_callsOnSignedIn() {
        launch()
        openEmailForm()
        fill("a@b.com", "123456")
        composeRule.onNodeWithTag("auth-submit").performScrollTo().performClick()
        composeRule.waitForIdle()
        assertTrue(signedIn)
    }

    @Test
    fun unverifiedLogin_showsDialogWithResend() {
        fake.nextUser = fake.nextUser.copy(emailVerified = false)
        launch()
        openEmailForm()
        fill("a@b.com", "123456")
        composeRule.onNodeWithTag("auth-submit").performScrollTo().performClick()
        composeRule.onNodeWithText("E-posta Doğrulanmadı").assertIsDisplayed()
        composeRule.onNodeWithText("Tekrar Gönder").assertIsDisplayed()
    }

    @Test
    fun register_showsCheckEmailScreen() {
        launch()
        openEmailForm()
        composeRule.onNodeWithText("Kayıt Ol").performClick()
        composeRule.onNodeWithTag("auth-name").performTextInput("Ali")
        fill("a@b.com", "123456")
        composeRule.onNodeWithTag("auth-submit").performScrollTo().performClick()
        composeRule.onNodeWithText("E-postanı kontrol et").assertIsDisplayed()
    }

    /** Yeni kullanıcı önce sade karşılamayı görür; form yalnızca istenince açılır, geri ile kapanır. */
    @Test
    fun welcomeFirst_formOpensOnEmail_andBackReturns() {
        launch()
        composeRule.onNodeWithText("KocaMind").assertIsDisplayed()
        composeRule.onNodeWithText("Kullanım Koşulları", substring = true).assertExists()
        composeRule.onNodeWithTag("auth-email").assertDoesNotExist()
        openEmailForm()
        composeRule.onNodeWithTag("auth-email").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("Geri dön").performClick()
        composeRule.onNodeWithTag("auth-email").assertDoesNotExist()
        composeRule.onNodeWithText("E-posta ile devam et").assertIsDisplayed()
    }
}
