package com.tyler.kocamind.ui.auth

import com.tyler.kocamind.data.auth.AuthException
import com.tyler.kocamind.data.auth.FakeAuthRepository
import com.tyler.kocamind.data.auth.GoogleResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AuthViewModelTest {
    private val fake = FakeAuthRepository()
    private lateinit var vm: AuthViewModel

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        vm = AuthViewModel(fake)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    /** Olayları toplar; [action] bittiğinde toplanan listeyi döner. */
    private fun TestScope.events(action: () -> Unit): List<AuthEvent> {
        val out = mutableListOf<AuthEvent>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { vm.events.collect { out += it } }
        action()
        return out
    }

    @Test
    fun emptyFields_emitsMissingInfo() = runTest {
        val got = events { vm.submit(AuthTab.Login, "", " ", "") }
        assertEquals(listOf(AuthEvent.Error("Eksik Bilgi", "Lütfen e-posta ve şifrenizi girin.")), got)
        assertNull(fake.lastEmail)
    }

    @Test
    fun registerWithoutName_emitsMissingName() = runTest {
        val got = events { vm.submit(AuthTab.Register, "  ", "a@b.com", "123456") }
        assertEquals(listOf(AuthEvent.Error("Eksik Bilgi", "Lütfen adınızı girin.")), got)
    }

    @Test
    fun invalidEmail_emitsInvalidEmail() = runTest {
        val got = events { vm.submit(AuthTab.Login, "", "ali@gmail", "123456") }
        assertEquals(
            listOf(AuthEvent.Error("Geçersiz E-posta", "Lütfen geçerli bir e-posta adresi girin.\nÖrnek: isim@gmail.com")),
            got,
        )
    }

    @Test
    fun email_isTrimmed() = runTest {
        events { vm.submit(AuthTab.Login, "", "  a@b.com ", "123456") }
        assertEquals("a@b.com", fake.lastEmail)
    }

    @Test
    fun verifiedLogin_emitsSignedIn() = runTest {
        val got = events { vm.submit(AuthTab.Login, "", "a@b.com", "123456") }
        assertEquals(listOf(AuthEvent.SignedIn), got)
        assertFalse(fake.signOutCalled)
        assertFalse(vm.isLoading.value)
    }

    @Test
    fun unverifiedEmail_signsOutAndReturnsNeedsVerification() = runTest {
        fake.nextUser = fake.nextUser.copy(emailVerified = false)
        val got = events { vm.submit(AuthTab.Login, "", "a@b.com", "123456") }
        assertEquals(listOf(AuthEvent.NeedsVerification("a@b.com")), got)
        assertTrue(fake.signOutCalled)
    }

    @Test
    fun register_sendsVerificationAndSignsOut() = runTest {
        val got = events { vm.submit(AuthTab.Register, " Ali ", "a@b.com", "123456") }
        assertEquals(listOf(AuthEvent.VerificationSent("a@b.com")), got)
        assertEquals("Ali", fake.lastDisplayName)
        assertTrue(fake.verificationSent)
        assertTrue(fake.signOutCalled)
    }

    @Test
    fun repoError_emitsTurkishMessage() = runTest {
        fake.nextError = AuthException("auth/invalid-credential", "raw")
        val got = events { vm.submit(AuthTab.Login, "", "a@b.com", "123456") }
        assertEquals(listOf(AuthEvent.Error("Hata", "E-posta veya şifre hatalı.")), got)
        assertFalse(vm.isLoading.value)
    }

    @Test
    fun errorCodes_mapToTurkish() {
        assertEquals("Bu e-posta zaten kullanımda.", authErrorMessage("auth/email-already-in-use"))
        assertEquals("E-posta veya şifre hatalı.", authErrorMessage("auth/invalid-credential"))
        assertEquals("E-posta veya şifre hatalı.", authErrorMessage("auth/wrong-password"))
        assertEquals("Şifre en az 6 karakter olmalı.", authErrorMessage("auth/weak-password"))
        assertEquals("Geçersiz e-posta adresi.", authErrorMessage("auth/invalid-email"))
        assertEquals("E-posta girişi henüz etkinleştirilmemiş.", authErrorMessage("auth/operation-not-allowed"))
        assertEquals("Bu e-posta adresiyle kayıtlı bir kullanıcı bulunamadı.", authErrorMessage("auth/user-not-found"))
        assertEquals("Bilinmeyen bir hata oluştu.", authErrorMessage("auth/something-else"))
        assertEquals("Ham mesaj", authErrorMessage("auth/something-else", "Ham mesaj"))
    }

    @Test
    fun resetWithoutEmail_emitsMissingInfo() = runTest {
        val got = events { vm.resetPassword("  ") }
        assertEquals(
            listOf(
                AuthEvent.Error(
                    "Eksik Bilgi",
                    "Lütfen şifresini sıfırlamak istediğiniz e-posta adresini yukarıdaki E-posta kutusuna girin.",
                ),
            ),
            got,
        )
    }

    @Test
    fun reset_sendsTrimmedEmail() = runTest {
        val got = events { vm.resetPassword(" a@b.com ") }
        assertEquals(listOf(AuthEvent.ResetSent), got)
        assertEquals("a@b.com", fake.resetEmail)
    }

    @Test
    fun unexpectedException_emitsGenericErrorInsteadOfCrashing() = runTest {
        fake.nextError = IllegalStateException("beklenmedik")
        val got = events { vm.submit(AuthTab.Login, "", "a@b.com", "123456") }
        assertEquals(listOf(AuthEvent.Error("Hata", "beklenmedik")), got)
        assertFalse(vm.isLoading.value)
    }

    @Test
    fun tooManyRequests_mapsToTurkish() {
        assertEquals("Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar dene.", authErrorMessage("auth/too-many-requests"))
    }

    @Test
    fun register_verificationFails_stillSignsOut() = runTest {
        fake.verificationError = AuthException("auth/too-many-requests", "raw")
        val got = events { vm.submit(AuthTab.Register, "Ali", "a@b.com", "123456") }
        assertEquals(listOf(AuthEvent.Error("Hata", "Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar dene.")), got)
        assertTrue(fake.signOutCalled)
    }

    @Test
    fun resend_verificationFails_stillSignsOut() = runTest {
        fake.nextUser = fake.nextUser.copy(emailVerified = false)
        fake.verificationError = AuthException("auth/too-many-requests", "raw")
        events { vm.resendVerification("a@b.com", "123456") }
        assertTrue(fake.signOutCalled)
    }

    @Test
    fun cancelled_isSilent() = runTest {
        val got = events { vm.onGoogleResult(GoogleResult.Cancelled) }
        assertEquals(emptyList<AuthEvent>(), got)
        assertFalse(vm.isLoading.value)
        assertNull(fake.lastGoogleToken)
    }

    @Test
    fun failed_emitsGoogleError() = runTest {
        val got = events { vm.onGoogleResult(GoogleResult.Failed("Olmadı")) }
        assertEquals(listOf(AuthEvent.Error("Google Giriş Hatası", "Olmadı")), got)
    }

    @Test
    fun token_signsIn() = runTest {
        val got = events { vm.onGoogleResult(GoogleResult.Token("tok")) }
        assertEquals(listOf(AuthEvent.SignedIn), got)
        assertEquals("tok", fake.lastGoogleToken)
        assertFalse(vm.isLoading.value)
    }

    @Test
    fun token_repoError_emitsGoogleError() = runTest {
        fake.nextError = AuthException("auth/network-request-failed", "Ağ hatası")
        val got = events { vm.onGoogleResult(GoogleResult.Token("tok")) }
        assertEquals(listOf(AuthEvent.Error("Google Giriş Hatası", "Ağ hatası")), got)
    }

    @Test
    fun resendVerification_signsInSendsAndSignsOut() = runTest {
        fake.nextUser = fake.nextUser.copy(emailVerified = false)
        val got = events { vm.resendVerification(" a@b.com ", "123456") }
        assertEquals(listOf(AuthEvent.Notice("Gönderildi", "Doğrulama e-postası tekrar gönderildi.")), got)
        assertEquals("a@b.com", fake.lastEmail)
        assertTrue(fake.verificationSent)
        assertTrue(fake.signOutCalled)
    }
}
