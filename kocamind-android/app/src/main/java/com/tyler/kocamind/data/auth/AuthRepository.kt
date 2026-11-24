package com.tyler.kocamind.data.auth

import kotlinx.coroutines.flow.StateFlow

interface AuthRepository {
    val currentUser: StateFlow<AuthUser?>
    suspend fun signInWithEmail(email: String, password: String): AuthUser
    suspend fun createAccount(email: String, password: String, displayName: String): AuthUser
    suspend fun sendEmailVerification()
    suspend fun sendPasswordReset(email: String)
    suspend fun signInWithGoogleIdToken(idToken: String): AuthUser

    /** Giriş yoksa null. */
    suspend fun idToken(): String?

    /** ID token'daki `admin` custom claim'i. */
    suspend fun isAdmin(): Boolean

    /** ID token'daki `deletionPending` claim'i: hesap 60 günlük silme beklemesinde ve kilitli. */
    suspend fun isDeletionPending(): Boolean = false

    /** Claim'ler sunucuda değişince (ör. hesap geri alındı) token'ı yeniler. */
    suspend fun refreshToken() = Unit
    fun signOut()

    /** Ayarlar > Profil: görünen adı değiştirir. */
    suspend fun updateDisplayName(name: String): Unit =
        throw AuthException("auth/unsupported", "Ad bu oturumda değiştirilemiyor.")
}

/** `code` JS SDK ile aynı biçimde: `auth/invalid-credential` gibi. */
class AuthException(val code: String, message: String?) : Exception(message)
