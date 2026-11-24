package com.tyler.kocamind.data.backend

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ConnectorLogicTest {
    private fun info(available: Boolean = true, connected: Boolean = false, status: String? = null) =
        ConnectorInfo("notion", "Notion", "d", available, connected, status)
    private fun catalog(enabled: Boolean = true, allowed: Boolean = true) = ConnectorCatalog(enabled, allowed, emptyList())

    @Test fun button_followsWebRules() {
        assertEquals(ConnectorButton.Connected, connectorButton(info(connected = true, status = "active"), catalog()))
        assertEquals(ConnectorButton.Reauth, connectorButton(info(connected = true, status = "reauth"), catalog()))
        assertEquals(ConnectorButton.Soon, connectorButton(info(available = false), catalog()))
        assertEquals(ConnectorButton.Soon, connectorButton(info(), catalog(enabled = false)))
        assertEquals(ConnectorButton.Plus, connectorButton(info(), catalog(allowed = false)))
        assertEquals(ConnectorButton.Connect, connectorButton(info(), catalog()))
    }

    @Test fun returnLink_success_namesTheService() {
        val result = parseConnectorReturn("kocamind", "baglantilar", mapOf("durum" to "ok", "baglanti" to "google_calendar"))
        assertEquals(ConnectorReturn(success = true, message = "Google Takvim bağlandı."), result)
    }

    @Test fun returnLink_error_usesKnownReason() {
        assertEquals("Bağlantı izni verilmedi.", parseConnectorReturn("kocamind", "baglantilar", mapOf("durum" to "hata", "neden" to "denied"))?.message)
        assertEquals(
            "Bağlantı kurulamadı, biraz sonra tekrar dene.",
            parseConnectorReturn("kocamind", "baglantilar", mapOf("durum" to "hata", "neden" to "<script>"))?.message,
        )
    }

    @Test fun returnLink_ignoresOtherLinks() {
        assertNull(parseConnectorReturn("https", "kocamind.com", mapOf("durum" to "ok")))
        assertNull(parseConnectorReturn("kocamind", "baska", mapOf("durum" to "ok")))
        assertNull(parseConnectorReturn("kocamind", "baglantilar", mapOf("durum" to "belki")))
    }
}
