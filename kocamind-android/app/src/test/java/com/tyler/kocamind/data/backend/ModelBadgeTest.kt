package com.tyler.kocamind.data.backend

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ModelBadgeTest {
    private fun model(badge: String?) = RemoteModel("m", "deepseek", "DeepSeek", "DeepSeek V3", badge, available = true)

    @Test fun backendIds_becomeTurkishLabels() {
        assertEquals("güçlü", model("guclu").badgeLabel)
        assertEquals("hızlı", model("hizli").badgeLabel)
        assertEquals("ucuz", model("ucuz").badgeLabel)
    }

    @Test fun otherBadges_passThrough() {
        assertEquals("Telefonda hazır", model("Telefonda hazır").badgeLabel)
        assertNull(model(null).badgeLabel)
    }
}
