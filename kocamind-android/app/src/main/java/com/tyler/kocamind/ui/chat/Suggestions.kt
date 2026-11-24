package com.tyler.kocamind.ui.chat

/** Boş sohbet ekranındaki Türkiye işleri kartı; web `lib/suggestions.js` ile aynı liste. */
data class Suggestion(val id: String, val label: String, val prompt: String, val needsImage: Boolean)

/** Kart mesaj kutusunu doldurur, göndermez; [Suggestion.needsImage] olanlar fotoğraf seçiciyi de açar. */
val SUGGESTIONS = listOf(
    Suggestion("dilekce", "Dilekçe yaz", "Bir dilekçe yazmama yardım et. Konu: ", false),
    Suggestion("resmi-eposta", "Resmi e-posta yaz", "Resmi bir e-posta yazmama yardım et. Kime ve ne hakkında: ", false),
    Suggestion("fatura", "Faturamı açıkla", "Bu faturayı sade Türkçe açıkla: kalemler, toplam tutar ve son ödeme tarihi.", true),
    Suggestion("soru", "Fotoğraftan soru çöz", "Bu soruyu adım adım çöz, cevabı en sonda ver.", true),
)
