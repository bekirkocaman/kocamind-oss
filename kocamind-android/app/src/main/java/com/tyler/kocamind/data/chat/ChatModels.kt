package com.tyler.kocamind.data.chat

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/** Agent adımı (backend.ts `AgentStep`). */
@Serializable
data class AgentStep(
    val name: String,
    val arguments: JsonObject = JsonObject(emptyMap()),
    val result: String? = null,
)

/** chatTypes.ts `Message` ile aynı alanlar; eski AsyncStorage/Firestore verisi doğrudan okunur. */
@Serializable
data class ChatMessage(
    val id: String,
    val role: String,
    val content: String = "",
    val isStreaming: Boolean? = null,
    val image: String? = null,
    val timestamp: Long? = null,
    val agentStatus: String? = null,
    val agentSteps: List<AgentStep>? = null,
    val generatedImage: String? = null,
    val generatedVideo: String? = null,
    val generatedAspectRatio: String? = null,
    val mediaJobId: String? = null,
    val mediaStatus: String? = null,
    /** Modelin düşünce özeti; düşünme penceresinde gösterilir, geçmişe gönderilmez. */
    val thinking: String? = null,
    /** İstek gönderildikten ilk yanıt metnine kadar geçen süre. */
    val thinkingMs: Long? = null,
    /** Cevap yerine gösterilen hata; modele geçmiş olarak gönderilmez. */
    val isError: Boolean? = null,
    /** Bu mesaja kadarki sohbetin özeti; eski mesajlar modele bunun yerine gider. */
    val contextSummary: String? = null,
    /** Cevabı gerçekte veren model ("sağlayıcı/model"); Otomatik seçimde geri bildirim buna yazılır. */
    val answeredBy: String? = null,
    /** Bulut yanıtı akışının başlangıcından tamamlanmasına kadar geçen süre. */
    val latencyMs: Long? = null,
) {
    val isUser: Boolean get() = role == "user"
    val streaming: Boolean get() = isStreaming == true
}

/** Saklanan sohbet (historyStorage.ts biçimi). */
@Serializable
data class StoredChat(
    val id: String,
    val title: String = "Yeni sohbet",
    val updatedAt: String,
    val isPinned: Boolean = false,
    val archived: Boolean = false,
    val createdAt: Long? = null,
    val messages: List<ChatMessage> = emptyList(),
)

fun StoredChat.toSummary() = ChatSummary(
    id = id,
    title = title,
    updatedAt = updatedAt,
    isPinned = isPinned,
    archived = archived,
    messagesText = messages.joinToString("\n") { it.content },
)
