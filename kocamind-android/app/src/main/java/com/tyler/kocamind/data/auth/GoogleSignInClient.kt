package com.tyler.kocamind.data.auth

import android.app.Activity
import android.util.Log
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException

sealed interface GoogleResult {
    data class Token(val idToken: String) : GoogleResult
    data object Cancelled : GoogleResult
    data class Failed(val message: String) : GoogleResult
}

interface GoogleSignInClient {
    suspend fun requestIdToken(activity: Activity): GoogleResult
}

/** Google hesap seçicisini Credential Manager ile açar. */
class CredentialManagerGoogleSignInClient : GoogleSignInClient {
    override suspend fun requestIdToken(activity: Activity): GoogleResult {
        val option = GetGoogleIdOption.Builder()
            .setServerClientId(WEB_CLIENT_ID)
            .setFilterByAuthorizedAccounts(false)
            .build()
        val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
        return try {
            val credential = CredentialManager.create(activity).getCredential(activity, request).credential
            if (credential is CustomCredential && credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                GoogleResult.Token(GoogleIdTokenCredential.createFrom(credential.data).idToken)
            } else {
                Log.w(TAG, "Beklenmeyen kimlik türü: ${credential.type}")
                GoogleResult.Failed(DEFAULT_ERROR)
            }
        } catch (e: GetCredentialCancellationException) {
            GoogleResult.Cancelled
        } catch (e: GetCredentialException) {
            Log.w(TAG, "Google kimliği alınamadı", e)
            GoogleResult.Failed(DEFAULT_ERROR)
        } catch (e: GoogleIdTokenParsingException) {
            Log.w(TAG, "Google kimliği çözümlenemedi", e)
            GoogleResult.Failed(DEFAULT_ERROR)
        }
    }

    private companion object {
        const val TAG = "GoogleSignIn"

        /** kocamind-mobil/src/app/auth.tsx:36 içindeki web client ID. */
        const val WEB_CLIENT_ID = "956051927831-jmel0ke1knjvenfemc1bmd0o1dg15k9l.apps.googleusercontent.com"
        const val DEFAULT_ERROR = "Google ile giriş tamamlanamadı. Lütfen tekrar dene."
    }
}
