package com.tyler.kocamind.ui.chat

import org.junit.Assert.assertEquals
import org.junit.Test

class SuggestionsTest {
    @Test fun fourTurkishTasks_inOrder_photoOnesMarked() {
        assertEquals(listOf("dilekce", "resmi-eposta", "fatura", "soru"), SUGGESTIONS.map { it.id })
        assertEquals(listOf("fatura", "soru"), SUGGESTIONS.filter { it.needsImage }.map { it.id })
        assertEquals(Suggestion("dilekce", "Dilekçe yaz", "Bir dilekçe yazmama yardım et. Konu: ", false), SUGGESTIONS.first())
    }
}
