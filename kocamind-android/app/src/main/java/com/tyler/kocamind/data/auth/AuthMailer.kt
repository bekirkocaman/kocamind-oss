package com.tyler.kocamind.data.auth

import kotlin.coroutines.cancellation.CancellationException

/**
 * Kimlik e-postalarını KocaMind tasarımıyla gönderen sunucu (Firebase doğrulama mailinin metnini kilitler).
 * true: mail gönderildi. false: gönderilemedi, çağıran Firebase'in kendi mailine dönmeli.
 */
interface AuthMailer {
    suspend fun sendPasswordResetEmail(email: String): Boolean
    suspend fun sendVerificationEmail(): Boolean
}

/** Önce [primary]; göndermediyse ya da hata verdiyse [fallback]. Kullanıcı her durumda maili alır. */
suspend fun sendWithFallback(primary: suspend () -> Boolean, fallback: suspend () -> Unit) {
    val sent = try {
        primary()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        false
    }
    if (!sent) fallback()
}
