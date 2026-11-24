package com.tyler.kocamind.data.backend

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.math.roundToInt

/** Bugünkü sohbet kullanımı (`GET /usage/me`). */
data class DailyUsage(val used: Int, val limit: Int) {
    /** Kullanım varsa en az %1 gösterilir; "%0 kullanıldı" yanıltıcı olur. */
    val percent: Int get() = (used * 100.0 / limit).roundToInt().coerceIn(if (used > 0) 1 else 0, 100)
}

/** `{usage:{chat}, limits:{chat}}`; limit yoksa null döner, sayı uydurulmaz. */
fun parseDailyUsage(body: JsonObject): DailyUsage? {
    fun read(key: String) = runCatching { body[key]?.jsonObject?.get("chat")?.jsonPrimitive?.intOrNull }.getOrNull()
    val limit = read("limits")?.takeIf { it > 0 } ?: return null
    return DailyUsage(read("usage") ?: 0, limit)
}
