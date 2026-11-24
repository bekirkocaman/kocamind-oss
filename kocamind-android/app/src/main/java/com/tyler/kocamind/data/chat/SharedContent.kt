package com.tyler.kocamind.data.chat

/** Başka bir uygulamadan "Paylaş" ile gelen içerik; sohbet ekranı mesaj kutusuna koyar, göndermez. */
data class SharedContent(
    val text: String? = null,
    val imageUri: String? = null,
    val documentUri: String? = null,
)

private const val ACTION_SEND = "android.intent.action.SEND"

/** "Sohbete ekle > Dosya" seçicisinin kabul ettiği türlerle aynı. */
private fun isSupportedDocument(mime: String) =
    mime == "application/pdf" || mime == "application/json" || mime.startsWith("text/")

/**
 * Paylaşım niyetini ayrıştırır. Yalnızca `content://` adresleri kabul edilir: `file://` ile ya da kendi
 * dosya sağlayıcımız ([ownAuthority]) üzerinden uygulamanın özel dosyaları ek olarak gösterilemez.
 * Desteklenmeyen dosyada yanında metin varsa metin yine alınır.
 */
fun parseShare(action: String?, type: String?, text: String?, streamUri: String?, ownAuthority: String): SharedContent? {
    if (action != ACTION_SEND) return null
    val mime = type.orEmpty().lowercase().substringBefore(';').trim()
    val body = text?.trim()?.takeIf { it.isNotEmpty() }
    val stream = streamUri?.takeIf { isForeignContentUri(it, ownAuthority) }
    return when {
        stream != null && mime.startsWith("image/") -> SharedContent(text = body, imageUri = stream)
        stream != null && isSupportedDocument(mime) -> SharedContent(text = body, documentUri = stream)
        body != null -> SharedContent(text = body)
        else -> null
    }
}

private fun isForeignContentUri(uri: String, ownAuthority: String): Boolean {
    if (!uri.startsWith("content://", ignoreCase = true)) return false
    val authority = uri.substring("content://".length).substringBefore('/').substringAfterLast('@')
    return authority.isNotEmpty() && !authority.equals(ownAuthority, ignoreCase = true)
}

/** Paylaşılan metin, yazılmakta olan mesajın üzerine yazmaz; altına eklenir. */
fun mergeSharedText(current: String, shared: String): String =
    if (current.isBlank()) shared else "${current.trimEnd()}\n\n$shared"
