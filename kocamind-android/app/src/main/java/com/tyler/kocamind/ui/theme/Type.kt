package com.tyler.kocamind.ui.theme

import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.tyler.kocamind.R

@OptIn(ExperimentalTextApi::class)
private fun variable(res: Int, weight: Int, style: FontStyle = FontStyle.Normal) = Font(
    res,
    weight = FontWeight(weight),
    style = style,
    variationSettings = FontVariation.Settings(FontVariation.weight(weight)),
)

/**
 * Claude düzeni: arayüz sade bir grotesk, yapay zekâ cevabı serifli kitap yazısı.
 * Arayüz: Inter (SIL OFL), klon tasarımıyla aynı; kalın yazı yarı kalın dosyaya düşer.
 */
val KmFont = FontFamily(
    Font(R.font.inter_regular, FontWeight.Normal),
    Font(R.font.inter_medium, FontWeight.Medium),
    Font(R.font.inter_semibold, FontWeight.SemiBold),
    Font(R.font.inter_semibold, FontWeight.Bold),
)

/** Kod blokları: JetBrains Mono (SIL OFL). */
val KmMonoFont = FontFamily(Font(R.font.jetbrains_mono, FontWeight.Normal))

/** Yapay zekâ cevabı: Newsreader (SIL OFL), değişken; italik ayrı dosyada. */
val KmReplyFont = FontFamily(
    listOf(400, 500, 600, 700).flatMap {
        listOf(variable(R.font.newsreader, it), variable(R.font.newsreader_italic, it, FontStyle.Italic))
    },
)

/** Tipografi ölçeği; renk içermez. */
object KmType {
    val display = TextStyle(fontFamily = KmFont, fontSize = 32.sp, lineHeight = 38.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.8).sp)
    val title = TextStyle(fontFamily = KmFont, fontSize = 22.sp, lineHeight = 28.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.4).sp)
    val headline = TextStyle(fontFamily = KmFont, fontSize = 17.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.2).sp)
    val body = TextStyle(fontFamily = KmFont, fontSize = 16.sp, lineHeight = 23.sp, fontWeight = FontWeight.Normal)
    val callout = TextStyle(fontFamily = KmFont, fontSize = 15.sp, lineHeight = 21.sp, fontWeight = FontWeight.Medium)
    val subhead = TextStyle(fontFamily = KmFont, fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium)
    val footnote = TextStyle(fontFamily = KmFont, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Normal)
    val caption = TextStyle(fontFamily = KmFont, fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.1.sp)

    /** Büyük harfe çevirmek çağıranın işi (`text.uppercase(trLocale)`). */
    val overline = TextStyle(fontFamily = KmFont, fontSize = 11.sp, lineHeight = 14.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 1.2.sp)

    /** Yapay zekâ cevabının gövde metni; serif küçük görünür, bu yüzden bir punto büyük. */
    val reply = TextStyle(fontFamily = KmReplyFont, fontSize = 17.sp, lineHeight = 27.sp, fontWeight = FontWeight.Normal)
}
