package com.tyler.kocamind.ui.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant

class PendingDeletionScreenTest {
    @Test
    fun describePurge_formatsTurkishDateAndRoundsDaysUp() {
        val now = Instant.parse("2026-10-12T10:00:00Z")
        assertEquals("11 Aralık 2026" to 60L, describePurge("2026-12-11T10:00:00.000Z", now))
        assertEquals("11 Aralık 2026" to 60L, describePurge("2026-12-11T09:00:00Z", now))
    }

    @Test
    fun describePurge_pastOrInvalid() {
        val now = Instant.parse("2026-10-12T10:00:00Z")
        assertEquals(0L, describePurge("2026-10-01T00:00:00Z", now)?.second)
        assertNull(describePurge("tarih değil", now))
        assertNull(describePurge(null, now))
    }
}
