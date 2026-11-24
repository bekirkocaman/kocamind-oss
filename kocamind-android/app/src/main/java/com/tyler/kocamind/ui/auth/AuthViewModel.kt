package com.tyler.kocamind.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.tyler.kocamind.data.auth.AuthException
import com.tyler.kocamind.data.auth.AuthRepository
import com.tyler.kocamind.data.auth.GoogleResult
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch

enum class AuthTab { Login, Register }

sealed interface AuthEvent {
    data class Error(val title: String, val message: String) : AuthEvent
    data class Notice(val title: String, val message: String) : AuthEvent
    data class NeedsVerification(val email: String) : AuthEvent
    data class VerificationSent(val email: String) : AuthEvent
    data object ResetSent : AuthEvent
    data object SignedIn : AuthEvent
}

/** Davranış kocamind-mobil/src/app/auth.tsx (handleSubmit, handleForgotPassword) ile aynı. */
class AuthViewModel(private val repo: AuthRepository) : ViewModel() {
    private val _events = Channel<AuthEvent>(Channel.BUFFERED)
    val events: Flow<AuthEvent> = _events.receiveAsFlow()

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading

    fun submit(tab: AuthTab, name: String, email: String, password: String) {
        val trimmedEmail = email.trim()
        if (trimmedEmail.isEmpty() || password.isEmpty()) {
            return emit(AuthEvent.Error("Eksik Bilgi", "Lütfen e-posta ve şifrenizi girin."))
        }
        if (tab == AuthTab.Register && name.isBlank()) {
            return emit(AuthEvent.Error("Eksik Bilgi", "Lütfen adınızı girin."))
        }
        if (!isValidEmail(trimmedEmail)) {
            return emit(AuthEvent.Error("Geçersiz E-posta", "Lütfen geçerli bir e-posta adresi girin.\nÖrnek: isim@gmail.com"))
        }
        launchLoading {
            when (tab) {
                AuthTab.Login -> {
                    val user = repo.signInWithEmail(trimmedEmail, password)
                    if (!user.emailVerified) {
                        repo.signOut()
                        emit(AuthEvent.NeedsVerification(trimmedEmail))
                    } else {
                        emit(AuthEvent.SignedIn)
                    }
                }
                AuthTab.Register -> {
                    repo.createAccount(trimmedEmail, password, name.trim())
                    // Doğrulanmamış kullanıcı hata olsa da oturumda kalmamalı.
                    try {
                        repo.sendEmailVerification()
                    } finally {
                        repo.signOut()
                    }
                    emit(AuthEvent.VerificationSent(trimmedEmail))
                }
            }
        }
    }

    fun resendVerification(email: String, password: String) {
        launchLoading {
            repo.signInWithEmail(email.trim(), password)
            try {
                repo.sendEmailVerification()
            } finally {
                repo.signOut()
            }
            emit(AuthEvent.Notice("Gönderildi", "Doğrulama e-postası tekrar gönderildi."))
        }
    }

    fun resetPassword(email: String) {
        val trimmedEmail = email.trim()
        if (trimmedEmail.isEmpty()) {
            return emit(
                AuthEvent.Error(
                    "Eksik Bilgi",
                    "Lütfen şifresini sıfırlamak istediğiniz e-posta adresini yukarıdaki E-posta kutusuna girin.",
                ),
            )
        }
        if (!isValidEmail(trimmedEmail)) {
            return emit(AuthEvent.Error("Geçersiz E-posta", "Lütfen geçerli bir e-posta adresi girin."))
        }
        launchLoading {
            repo.sendPasswordReset(trimmedEmail)
            emit(AuthEvent.ResetSent)
        }
    }

    /** Hesap seçicinin sonucu. İptal sessizdir: hata gösterilmez. */
    fun onGoogleResult(result: GoogleResult) {
        when (result) {
            GoogleResult.Cancelled -> Unit
            is GoogleResult.Failed -> emit(AuthEvent.Error(GOOGLE_ERROR_TITLE, result.message))
            is GoogleResult.Token -> launchLoading(errorTitle = GOOGLE_ERROR_TITLE) {
                repo.signInWithGoogleIdToken(result.idToken)
                emit(AuthEvent.SignedIn)
            }
        }
    }

    private fun emit(event: AuthEvent) {
        _events.trySend(event)
    }

    private fun launchLoading(errorTitle: String = "Hata", block: suspend () -> Unit) {
        if (_isLoading.value) return
        _isLoading.value = true
        viewModelScope.launch {
            try {
                block()
            } catch (e: AuthException) {
                emit(AuthEvent.Error(errorTitle, authErrorMessage(e.code, e.message)))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // Beklenmeyen hata uygulamayı çökertmesin.
                emit(AuthEvent.Error(errorTitle, e.message?.takeIf { it.isNotBlank() } ?: "Bilinmeyen bir hata oluştu."))
            } finally {
                _isLoading.value = false
            }
        }
    }

    private companion object {
        const val GOOGLE_ERROR_TITLE = "Google Giriş Hatası"
    }
}
