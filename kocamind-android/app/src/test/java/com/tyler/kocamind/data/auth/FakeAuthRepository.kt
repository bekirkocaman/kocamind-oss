package com.tyler.kocamind.data.auth

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Testler için bellek içi AuthRepository. Davranışı alanlarla ayarlanır, çağrılar kaydedilir. */
class FakeAuthRepository : AuthRepository {
    private val user = MutableStateFlow<AuthUser?>(null)
    override val currentUser: StateFlow<AuthUser?> = user

    /** Giriş yapıldığında dönecek kullanıcı. */
    var nextUser = AuthUser(uid = "u1", email = "a@b.com", displayName = "Ali", emailVerified = true)

    /** Doluysa sonraki işlem bu hatayı fırlatır. */
    var nextError: Exception? = null

    /** Doluysa sendEmailVerification bu hatayı fırlatır. */
    var verificationError: Exception? = null

    var token: String? = "tok"
    var signOutCalled = false
    var verificationSent = false
    var lastEmail: String? = null
    var lastPassword: String? = null
    var lastDisplayName: String? = null
    var lastGoogleToken: String? = null
    var resetEmail: String? = null

    private fun failIfNeeded() {
        nextError?.let { nextError = null; throw it }
    }

    override suspend fun signInWithEmail(email: String, password: String): AuthUser {
        lastEmail = email; lastPassword = password
        failIfNeeded()
        user.value = nextUser
        return nextUser
    }

    override suspend fun createAccount(email: String, password: String, displayName: String): AuthUser {
        lastEmail = email; lastPassword = password; lastDisplayName = displayName
        failIfNeeded()
        val created = nextUser.copy(email = email, displayName = displayName, emailVerified = false)
        user.value = created
        return created
    }

    override suspend fun sendEmailVerification() {
        failIfNeeded()
        verificationError?.let { verificationError = null; throw it }
        verificationSent = true
    }

    override suspend fun sendPasswordReset(email: String) {
        failIfNeeded()
        resetEmail = email
    }

    override suspend fun signInWithGoogleIdToken(idToken: String): AuthUser {
        lastGoogleToken = idToken
        failIfNeeded()
        user.value = nextUser
        return nextUser
    }

    override suspend fun idToken(): String? = if (user.value == null) null else token

    var admin = false
    override suspend fun isAdmin(): Boolean = user.value != null && admin

    override fun signOut() {
        signOutCalled = true
        user.value = null
    }
}
