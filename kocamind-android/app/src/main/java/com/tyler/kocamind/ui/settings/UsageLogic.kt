package com.tyler.kocamind.ui.settings

import com.tyler.kocamind.data.backend.QuotaState
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset

enum class UsageLevel { Ok, Warn, Bad }

fun usageLevel(percent: Int): UsageLevel = when {
    percent >= 90 -> UsageLevel.Bad
    percent >= 70 -> UsageLevel.Warn
    else -> UsageLevel.Ok
}

/** Mesaj kutusunun üstündeki satır: yalnızca kalan hak limitin %20'sine inince; hak bittiyse ayrı durum. */
fun quotaNotice(q: QuotaState): String? =
    if (q.remaining <= 0 || q.remaining > q.limit / 5) null
    else "Bugün ${q.remaining} mesaj hakkın kaldı · 03:00'te yenilenir"

fun quotaExhaustedText(now: Instant): String = "Bugünkü mesaj hakkın bitti. ${resetCountdown(now)} sonra yenilenir."

/** Kota UTC gece yarısı yenilenir (Türkiye saatiyle 03:00); kalan süre SS:DD:ss. */
fun resetCountdown(now: Instant): String {
    val next = now.atOffset(ZoneOffset.UTC).toLocalDate().plusDays(1).atStartOfDay().toInstant(ZoneOffset.UTC)
    val s = Duration.between(now, next).seconds
    return "%02d:%02d:%02d".format(s / 3600, s / 60 % 60, s % 60)
}
