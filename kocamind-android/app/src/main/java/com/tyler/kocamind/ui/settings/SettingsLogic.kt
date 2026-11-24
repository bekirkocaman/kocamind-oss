package com.tyler.kocamind.ui.settings

import com.tyler.kocamind.data.chat.ChatStore
import com.tyler.kocamind.data.chat.StoredChat
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.Json

private val exportJson = Json { prettyPrint = false; encodeDefaults = true; explicitNulls = false }

/** "Sohbetleri Dışa Aktar": eski AsyncStorage ile aynı JSON; sohbet yoksa null. */
fun exportChatsJson(chats: List<StoredChat>): String? =
    if (chats.isEmpty()) null else exportJson.encodeToString(chats)

enum class ClearResult { Done, CloudFailed }

/** "Sohbet Geçmişini Temizle": yereli siler, giriş yapılmışsa buluttakileri de. */
suspend fun clearChatHistory(store: ChatStore, uid: String?, deleteCloud: suspend (String) -> Unit): ClearResult {
    store.replaceAll(emptyList())
    if (uid == null) return ClearResult.Done
    return try {
        deleteCloud(uid)
        ClearResult.Done
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        ClearResult.CloudFailed
    }
}
