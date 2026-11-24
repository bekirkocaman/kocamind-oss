package com.tyler.kocamind.data.offline

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class OfflinePolicyTest {
    private fun phone(ram: Double?, storage: Double? = 100.0, year: Int? = 2023, arch: List<String> = listOf("arm64-v8a")) =
        DeviceProfile(
            deviceName = "Samsung SM-S711B",
            totalRamGB = ram,
            availableStorageGB = storage,
            yearClass = year,
            architectures = arch,
            isPhysicalDevice = true,
        )

    private fun model(id: String) = OFFLINE_MODELS.first { it.id == id }

    @Test
    fun catalog_matchesOldApp() {
        assertEquals(13, OFFLINE_MODELS.size)
        val gemma = model("gemma3-4b")
        assertEquals(2489757856L, gemma.expectedBytes)
        assertEquals("gemma-3-4b-it-Q4_K_M.gguf", gemma.fileName)
    }

    @Test
    fun tier_usesRamFirst() {
        assertEquals(DeviceTier.Powerful, deviceTier(8.0, 2018))
        assertEquals(DeviceTier.Flagship, deviceTier(12.0, null))
        assertEquals(DeviceTier.Entry, deviceTier(null, 2019))
        assertEquals("Güçlü", DeviceTier.Powerful.label)
    }

    @Test
    fun compatibility_greatPoorAndUnsupported() {
        val great = modelCompatibility(phone(8.0), model("qwen3.5-2b"))
        assertEquals(CompatibilityLevel.Great, great.level)
        assertEquals("Rahat çalışır", great.label)
        assertEquals(10, great.score)

        val poor = modelCompatibility(phone(8.0), model("gemma3-4b"))
        assertEquals(CompatibilityLevel.Poor, poor.level)
        assertEquals("En az 10 GB RAM gerekiyor; cihazda yaklaşık 8 GB görünüyor.", poor.reason)
        assertEquals(4, poor.score)

        val okay = modelCompatibility(phone(8.0), model("qwen2.5-3b"))
        assertEquals("Çalışır, yavaş olabilir", okay.label)
        assertEquals(6, okay.score)

        assertEquals("Desteklenmiyor", modelCompatibility(phone(8.0, arch = listOf("armeabi-v7a")), model("qwen3.5-2b")).label)
        val noSpace = modelCompatibility(phone(8.0, storage = 1.0), model("qwen3.5-2b"))
        assertEquals("Yer yetersiz", noSpace.label)
        assertEquals("İndirme ve kurulum için en az 1.4 GB boş alan gerekiyor.", noSpace.reason)
        // İndirilmiş modelde boş alan kontrol edilmez.
        assertEquals(CompatibilityLevel.Great, modelCompatibility(phone(8.0, storage = 1.0), model("qwen3.5-2b"), alreadyDownloaded = true).level)
    }

    @Test
    fun recommendation_picksSmartestSafeModel() {
        val rec = recommendSmartModel(phone(8.0), OFFLINE_MODELS)
        assertEquals("qwen3.5-2b", rec.recommended?.id)
        assertEquals("Tahmini Türkçe kalite 6/10 ve 10/10 rahat çalışma ile bu cihazdaki en güçlü güvenli seçenek.", rec.reason)
        assertEquals("gemma3-4b", recommendSmartModel(phone(12.0), OFFLINE_MODELS).recommended?.id)
        assertNull(recommendSmartModel(phone(8.0, arch = listOf("x86")), OFFLINE_MODELS).recommended)
    }

    @Test
    fun adaptiveProfile_followsFamilyAndRam() {
        val qwen = adaptiveInferenceProfile(phone(8.0), model("qwen3.5-2b"))
        assertEquals(2048, qwen.contextSize)
        assertEquals(512, qwen.nPredict)
        assertEquals(1216, qwen.historyTokenBudget)
        assertEquals(0.7f, qwen.temperature)
        assertEquals(20, qwen.topK)
        assertEquals("Dengeli", qwen.label)

        val gemma = adaptiveInferenceProfile(phone(12.0), model("gemma3-4b"))
        assertEquals(4096, gemma.contextSize)
        assertEquals(768, gemma.nPredict)
        assertEquals(64, gemma.topK)
        assertEquals(0.05f, gemma.minP)
    }

    @Test
    fun history_isTrimmedFromOldestWithinBudget() {
        val history = listOf(
            "user" to "a".repeat(3200),
            "model" to "eski cevap",
            "user" to "yeni soru",
            "system" to "atla",
            "user" to "  ",
        )
        val selected = selectHistoryWithinBudget(history, tokenBudget = 100)
        assertEquals(listOf("assistant" to "eski cevap", "user" to "yeni soru"), selected)
    }

    @Test
    fun stripThinking_removesClosedAndOpenBlocks() {
        assertEquals("Cevap", stripThinkingBlocks("<think>düşün</think>Cevap"))
        assertEquals("Önce", stripThinkingBlocks("Önce<think>yarım kalan"))
    }

    @Test
    fun comfortScore_andAveraging() {
        assertEquals(10, performanceComfortScore(12.0))
        assertEquals(6, performanceComfortScore(3.0))
        assertEquals(3, performanceComfortScore(1.0))
        val first = averagePerformance(null, "m", 6.0, 40.0, "t")
        assertEquals(1, first.sampleCount)
        val second = averagePerformance(first, "m", 10.0, 60.0, "t")
        assertEquals(8.0, second.tokensPerSecond, 0.001)
        assertEquals(9, second.comfortScore)
        assertTrue(second.sampleCount == 2)
    }
}
