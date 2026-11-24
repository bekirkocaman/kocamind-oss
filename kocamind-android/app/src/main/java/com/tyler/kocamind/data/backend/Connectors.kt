package com.tyler.kocamind.data.backend

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

/** `/connectors` satırı (Google Takvim, Drive, Notion, GitHub). Tokenlar uygulamaya hiç gelmez. */
data class ConnectorInfo(
    val id: String,
    val label: String,
    val description: String,
    val available: Boolean,
    val connected: Boolean,
    val status: String?,
)

/** `/connectors` yanıtı: [enabled] sunucuda anahtar tanımlı mı, [allowed] kullanıcının planı yetiyor mu. */
data class ConnectorCatalog(val enabled: Boolean, val allowed: Boolean, val connectors: List<ConnectorInfo>)

/**
 * `/skills` satırı: yalnız görünen bilgiler; talimat gövdesi sunucuda kalır.
 * [installed]: kullanıcının sohbette internetten kurdurduğu skill (kaldırılabilir).
 */
data class SkillInfo(
    val name: String,
    val title: String,
    val description: String,
    val where: List<String>,
    val alwaysOn: Boolean,
    val installed: Boolean = false,
    val sourceUrl: String? = null,
)

/** Bağlantı satırının sağındaki düğme (web: `connectorButtonState`). */
enum class ConnectorButton { Connect, Connected, Reauth, Plus, Soon }

fun connectorButton(info: ConnectorInfo, catalog: ConnectorCatalog): ConnectorButton = when {
    info.connected -> if (info.status == "reauth") ConnectorButton.Reauth else ConnectorButton.Connected
    !catalog.enabled || !info.available -> ConnectorButton.Soon
    !catalog.allowed -> ConnectorButton.Plus
    else -> ConnectorButton.Connect
}

/** OAuth sonrası `kocamind://baglantilar?durum=...` dönüşünün kullanıcıya gösterilecek hâli. */
data class ConnectorReturn(val success: Boolean, val message: String)

private val CONNECTOR_LABELS = mapOf(
    "google_calendar" to "Google Takvim",
    "google_drive" to "Google Drive",
    "notion" to "Notion",
    "github" to "GitHub",
)

private val RETURN_ERRORS = mapOf(
    "denied" to "Bağlantı izni verilmedi.",
    "invalid_state" to "Bağlantı isteğinin süresi doldu, tekrar dene.",
    "unavailable" to "Bu bağlantı şu anda kullanılamıyor.",
)

/** Yalnız `kocamind://baglantilar` adresini tanır; parametreler sabit metinlere çevrilir, olduğu gibi gösterilmez. */
fun parseConnectorReturn(scheme: String?, host: String?, query: Map<String, String?>): ConnectorReturn? {
    if (scheme != "kocamind" || host != "baglantilar") return null
    return when (query["durum"]) {
        "ok" -> ConnectorReturn(true, "${CONNECTOR_LABELS[query["baglanti"]] ?: "Hesap"} bağlandı.")
        "hata" -> ConnectorReturn(false, RETURN_ERRORS[query["neden"]] ?: "Bağlantı kurulamadı, biraz sonra tekrar dene.")
        else -> null
    }
}

internal fun parseConnectorCatalog(body: JsonObject): ConnectorCatalog = ConnectorCatalog(
    enabled = body.flag("enabled"),
    allowed = body.flag("allowed"),
    connectors = (body["connectors"] as? JsonArray).orEmpty().mapNotNull { raw ->
        val o = raw as? JsonObject ?: return@mapNotNull null
        val id = o.text("id") ?: return@mapNotNull null
        ConnectorInfo(
            id = id,
            label = o.text("label") ?: id,
            description = o.text("description").orEmpty(),
            available = o.flag("available"),
            connected = o.flag("connected"),
            status = o.text("status"),
        )
    },
)

internal fun parseSkills(body: JsonObject): List<SkillInfo> = (body["skills"] as? JsonArray).orEmpty().mapNotNull { raw ->
    val o = raw as? JsonObject ?: return@mapNotNull null
    val name = o.text("name") ?: return@mapNotNull null
    SkillInfo(
        name = name,
        title = o.text("title") ?: name,
        description = o.text("description").orEmpty(),
        where = (o["where"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content },
        alwaysOn = o.flag("alwaysOn"),
        installed = o.flag("installed"),
        sourceUrl = o.text("sourceUrl"),
    )
}

private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
private fun JsonObject.flag(key: String): Boolean = (this[key] as? JsonPrimitive)?.booleanOrNull == true
