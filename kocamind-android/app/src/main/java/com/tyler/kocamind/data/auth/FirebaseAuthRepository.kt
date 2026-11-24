package com.tyler.kocamind.data.auth

import android.util.Log
import com.google.firebase.FirebaseException
import com.google.firebase.FirebaseNetworkException
import com.google.firebase.FirebaseTooManyRequestsException
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseAuthException
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.GoogleAuthProvider
import com.google.firebase.auth.userProfileChangeRequest
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.SetOptions
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.tasks.await
import java.time.Instant

/** `ERROR_INVALID_CREDENTIAL` → `auth/invalid-credential` (JS SDK biçimi). */
internal fun firebaseErrorCodeToJs(code: String): String =
    "auth/" + code.removePrefix("ERROR_").lowercase().replace('_', '-')

class FirebaseAuthRepository(
    private val auth: FirebaseAuth,
    private val firestore: FirebaseFirestore,
    /** Tasarımlı kimlik e-postaları için sunucu; yoksa ya da gönderemezse Firebase'in maili kullanılır. */
    private val mailer: () -> AuthMailer? = { null },
) : AuthRepository {

    private val user = MutableStateFlow(auth.currentUser?.toAuthUser())
    override val currentUser: StateFlow<AuthUser?> = user

    init {
        auth.addAuthStateListener { user.value = it.currentUser?.toAuthUser() }
    }

    override suspend fun signInWithEmail(email: String, password: String): AuthUser = mapErrors {
        val result = auth.signInWithEmailAndPassword(email, password).await()
        requireNotNull(result.user).toAuthUser()
    }

    override suspend fun createAccount(email: String, password: String, displayName: String): AuthUser = mapErrors {
        val created = requireNotNull(auth.createUserWithEmailAndPassword(email, password).await().user)
        created.updateProfile(userProfileChangeRequest { this.displayName = displayName }).await()
        // Profil belgesi kayıt için şart değil: yazılamazsa hesap yine oluşmuş olur.
        runCatching {
            firestore.collection("users").document(created.uid).set(
                mapOf(
                    "uid" to created.uid,
                    "email" to created.email,
                    "name" to displayName,
                    "createdAt" to Instant.now().toString(),
                ),
                SetOptions.merge(),
            ).await()
        }.onFailure { Log.w(TAG, "users/{uid} profil belgesi yazılamadı", it) }
        AuthUser(created.uid, created.email, displayName, created.isEmailVerified)
    }

    override suspend fun updateDisplayName(name: String) = mapErrors {
        val current = auth.currentUser ?: throw AuthException("auth/no-current-user", "Oturum bulunamadı.")
        current.updateProfile(userProfileChangeRequest { displayName = name }).await()
        current.reload().await()
        user.value = (auth.currentUser ?: current).toAuthUser()
        // Profil belgesindeki ad da eşitlenir; yazılamazsa giriş adı yine değişmiş olur.
        runCatching {
            firestore.collection("users").document(current.uid).set(mapOf("name" to name), SetOptions.merge()).await()
        }.onFailure { Log.w(TAG, "users/{uid} adı güncellenemedi", it) }
        Unit
    }

    override suspend fun sendEmailVerification() = mapErrors {
        val current = auth.currentUser ?: throw AuthException("auth/no-current-user", "Oturum bulunamadı.")
        sendWithFallback(primary = { mailer()?.sendVerificationEmail() ?: false }) { current.sendEmailVerification().await() }
    }

    override suspend fun sendPasswordReset(email: String) = mapErrors {
        sendWithFallback(primary = { mailer()?.sendPasswordResetEmail(email) ?: false }) { auth.sendPasswordResetEmail(email).await() }
    }

    override suspend fun signInWithGoogleIdToken(idToken: String): AuthUser = mapErrors {
        val credential = GoogleAuthProvider.getCredential(idToken, null)
        requireNotNull(auth.signInWithCredential(credential).await().user).toAuthUser()
    }

    override suspend fun idToken(): String? =
        auth.currentUser?.let { mapErrors { it.getIdToken(false).await().token } }

    override suspend fun isAdmin(): Boolean =
        auth.currentUser?.let { mapErrors { it.getIdToken(false).await().claims["admin"] == true } } ?: false

    override suspend fun isDeletionPending(): Boolean =
        auth.currentUser?.let { mapErrors { it.getIdToken(false).await().claims["deletionPending"] == true } } ?: false

    override suspend fun refreshToken() {
        auth.currentUser?.let { mapErrors { it.getIdToken(true).await() } }
    }

    override fun signOut() = auth.signOut()

    private inline fun <T> mapErrors(block: () -> T): T = try {
        block()
    } catch (e: AuthException) {
        throw e
    } catch (e: FirebaseAuthException) {
        throw AuthException(firebaseErrorCodeToJs(e.errorCode), e.message)
    } catch (e: FirebaseNetworkException) {
        throw AuthException("auth/network-request-failed", e.message)
    } catch (e: FirebaseTooManyRequestsException) {
        throw AuthException("auth/too-many-requests", e.message)
    } catch (e: FirebaseException) {
        throw AuthException("auth/unknown", e.message)
    }

    private companion object {
        const val TAG = "FirebaseAuthRepository"
    }
}

private fun FirebaseUser.toAuthUser() = AuthUser(uid, email, displayName, isEmailVerified, photoUrl?.toString())
