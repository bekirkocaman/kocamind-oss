package com.tyler.kocamind.ui.chat

import java.text.Normalizer
import java.util.Locale

/** Mesajın hangi araçla karşılanacağı; kullanıcı mod seçmez, yapay zekâ isteğe göre seçer. */
sealed interface RoutedIntent {
    data object Chat : RoutedIntent
    data class Mode(val mode: AssistantMode) : RoutedIntent
    data class Media(val kind: MediaKind, val aspectRatio: String) : RoutedIntent
}

private val TR = Locale.forLanguageTag("tr")

/** Küçük harf, Türkçe karakterler ASCII'ye (kocamind-web chatText.js ile aynı yaklaşım). */
private fun normalize(text: String): String =
    Normalizer.normalize(text.lowercase(TR), Normalizer.Form.NFD)
        .replace(Regex("\\p{M}+"), "")
        .replace('ı', 'i')

// Kelime kökleriyle eşleşir: "videosu", "görseli", "üret", "üretir" gibi ekli halleri de yakalar.
private val CREATE_VERB = Regex("\\b(olustur|uret|yap|hazirla|tasarla|ciz|generate|create)")
private val VIDEO_WORD = Regex("\\b(video|klip|reels|animasyon|film|sahne)")
private val IMAGE_WORD = Regex("\\b(fotograf|gorsel|resim|logo|afis|poster|kapak|illustrasyon|cizim|duvar kagidi)")
private val DEEP_RESEARCH = Regex(
    "\\b(derin|detayli|kapsamli|ayrintili) arastir|\\brapor (hazirla|yaz|olustur)|\\bkaynaklarla karsilastir|\\bliteratur taramasi",
)
private val AGENT = Regex(
    "https?://|\\b(calistir|kodu test et|siteyi oku|sayfayi oku|sayfasini oku|mail gonder|e-?posta gonder|telegram|github|repo|issue)",
)

fun inferAspectRatio(normalized: String, kind: MediaKind): String = when {
    Regex("9\\s*:\\s*16|dikey|story|reels|tiktok|telefon").containsMatchIn(normalized) -> "9:16"
    Regex("16\\s*:\\s*9|yatay|sinema|youtube|genis ekran").containsMatchIn(normalized) -> "16:9"
    kind == MediaKind.Video -> "16:9"
    else -> "1:1"
}

fun routeIntent(text: String): RoutedIntent {
    val n = normalize(text)
    if (CREATE_VERB.containsMatchIn(n)) {
        val kind = when {
            VIDEO_WORD.containsMatchIn(n) -> MediaKind.Video
            IMAGE_WORD.containsMatchIn(n) -> MediaKind.Image
            else -> null
        }
        if (kind != null) return RoutedIntent.Media(kind, inferAspectRatio(n, kind))
    }
    if (DEEP_RESEARCH.containsMatchIn(n)) return RoutedIntent.Mode(AssistantMode.DeepResearch)
    if (AGENT.containsMatchIn(n)) return RoutedIntent.Mode(AssistantMode.Agent)
    return RoutedIntent.Chat
}
