package com.tyler.kocamind.data.auth

import android.content.Context

/**
 * E-postası doğrulanmış kullanıcı için hoş geldin mailini bir kez ister (Google ile girenler dahil).
 * Sunucu da tekrarı engeller; bu yerel kayıt gereksiz istekleri önler. Gönderilemezse sonraki girişte yeniden dener.
 */
class WelcomeEmail(private val store: Store, private val request: suspend () -> Boolean) {
    interface Store {
        fun isDone(uid: String): Boolean
        fun markDone(uid: String)
    }

    suspend fun onVerifiedSignIn(uid: String) {
        if (store.isDone(uid)) return
        if (runCatching { request() }.getOrDefault(false)) store.markDone(uid)
    }

    class PrefsStore(context: Context) : Store {
        private val prefs = context.getSharedPreferences("kocamind", Context.MODE_PRIVATE)
        override fun isDone(uid: String) = uid in prefs.getStringSet(KEY, emptySet()).orEmpty()
        override fun markDone(uid: String) {
            prefs.edit().putStringSet(KEY, prefs.getStringSet(KEY, emptySet()).orEmpty() + uid).apply()
        }

        private companion object {
            const val KEY = "welcome_email_uids"
        }
    }
}
