package com.tyler.kocamind.ui.settings

import com.tyler.kocamind.data.chat.ChatMessage
import com.tyler.kocamind.data.chat.StoredChat
import com.tyler.kocamind.ui.markdown.MdBlock
import com.tyler.kocamind.ui.markdown.MdInline
import com.tyler.kocamind.ui.markdown.parseInline
import com.tyler.kocamind.ui.markdown.parseMarkdown
import java.time.LocalDate
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

private val TR = Locale.forLanguageTag("tr")

enum class ExportFormat(val ext: String, val mime: String, val title: String, val subtitle: String) {
    Html("html", "text/html", "Belge", "Okunaklı ve yazdırılabilir; tarayıcıda açılır, PDF'e kaydedilebilir"),
    Markdown("md", "text/markdown", "Markdown", "Notion, Obsidian ve not uygulamaları için"),
    Text("txt", "text/plain", "Düz metin", "Her cihazda ve uygulamada açılır"),
    Json("json", "application/json", "Yedek", "Başka bir cihaza taşımak ya da geliştiriciler için"),
}

private fun ChatMessage.exportable() = content.isNotBlank() && isError != true && (role == "user" || role == "model")
private fun StoredChat.exportMessages() = messages.filter { it.exportable() }

fun exportMessageCount(chats: List<StoredChat>): Int = chats.sumOf { it.exportMessages().size }

fun exportFileName(format: ExportFormat, chatCount: Int, date: LocalDate): String =
    "kocamind-${if (chatCount == 1) "sohbet" else "sohbetler"}-$date.${format.ext}"

/** Seçilen biçimde dışa aktarma metni. Düşünce metni ve boş mesajlar yazılmaz. */
fun buildExport(format: ExportFormat, chats: List<StoredChat>, now: ZonedDateTime): String {
    if (format == ExportFormat.Json) return exportChatsJson(chats).orEmpty()
    val title = if (chats.size == 1) chats[0].title else "${chats.size} sohbet"
    val meta = "KocaMind · ${now.format(DateTimeFormatter.ofPattern("d MMMM yyyy HH:mm", TR))} · ${exportMessageCount(chats)} mesaj"
    val multi = chats.size > 1
    return when (format) {
        ExportFormat.Markdown -> buildString {
            append("# $title\n\n_${meta}_\n\n")
            append(chats.joinToString("\n\n---\n\n") { c ->
                (if (multi) "## ${c.title}\n\n" else "") + c.exportMessages().joinToString("\n\n") { m ->
                    if (m.role == "user") "**Sen:** ${m.content.trim()}" else "**KocaMind:**\n\n${m.content.trim()}"
                }
            })
            append("\n")
        }
        ExportFormat.Text -> {
            val line = "─".repeat(40)
            buildString {
                append("$title\n$meta\n$line\n\n")
                append(chats.joinToString("\n\n$line\n\n") { c ->
                    (if (multi) "${c.title.uppercase(TR)}\n\n" else "") + c.exportMessages().joinToString("\n\n") { m ->
                        if (m.role == "user") "Sen:\n${m.content.trim()}" else "KocaMind:\n${markdownToText(m.content)}"
                    }
                })
                append("\n")
            }
        }
        else -> htmlDocument(title, meta, chats.joinToString("") { c ->
            "<section class=\"chat\">" + (if (multi) "<h2>${esc(c.title)}</h2>" else "") + c.exportMessages().joinToString("") { m ->
                if (m.role == "user") "<div class=\"u\"><p>${esc(m.content.trim())}</p></div>"
                else "<div class=\"a\"><div class=\"who\">KocaMind</div>${markdownToHtml(m.content)}</div>"
            } + "</section>"
        })
    }
}

