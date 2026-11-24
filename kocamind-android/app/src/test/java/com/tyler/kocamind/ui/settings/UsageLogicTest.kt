package com.tyler.kocamind.ui.settings

import com.tyler.kocamind.data.backend.DailyUsage
import com.tyler.kocamind.data.backend.parseDailyUsage
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant

class UsageLogicTest {
    private fun json(s: String) = Json.parseToJsonElement(s).jsonObject

    @Test fun parse_readsChatUsageAndLimit() {
        assertEquals(DailyUsage(12, 50), parseDailyUsage(json("""{"day":"2026-10-11","usage":{"chat":12,"image":1},"limits":{"chat":50,"image":5}}""")))
    }

    @Test fun parse_missingUsageMeansZero() {
        assertEquals(DailyUsage(0, 50), parseDailyUsage(json("""{"usage":{},"limits":{"chat":50}}""")))
    }

    @Test fun parse_withoutChatLimit_isNull() {
        assertNull(parseDailyUsage(json("""{"usage":{"chat":3},"limits":{}}""")))
        assertNull(parseDailyUsage(json("""{"usage":{"chat":3},"limits":{"chat":0}}""")))
    }

    @Test fun percent_roundsAndClamps() {
        assertEquals(24, DailyUsage(12, 50).percent)
        assertEquals(0, DailyUsage(0, 50).percent)
        assertEquals(100, DailyUsage(70, 50).percent)
        assertEquals(1, DailyUsage(1, 300).percent)
    }

    @Test fun level_thresholds() {
        assertEquals(UsageLevel.Ok, usageLevel(69))
        assertEquals(UsageLevel.Warn, usageLevel(70))
        assertEquals(UsageLevel.Warn, usageLevel(89))
        assertEquals(UsageLevel.Bad, usageLevel(90))
    }

    @Test fun countdown_untilNextUtcMidnight() {
        assertEquals("02:30:05", resetCountdown(Instant.parse("2026-10-11T21:29:55Z")))
        assertEquals("24:00:00", resetCountdown(Instant.parse("2026-10-11T00:00:00Z")))
        assertEquals("00:00:01", resetCountdown(Instant.parse("2026-10-11T23:59:59Z")))
    }

    @Test fun quotaNotice_onlyAtOrBelowTwentyPercent() {
        assertEquals("Bugün 10 mesaj hakkın kaldı · 03:00'te yenilenir", quotaNotice(com.tyler.kocamind.data.backend.QuotaState(10, 50)))
        assertNull(quotaNotice(com.tyler.kocamind.data.backend.QuotaState(11, 50)))
        assertNull(quotaNotice(com.tyler.kocamind.data.backend.QuotaState(0, 50)))
    }

    @Test fun quotaExhaustedText_countsDownToReset() {
        assertEquals("Bugünkü mesaj hakkın bitti. 01:00:00 sonra yenilenir.", quotaExhaustedText(Instant.parse("2026-11-03T23:00:00Z")))
    }
}
