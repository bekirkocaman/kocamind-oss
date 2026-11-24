package com.tyler.kocamind.data.offline

import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.time.LocalDateTime
import java.util.Locale

/*
 * offlineDeviceTools.ts: çevrimdışı modelin uydurmaya en yatkın olduğu soruları
 * (saat, tarih, aritmetik, birim dönüşümü) modele göndermeden cihazda kesin cevaplar.
 */

private val TR = Locale.forLanguageTag("tr")
private val DAYS = listOf("Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar")
private val MONTHS = listOf("Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık")

fun formatDeviceDate(now: LocalDateTime): String =
    "${now.dayOfMonth} ${MONTHS[now.monthValue - 1]} ${now.year} ${DAYS[now.dayOfWeek.value - 1]}"

fun formatDeviceTime(now: LocalDateTime): String = String.format(Locale.US, "%02d:%02d", now.hour, now.minute)

/** Sistem istemine eklenir; model tarih/saat sorularında bu değeri kullanır. */
fun deviceContextLine(now: LocalDateTime = LocalDateTime.now()): String =
    "Cihaz saatine göre şu an: ${formatDeviceDate(now)}, saat ${formatDeviceTime(now)}. Tarih ve saat için yalnızca bu bilgiyi kullan."

/** `toLocaleString('tr-TR', { maximumFractionDigits: 6 })`. */
private fun formatNumber(value: Double): String {
    require(value.isFinite()) { "Sonuç sonlu değil" }
    val rounded = Math.round(value * 1e10) / 1e10
    val format = DecimalFormat("#,##0.######", DecimalFormatSymbols(TR))
    return format.format(rounded)
}

// ------------------------------------------------------------------ aritmetik: + - * / % ^ ve parantez

/** Küçük özyinelemeli ayrıştırıcı (eval yok). Geçersiz ifadede hata fırlatır. */
fun evaluateArithmetic(expression: String): Double {
    val tokens = mutableListOf<Any>() // Double ya da Char
    var i = 0
    while (i < expression.length) {
        val c = expression[i]
        when {
            c == ' ' -> i++
            c.isDigit() || c == '.' -> {
                var j = i
                while (j < expression.length && (expression[j].isDigit() || expression[j] == '.')) j++
                val raw = expression.substring(i, j)
                require(raw.count { it == '.' } <= 1) { "Geçersiz sayı" }
                tokens += raw.toDouble()
                i = j
            }
            c in "+-*/%^()" -> { tokens += c; i++ }
            else -> throw IllegalArgumentException("Geçersiz karakter")
        }
    }
    var pos = 0
    fun peek(): Any? = tokens.getOrNull(pos)
    fun take(): Any? = tokens.getOrNull(pos++)
    lateinit var parseSum: () -> Double
    fun parsePrimary(): Double {
        val t = take() ?: throw IllegalArgumentException("Eksik ifade")
        if (t is Double) return t
        return when (t) {
            '(' -> parseSum().also { require(take() == ')') { "Kapanmayan parantez" } }
            '-' -> -parsePrimary()
            '+' -> parsePrimary()
            else -> throw IllegalArgumentException("Beklenmeyen işaret")
        }
    }
    fun parsePower(): Double {
        val base = parsePrimary()
        if (peek() == '^') {
            take()
            return Math.pow(base, parsePower())
        }
        return base
    }
    fun parseProduct(): Double {
        var value = parsePower()
        while (peek() == '*' || peek() == '/' || peek() == '%') {
            val op = take()
            val right = parsePower()
            require(!((op == '/' || op == '%') && right == 0.0)) { "Sıfıra bölme" }
            value = when (op) {
                '*' -> value * right
                '/' -> value / right
                else -> value % right
            }
        }
        return value
    }
    parseSum = {
        var value = parseProduct()
        while (peek() == '+' || peek() == '-') {
            val op = take()
            val right = parseProduct()
            value = if (op == '+') value + right else value - right
        }
        value
    }
    val result = parseSum()
    require(pos == tokens.size) { "Fazla ifade" }
    return result
}

private val QUESTION_WORDS = Regex("(^|\\s)(kaç eder|kaçtır|kaç|nedir|sonucu|hesapla|eder|ne yapar|yapar)(?=\\s|$)")

private fun extractArithmetic(question: String): String? {
    var text = question.lowercase(TR)
        .replace(Regex("[?!=]+"), " ")
        .replace(QUESTION_WORDS, " ")
        .replace(Regex("(^|\\s)artı(?=\\s|$)"), " + ")
        .replace(Regex("(^|\\s)eksi(?=\\s|$)"), " - ")
        .replace(Regex("(^|\\s)çarpı(?=\\s|$)"), " * ")
        .replace(Regex("(^|\\s)bölü(?=\\s|$)"), " / ")
        .replace(Regex("[×x]"), "*")
        .replace("÷", "/")
        .replace(Regex("(\\d),(\\d)"), "$1.$2")
        .replace(Regex("\\s+"), " ")
        .trim()
    if (text.isEmpty() || !Regex("^[0-9+\\-*/%^().\\s]+$").matches(text)) return null
    if (!Regex("\\d\\s*[+\\-*/%^]\\s*[-(]?\\s*\\d").containsMatchIn(text)) return null
    text = text.replace(Regex("\\s+"), "")
    return text.takeIf { it.length <= 120 }
}

