package com.tyler.kocamind.ui.markdown

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tyler.kocamind.ui.theme.KmColors
import com.tyler.kocamind.ui.theme.KmFont
import com.tyler.kocamind.ui.theme.LocalReplySans
import com.tyler.kocamind.ui.theme.KmMonoFont
import com.tyler.kocamind.ui.theme.KmRadius
import com.tyler.kocamind.ui.theme.KmSpace
import com.tyler.kocamind.ui.theme.KmReplyFont
import com.tyler.kocamind.ui.theme.KmType

/** styles.ts `markdownStylesAi` karşılığı. */
internal object MdStyle {
    // Claude'daki gibi cevap metni serifli (KmReplyFont); kod bloğu eş aralıklı kalır.
    /** Ayarlar > Yazı tipi stili sade ise yanıt arayüz yazısıyla gösterilir. */
    private val family: FontFamily @Composable @ReadOnlyComposable get() = if (LocalReplySans.current) KmFont else KmReplyFont
    val body: TextStyle @Composable @ReadOnlyComposable get() = KmType.reply.copy(fontFamily = family, color = KmColors.text)
    val h1: TextStyle @Composable @ReadOnlyComposable get() = TextStyle(fontFamily = family, fontSize = 24.sp, lineHeight = 31.sp, fontWeight = FontWeight.SemiBold, color = KmColors.text)
    val h2: TextStyle @Composable @ReadOnlyComposable get() = TextStyle(fontFamily = family, fontSize = 21.sp, lineHeight = 28.sp, fontWeight = FontWeight.SemiBold, color = KmColors.text)
    val h3: TextStyle @Composable @ReadOnlyComposable get() = TextStyle(fontFamily = family, fontSize = 19.sp, lineHeight = 26.sp, fontWeight = FontWeight.SemiBold, color = KmColors.text)
    val h4: TextStyle @Composable @ReadOnlyComposable get() = TextStyle(fontFamily = family, fontSize = 17.sp, lineHeight = 25.sp, fontWeight = FontWeight.SemiBold, color = KmColors.textSecondary)
    val code: TextStyle @Composable @ReadOnlyComposable get() = TextStyle(fontFamily = KmMonoFont, fontSize = 14.sp, lineHeight = 20.sp, color = KmColors.text)
}

/** Yapay zekâ cevabını Markdown olarak çizer; metin seçilebilir, bağlantılar tarayıcıda açılır. */
@Composable
fun MarkdownText(markdown: String, modifier: Modifier = Modifier) {
    val blocks = remember(markdown) { parseMarkdown(markdown) }
    SelectionContainer(modifier) {
        Column {
            blocks.forEachIndexed { index, block ->
                val last = index == blocks.lastIndex
                MdBlockView(block, Modifier.padding(bottom = if (last) 0.dp else KmSpace.md))
            }
        }
    }
}

@Composable
private fun MdBlockView(block: MdBlock, modifier: Modifier) {
    when (block) {
        is MdBlock.Heading -> {
            val style = when (block.level) {
                1 -> MdStyle.h1
                2 -> MdStyle.h2
                3 -> MdStyle.h3
                else -> MdStyle.h4
            }
            Text(inline(block.text), style = style, modifier = modifier.padding(top = KmSpace.sm))
        }
        is MdBlock.Paragraph -> Text(inline(block.text), style = MdStyle.body, modifier = modifier)
        is MdBlock.ListBlock -> Column(modifier) {
            block.items.forEachIndexed { i, item ->
                Row(Modifier.padding(bottom = KmSpace.xs)) {
                    Text(
                        if (block.ordered) "${block.start + i}." else "•",
                        style = MdStyle.body,
                        modifier = Modifier.widthIn(min = 22.dp).padding(end = KmSpace.xs),
                    )
                    Text(inline(item), style = MdStyle.body, modifier = Modifier.weight(1f))
                }
            }
        }
        is MdBlock.Quote -> Row(
            modifier
                .fillMaxWidth()
                .height(IntrinsicSize.Min)
                .background(KmColors.surface),
        ) {
            Box(Modifier.width(3.dp).fillMaxHeight().background(KmColors.brand))
            Text(
                inline(block.text),
                style = MdStyle.body,
                modifier = Modifier.padding(horizontal = KmSpace.md, vertical = KmSpace.sm),
            )
        }
        is MdBlock.Code -> {
            val shape = RoundedCornerShape(KmRadius.sm)
            Box(
                modifier
                    .padding(vertical = KmSpace.sm)
                    .fillMaxWidth()
                    .clip(shape)
                    .background(KmColors.surfaceSunken)
                    .border(1.dp, KmColors.border, shape)
                    .horizontalScroll(rememberScrollState())
                    .padding(KmSpace.md),
            ) { Text(block.code, style = MdStyle.code) }
        }
        is MdBlock.Table -> {
            val shape = RoundedCornerShape(KmRadius.sm)
            Column(
                modifier
                    .clip(shape)
                    .border(1.dp, KmColors.border, shape)
                    .horizontalScroll(rememberScrollState()),
            ) {
                TableRow(block.header, header = true)
                block.rows.forEach { TableRow(it, header = false) }
            }
        }
        MdBlock.Rule -> Box(modifier.fillMaxWidth().padding(vertical = KmSpace.sm).height(1.dp).background(KmColors.border))
    }
}

@Composable
private fun TableRow(cells: List<String>, header: Boolean) {
    Row(Modifier.background(if (header) KmColors.surfaceElevated else KmColors.bg)) {
        cells.forEach { cell ->
            Text(
                inline(cell),
                style = MdStyle.body.copy(fontWeight = if (header) FontWeight.SemiBold else FontWeight.Normal, fontSize = 14.sp, lineHeight = 20.sp),
                modifier = Modifier.widthIn(min = 80.dp, max = 220.dp).padding(horizontal = KmSpace.md, vertical = KmSpace.sm),
            )
        }
    }
}

private fun linkStyles(color: Color) = TextLinkStyles(
    style = SpanStyle(color = color, textDecoration = TextDecoration.Underline),
)

@Composable
private fun inline(text: String): AnnotatedString {
    val codeBg = KmColors.surfaceElevated
    val link = KmColors.brand
    return remember(text, codeBg, link) { buildAnnotatedString { appendInline(parseInline(text), codeBg, link) } }
}

private fun AnnotatedString.Builder.appendInline(spans: List<MdInline>, codeBg: Color, link: Color) {
    spans.forEach { span ->
        when (span) {
            is MdInline.Text -> append(span.text)
            is MdInline.Bold -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { appendInline(span.children, codeBg, link) }
            is MdInline.Italic -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { appendInline(span.children, codeBg, link) }
            is MdInline.Code -> withStyle(
                SpanStyle(fontFamily = KmMonoFont, background = codeBg, fontSize = 14.sp),
            ) { append(" ${span.text} ") }
            is MdInline.Link -> {
                // Yalnızca http(s) bağlantıları açılır (mobil ile aynı kural).
                if (Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(span.url)) {
                    withLink(LinkAnnotation.Url(span.url, linkStyles(link))) { appendInline(span.children, codeBg, link) }
                } else {
                    appendInline(span.children, codeBg, link)
                }
            }
        }
    }
}