private fun esc(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")

private fun inlineText(nodes: List<MdInline>): String = nodes.joinToString("") {
    when (it) {
        is MdInline.Text -> it.text
        is MdInline.Bold -> inlineText(it.children)
        is MdInline.Italic -> inlineText(it.children)
        is MdInline.Code -> it.text
        is MdInline.Link -> inlineText(it.children)
    }
}

private fun inlineHtml(nodes: List<MdInline>): String = nodes.joinToString("") {
    when (it) {
        is MdInline.Text -> esc(it.text)
        is MdInline.Bold -> "<strong>${inlineHtml(it.children)}</strong>"
        is MdInline.Italic -> "<em>${inlineHtml(it.children)}</em>"
        is MdInline.Code -> "<code>${esc(it.text)}</code>"
        is MdInline.Link -> if (it.url.startsWith("http://") || it.url.startsWith("https://")) {
            "<a href=\"${esc(it.url)}\">${inlineHtml(it.children)}</a>"
        } else {
            inlineHtml(it.children)
        }
    }
}

internal fun markdownToText(md: String): String = parseMarkdown(md).joinToString("\n\n") { b ->
    val t = { s: String -> inlineText(parseInline(s)) }
    when (b) {
        is MdBlock.Heading -> t(b.text).uppercase(TR)
        is MdBlock.Paragraph -> t(b.text)
        is MdBlock.ListBlock -> b.items.mapIndexed { i, s -> (if (b.ordered) "${b.start + i}. " else "• ") + t(s) }.joinToString("\n")
        is MdBlock.Quote -> t(b.text).lines().joinToString("\n") { "> $it" }
        is MdBlock.Code -> b.code.lines().joinToString("\n") { "    $it" }
        is MdBlock.Table -> (listOf(b.header) + b.rows).joinToString("\n") { r -> r.joinToString(" | ") { t(it) } }
        MdBlock.Rule -> "─".repeat(20)
    }
}

private fun markdownToHtml(md: String): String = parseMarkdown(md).joinToString("") { b ->
    val h = { s: String -> inlineHtml(parseInline(s)) }
    when (b) {
        is MdBlock.Heading -> "<h3>${h(b.text)}</h3>"
        is MdBlock.Paragraph -> "<p>${h(b.text)}</p>"
        is MdBlock.ListBlock -> {
            val tag = if (b.ordered) "ol" else "ul"
            val start = if (b.ordered && b.start != 1) " start=\"${b.start}\"" else ""
            "<$tag$start>" + b.items.joinToString("") { "<li>${h(it)}</li>" } + "</$tag>"
        }
        is MdBlock.Quote -> "<blockquote>${h(b.text)}</blockquote>"
        is MdBlock.Code -> "<pre><code>${esc(b.code)}</code></pre>"
        is MdBlock.Table -> "<table><tr>" + b.header.joinToString("") { "<th>${h(it)}</th>" } + "</tr>" +
            b.rows.joinToString("") { r -> "<tr>" + r.joinToString("") { "<td>${h(it)}</td>" } + "</tr>" } + "</table>"
        MdBlock.Rule -> "<hr>"
    }
}

private val HTML_STYLE = """
:root{--bg:#f4f5f7;--card:#fff;--fg:#0f1115;--fg3:#62687a;--bubble:#eaecf0;--line:#e2e4e9;--accent:#2d4fd6}
@media (prefers-color-scheme:dark){:root{--bg:#0f1012;--card:#1a1c20;--fg:#eceef1;--fg3:#8a909b;--bubble:#24272c;--line:#2c2f35;--accent:#8ea4ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 "Roboto Flex",Roboto,system-ui,sans-serif}
.wrap{max-width:720px;margin:0 auto;padding:48px 20px 64px}
.brand{font-weight:650;font-size:17px;color:var(--accent)}
h1{font-size:30px;line-height:1.2;letter-spacing:-.02em;margin:24px 0 6px}
.meta{color:var(--fg3);font-size:14px;margin:0 0 28px}
.chat{background:var(--card);border-radius:22px;padding:28px 26px 8px;margin-bottom:16px}
.chat h2{font-size:19px;margin:0 0 20px}
.u{display:flex;justify-content:flex-end;margin:0 0 22px}.u p{margin:0;max-width:82%;background:var(--bubble);padding:10px 16px;border-radius:20px 20px 6px 20px;white-space:pre-wrap}
.a{margin:0 0 26px}.a .who{font-size:13px;font-weight:600;color:var(--fg3);margin-bottom:6px}
.a p{margin:0 0 12px}.a h3{font-size:17px;margin:18px 0 6px}.a ul,.a ol{margin:0 0 12px;padding-left:22px}
a{color:var(--accent)}code{font:13px "Roboto Mono",ui-monospace,monospace}
pre{background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:12px 14px;overflow:auto}
blockquote{margin:0 0 12px;padding-left:14px;border-left:3px solid var(--line);color:var(--fg3)}
table{border-collapse:collapse;margin:0 0 12px}th,td{border:1px solid var(--line);padding:6px 10px;text-align:left}
footer{text-align:center;color:var(--fg3);font-size:12.5px;margin-top:28px}
@media print{body{background:#fff;color:#000}.chat{padding:0}.wrap{padding:0}}
""".trim()

private fun htmlDocument(title: String, meta: String, body: String) =
    "<!doctype html>\n<html lang=\"tr\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
        "<title>${esc(title)} · KocaMind</title><style>\n$HTML_STYLE\n</style></head><body><div class=\"wrap\">" +
        "<div class=\"brand\">KocaMind</div><h1>${esc(title)}</h1><p class=\"meta\">${esc(meta)}</p>$body" +
        "<footer>KocaMind ile dışa aktarıldı</footer></div></body></html>\n"
