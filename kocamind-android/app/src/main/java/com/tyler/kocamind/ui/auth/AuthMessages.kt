package com.tyler.kocamind.ui.auth

/** Firebase hata kodunu Türkçe mesaja çevirir (kocamind-mobil/src/app/auth.tsx ile aynı metinler). */
fun authErrorMessage(code: String, fallback: String? = null): String = when (code) {
    "auth/email-already-in-use" -> "Bu e-posta zaten kullanımda."
    "auth/invalid-email" -> "Geçersiz e-posta adresi."
    "auth/wrong-password", "auth/invalid-credential" -> "E-posta veya şifre hatalı."
    "auth/weak-password" -> "Şifre en az 6 karakter olmalı."
    "auth/operation-not-allowed" -> "E-posta girişi henüz etkinleştirilmemiş."
    "auth/user-not-found" -> "Bu e-posta adresiyle kayıtlı bir kullanıcı bulunamadı."
    "auth/too-many-requests" -> "Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar dene."
    else -> fallback?.takeIf { it.isNotBlank() } ?: "Bilinmeyen bir hata oluştu."
}

private val EMAIL_REGEX = Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")

internal fun isValidEmail(email: String): Boolean = EMAIL_REGEX.matches(email)
