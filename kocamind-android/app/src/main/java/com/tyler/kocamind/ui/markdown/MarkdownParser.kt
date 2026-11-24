package com.tyler.kocamind.ui.markdown

/** Sohbet cevaplarında kullanılan Markdown alt kümesi. */
sealed interface MdBlock {
    data class Heading(val level: Int, val text: String) : MdBlock
    data class Paragraph(val text: String) : MdBlock
    data class ListBlock(val ordered: Boolean, val items: List<String>, val start: Int) : MdBlock
    data class Quote(val text: String) : MdBlock
    data class Code(val language: String, val code: String) : MdBlock
    data class Table(val header: List<String>, val rows: List<List<String>>) : MdBlock
    data object Rule : MdBlock
}

sealed interface MdInline {
    data class Text(val text: String) : MdInline
    data class Bold(val children: List<MdInline>) : MdInline
    data class Italic(val children: List<MdInline>) : MdInline
    data class Code(val text: String) : MdInline
    data class Link(val children: List<MdInline>, val url: String) : MdInline
}

private val HEADING = Regex("^(#{1,6})\\s+(.*?)\\s*#*\\s*$")
private val BULLET = Regex("^\\s*[-*+]\\s+(.*)$")
private val ORDERED = Regex("^\\s*(\\d+)[.)]\\s+(.*)$")
private val RULE = Regex("^\\s*([-*_])(\\s*\\1){2,}\\s*$")
private val TABLE_SEPARATOR = Regex("^\\s*\\|?\\s*:?-{2,}:?\\s*(\\|\\s*:?-{2,}:?\\s*)*\\|?\\s*$")

/** Blok düzeyinde ayrıştırma. Akış sırasında kapanmamış kod bloğu da kod olarak gösterilir. */
fun parseMarkdown(source: String): List<MdBlock> {
    val lines = source.replace("\r\n", "\n").split('\n')
    val blocks = mutableListOf<MdBlock>()
    val paragraph = mutableListOf<String>()
    fun flushParagraph() {
        if (paragraph.isNotEmpty()) {
            blocks += MdBlock.Paragraph(paragraph.joinToString("\n"))
            paragraph.clear()
        }
    }

    var i = 0
    while (i < lines.size) {
        val line = lines[i]
        val trimmed = line.trim()
        when {
            trimmed.startsWith("```") || trimmed.startsWith("~~~") -> {
                flushParagraph()
                val fence = trimmed.take(3)
                val language = trimmed.drop(3).trim()
                val code = mutableListOf<String>()
                i++
                while (i < lines.size && !lines[i].trim().startsWith(fence)) {
                    code += lines[i]
                    i++
                }
                blocks += MdBlock.Code(language, code.joinToString("\n"))
                i++ // kapanış çizgisi (yoksa sona gelinmiştir)
                continue
            }
            trimmed.isEmpty() -> flushParagraph()
            HEADING.matches(trimmed) -> {
                flushParagraph()
                val m = HEADING.find(trimmed)!!
                blocks += MdBlock.Heading(m.groupValues[1].length, m.groupValues[2])
            }
            RULE.matches(trimmed) -> {
                flushParagraph()
                blocks += MdBlock.Rule
            }
            trimmed.startsWith(">") -> {
                flushParagraph()
                val quote = mutableListOf<String>()
                while (i < lines.size && lines[i].trim().startsWith(">")) {
                    quote += lines[i].trim().removePrefix(">").trimStart()
                    i++
                }
                blocks += MdBlock.Quote(quote.joinToString("\n"))
                continue
            }
            trimmed.contains('|') && i + 1 < lines.size && TABLE_SEPARATOR.matches(lines[i + 1]) -> {
                flushParagraph()
                val header = tableCells(trimmed)
                val rows = mutableListOf<List<String>>()
                i += 2
                while (i < lines.size && lines[i].contains('|') && lines[i].isNotBlank()) {
                    rows += tableCells(lines[i])
                    i++
                }
                blocks += MdBlock.Table(header, rows)
                continue
            }
            BULLET.matches(line) || ORDERED.matches(line) -> {
                flushParagraph()
                val ordered = ORDERED.matches(line)
                val start = if (ordered) ORDERED.find(line)!!.groupValues[1].toIntOrNull() ?: 1 else 1
                val items = mutableListOf<String>()
                while (i < lines.size) {
                    val l = lines[i]
                    val match = if (ordered) ORDERED.find(l)?.groupValues?.get(2) else BULLET.find(l)?.groupValues?.get(1)
                    when {
                        match != null -> items += match
                        // Boşlukla başlayan devam satırı önceki maddeye eklenir.
                        l.isNotBlank() && l.startsWith("  ") && items.isNotEmpty() &&
                            !BULLET.matches(l) && !ORDERED.matches(l) -> items[items.lastIndex] = items.last() + "\n" + l.trim()
                        else -> break
                    }
                    i++
                }
                blocks += MdBlock.ListBlock(ordered, items, start)
                continue
            }
            else -> paragraph += trimmed
        }
        i++
    }
    flushParagraph()
    return blocks
}

private fun tableCells(line: String): List<String> =
    line.trim().removePrefix("|").removeSuffix("|").split('|').map { it.trim() }

/** Satır içi biçimler: **kalın**, *eğik* / _eğik_, `kod`, [metin](url). Kapanmayan işaretler düz metin kalır. */
fun parseInline(text: String): List<MdInline> {
    val out = mutableListOf<MdInline>()
    val buffer = StringBuilder()
    fun flush() {
        if (buffer.isNotEmpty()) {
            out += MdInline.Text(buffer.toString())
            buffer.clear()
        }
    }

    var i = 0
    while (i < text.length) {
        val c = text[i]
        when {
            c == '`' -> {
                val end = text.indexOf('`', i + 1)
                if (end > i) {
                    flush()
                    out += MdInline.Code(text.substring(i + 1, end))
                    i = end + 1
                    continue
                }
            }
            (c == '*' || c == '_') && text.startsWith("$c$c", i) -> {
                val marker = "$c$c"
                val end = text.indexOf(marker, i + 2)
                if (end > i + 2) {
                    flush()
                    out += MdInline.Bold(parseInline(text.substring(i + 2, end)))
                    i = end + 2
                    continue
                }
            }
            c == '*' || c == '_' -> {
                val prev = text.getOrNull(i - 1)
                val next = text.getOrNull(i + 1)
                // Kelime içindeki alt çizgi (snake_case) ve boşluklu çarpı işareti düz metindir.
                val opens = next != null && !next.isWhitespace() && !(c == '_' && prev != null && prev.isLetterOrDigit())
                if (opens) {
                    var end = text.indexOf(c, i + 1)
                    while (end > 0 && (text[end - 1].isWhitespace() || (c == '_' && text.getOrNull(end + 1)?.isLetterOrDigit() == true))) {
                        end = text.indexOf(c, end + 1)
                    }
                    if (end > i + 1) {
                        flush()
                        out += MdInline.Italic(parseInline(text.substring(i + 1, end)))
                        i = end + 1
                        continue
                    }
                }
            }
            c == '[' -> {
                val close = text.indexOf("](", i + 1)
                val end = if (close > i) text.indexOf(')', close + 2) else -1
                if (close > i && end > close) {
                    flush()
                    out += MdInline.Link(parseInline(text.substring(i + 1, close)), text.substring(close + 2, end).trim())
                    i = end + 1
                    continue
                }
            }
        }
        buffer.append(c)
        i++
    }
    flush()
    return out
}
