package com.tyler.kocamind.ui.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SettingsTextLogicTest {
    @Test fun appendInstruction_buildsSentences() {
        assertEquals("Kısa ve öz ol.", appendInstruction("", "Kısa ve öz ol"))
        assertEquals("Türkçe yaz. Örnekle anlat.", appendInstruction("Türkçe yaz", "Örnekle anlat"))
        assertEquals("Türkçe yaz. Örnekle anlat.", appendInstruction("Türkçe yaz.", "Örnekle anlat"))
    }

    @Test fun appendInstruction_skipsDuplicate_andRespectsLimit() {
        assertEquals("Kısa ve öz ol.", appendInstruction("Kısa ve öz ol.", "Kısa ve öz ol"))
        assertEquals(INSTRUCTIONS_MAX, appendInstruction("a".repeat(INSTRUCTIONS_MAX), "Samimi konuş").length)
    }

    @Test fun confirmWord_isCaseAndSpaceInsensitive_withTurkishI() {
        assertTrue(confirmWordMatches("sil", "SİL"))
        assertTrue(confirmWordMatches("  SİL ", "SİL"))
        assertFalse(confirmWordMatches("SIL", "SİL"))
        assertFalse(confirmWordMatches("si", "SİL"))
    }
}
