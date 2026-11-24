package com.tyler.kocamind.data.backend

import kotlinx.serialization.Serializable

@Serializable
data class RemoteModel(
    val id: String,
    val provider: String,
    val providerName: String,
    val label: String,
    val badge: String? = null,
    val available: Boolean,
    val isDefault: Boolean = false,
)

/** Backend rozet kimlikleri ASCII gelir (`guclu`); ekranda Türkçe yazılır. */
val RemoteModel.badgeLabel: String?
    get() = when (badge) {
        "guclu" -> "güçlü"
        "hizli" -> "hızlı"
        else -> badge
    }
