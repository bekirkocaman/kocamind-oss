package com.tyler.kocamind.data.auth

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** google-services.json olmadan derlenen sürüm: çökmez, her işlemde açık hata verir. */
class UnconfiguredAuthRepository : AuthRepository {
    override val currentUser: StateFlow<AuthUser?> = MutableStateFlow(null)

    private fun missing(): Nothing = throw AuthException(CODE, MESSAGE)

    override suspend fun signInWithEmail(email: String, password: String): AuthUser = missing()
    override suspend fun createAccount(email: String, password: String, displayName: String): AuthUser = missing()
    override suspend fun sendEmailVerification() = missing()
    override suspend fun sendPasswordReset(email: String) = missing()
    override suspend fun signInWithGoogleIdToken(idToken: String): AuthUser = missing()
    override suspend fun idToken(): String? = null
    override suspend fun isAdmin(): Boolean = false
    override fun signOut() = Unit

    companion object {
        const val CODE = "app/firebase-not-configured"
        const val MESSAGE = "Firebase yapılandırması eksik."
    }
}
