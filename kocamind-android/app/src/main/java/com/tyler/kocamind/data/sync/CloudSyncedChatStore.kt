package com.tyler.kocamind.data.sync

import com.tyler.kocamind.data.chat.ChatStore
import com.tyler.kocamind.data.chat.StoredChat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * Yerel depoyu sarar: değişiklikleri giriş yapmış kullanıcının bulutuna da yazar.
 * Akış süren (yarım) sohbetler yüklenmez; bulut hatası yerel işlemi bozmaz (sonra yeniden denenir).
 * Yazma bulutla birleştirerek yapılır; başka cihazdan gelen mesajlar yerel kopyaya da işlenir.
 */
class CloudSyncedChatStore(
    private val inner: ChatStore,
    private val sync: CloudChatSync,
    private val scope: CoroutineScope,
    private val uid: () -> String?,
) : ChatStore by inner {

    override suspend fun upsert(chat: StoredChat) {
        inner.upsert(chat)
        if (chat.messages.none { it.streaming }) push(chat.id)
    }

    override suspend fun togglePin(id: String) {
        inner.togglePin(id)
        push(id)
    }

    override suspend fun rename(id: String, title: String) {
        inner.rename(id, title)
        push(id)
    }

    override suspend fun delete(id: String) {
        inner.delete(id)
        val owner = uid() ?: return
        scope.launch { sync.deleteCloud(owner, id) }
    }

    /** Bağlantı gelince ya da girişte: bekleyenleri gönderir, bulutla birleştirir. */
    suspend fun syncNow(owner: String) = sync.sync(owner, inner) { uid() == owner }

    /** Giriş yapılıyken başka cihazlardan gelen değişiklikleri işler. */
    fun watch(owner: String): AutoCloseable = sync.listen(owner, inner, scope) { uid() == owner }

    private fun push(id: String) {
        val owner = uid() ?: return
        scope.launch {
            val chat = inner.get(id) ?: return@launch
            val merged = sync.push(owner, chat) ?: return@launch
            // Yerel kopya bu arada değişmediyse ve hesap aynıysa birleşik hâli yaz.
            if (merged != chat && uid() == owner && inner.get(id) == chat) inner.upsert(merged)
        }
    }
}