// ------------------------------------------------------------------ birim dönüşümü

private class UnitDef(val key: String, val names: List<String>, val toBase: (Double) -> Double, val fromBase: (Double) -> Double, val label: String, val group: String)

private val UNITS = listOf(
    UnitDef("km", listOf("km", "kilometre"), { it * 1000 }, { it / 1000 }, "km", "uzunluk"),
    UnitDef("mil", listOf("mil", "mile", "miles"), { it * 1609.344 }, { it / 1609.344 }, "mil", "uzunluk"),
    UnitDef("m", listOf("m", "metre"), { it }, { it }, "metre", "uzunluk"),
    UnitDef("ft", listOf("ft", "feet", "fit", "foot"), { it * 0.3048 }, { it / 0.3048 }, "feet", "uzunluk"),
    UnitDef("cm", listOf("cm", "santim", "santimetre"), { it / 100 }, { it * 100 }, "cm", "uzunluk"),
    UnitDef("inc", listOf("inç", "inc", "inch", "inches"), { it * 0.0254 }, { it / 0.0254 }, "inç", "uzunluk"),
    UnitDef("kg", listOf("kg", "kilo", "kilogram"), { it }, { it }, "kg", "kütle"),
    UnitDef("lb", listOf("lb", "lbs", "pound", "libre"), { it * 0.45359237 }, { it / 0.45359237 }, "lb", "kütle"),
    UnitDef("g", listOf("g", "gram"), { it / 1000 }, { it * 1000 }, "gram", "kütle"),
    UnitDef("c", listOf("°c", "c", "santigrat", "celsius"), { it }, { it }, "°C", "sıcaklık"),
    UnitDef("f", listOf("°f", "f", "fahrenheit"), { (it - 32) * 5 / 9 }, { it * 9 / 5 + 32 }, "°F", "sıcaklık"),
)

/** "kg'a", "mile" gibi ekli yazımlar: kesmeden sonrasını at, yoksa 3+ harfli adla başlayan kelimeyi kabul et. */
private fun findUnit(word: String): UnitDef? {
    val normalized = word.lowercase(TR).split('\'', '’').first()
    return UNITS.firstOrNull { normalized in it.names }
        ?: UNITS.firstOrNull { unit -> unit.names.any { it.length > 2 && normalized.startsWith(it) } }
}

private const val UNIT = "(°?[a-zçğıöşü]+(?:['’][a-zçğıöşü]+)?)"

private fun answerUnitConversion(question: String): String? {
    val text = question.lowercase(TR).replace(Regex("(\\d),(\\d)"), "$1.$2")
    val match = Regex("(-?\\d+(?:\\.\\d+)?)\\s*$UNIT\\s+(?:kaç|ne kadar)\\s+$UNIT").find(text)
        ?: Regex("(-?\\d+(?:\\.\\d+)?)\\s*$UNIT\\s+$UNIT\\s+(?:eder|çevir|dönüştür)").find(text)
        ?: return null
    val value = match.groupValues[1].toDoubleOrNull() ?: return null
    val from = findUnit(match.groupValues[2]) ?: return null
    val to = findUnit(match.groupValues[3]) ?: return null
    if (from.key == to.key || from.group != to.group) return null
    return "${formatNumber(value)} ${from.label} = ${formatNumber(to.fromBase(from.toBase(value)))} ${to.label}"
}

/** Cihazda kesin cevaplanabilen soruysa cevabı, değilse null. */
fun answerFromDeviceTools(question: String, now: LocalDateTime = LocalDateTime.now()): String? {
    val text = question.trim()
    if (text.isEmpty() || text.length > 160) return null
    val lower = text.lowercase(TR)
    if (Regex("(saat kaç|saat kac|şu an saat|şimdi saat|saati söyle)").containsMatchIn(lower)) {
        return "Cihazının saatine göre şu an saat ${formatDeviceTime(now)}."
    }
    if (Regex("(bugün ayın kaçı|bugün günlerden ne|bugün hangi gün|bugünün tarihi|bugün tarih|tarih ne|hangi gündeyiz|bugün ne günü)").containsMatchIn(lower)) {
        return "Cihazının tarihine göre bugün ${formatDeviceDate(now)}."
    }
    answerUnitConversion(text)?.let { return it }
    val expression = extractArithmetic(text) ?: return null
    return try {
        val shown = expression.replace("*", " × ").replace("/", " ÷ ")
            .replace(Regex("([+\\-%^])"), " $1 ")
            .replace(Regex("\\s+"), " ")
            .trim()
        "$shown = ${formatNumber(evaluateArithmetic(expression))}"
    } catch (e: IllegalArgumentException) {
        null
    }
}
