package com.tyler.kocamind.data.offline

import kotlin.math.ceil
import kotlin.math.roundToInt

/** deviceCompatibility.ts `DeviceProfile` (yalnız Android). */
data class DeviceProfile(
    val deviceName: String,
    val totalRamGB: Double?,
    val availableStorageGB: Double?,
    val yearClass: Int?,
    val architectures: List<String>,
    val isPhysicalDevice: Boolean,
) {
    val tier: DeviceTier get() = deviceTier(totalRamGB, yearClass)
}

enum class DeviceTier(val label: String) {
    Entry("Giriş seviye"),
    Balanced("Orta seviye"),
    Powerful("Güçlü"),
    Flagship("Üst seviye"),
}

enum class CompatibilityLevel { Great, Okay, Poor, Unsupported }

data class ModelCompatibility(val level: CompatibilityLevel, val label: String, val reason: String, val score: Int)

data class SmartModelRecommendation(
    val recommended: OfflineModel?,
    val alternatives: List<OfflineModel>,
    val reason: String,
    val comfortScore: Int,
)

data class AdaptiveInferenceProfile(
    val label: String,
    val contextSize: Int,
    val historyTokenBudget: Int,
    val nPredict: Int,
    val temperature: Float,
    val topP: Float,
    val topK: Int,
    val minP: Float,
)

/** JS sayı yazımı: 8.0 → "8", 7.4 → "7.4". */
private fun jsNumber(value: Double): String =
    if (value == Math.floor(value) && !value.isInfinite()) value.toLong().toString() else value.toString()

private fun clamp(value: Int, min: Int, max: Int) = value.coerceIn(min, max)

private fun yearTier(yearClass: Int?) = when {
    yearClass == null -> DeviceTier.Balanced
    yearClass < 2020 -> DeviceTier.Entry
    yearClass < 2022 -> DeviceTier.Balanced
    yearClass < 2024 -> DeviceTier.Powerful
    else -> DeviceTier.Flagship
}

private fun ramTier(totalRamGB: Double) = when {
    totalRamGB < 4 -> DeviceTier.Entry
    totalRamGB < 7 -> DeviceTier.Balanced
    totalRamGB < 12 -> DeviceTier.Powerful
    else -> DeviceTier.Flagship
}

/** Bazı üreticiler cihaz yılını yanlış raporluyor; RAM okunabiliyorsa sınıflandırma ondan yapılır. */
fun deviceTier(totalRamGB: Double?, yearClass: Int?): DeviceTier =
    if (totalRamGB != null) ramTier(totalRamGB) else yearTier(yearClass)

fun has64BitArchitecture(architectures: List<String>): Boolean {
    val known = architectures.map { it.lowercase() }
    return known.isEmpty() || known.any { it.contains("arm64") || it.contains("aarch64") || it.contains("x86_64") || it.contains("x86-64") }
}

/** offlineModelPolicy.ts `calculateModelCompatibility`. */
fun modelCompatibility(profile: DeviceProfile, model: OfflineModel, alreadyDownloaded: Boolean = false): ModelCompatibility {
    if (!profile.isPhysicalDevice) {
        return ModelCompatibility(CompatibilityLevel.Unsupported, "Desteklenmiyor", "Yerel AI gerçek bir Android veya iOS cihaz gerektirir.", 0)
    }
    if (!has64BitArchitecture(profile.architectures)) {
        return ModelCompatibility(CompatibilityLevel.Unsupported, "Desteklenmiyor", "Bu model için 64 bit işlemci gerekiyor.", 0)
    }
    if (!alreadyDownloaded && profile.availableStorageGB != null) {
        val required = model.expectedBytes / (1024.0 * 1024 * 1024) * 1.15
        if (profile.availableStorageGB < required) {
            return ModelCompatibility(
                CompatibilityLevel.Unsupported,
                "Yer yetersiz",
                "İndirme ve kurulum için en az ${String.format(java.util.Locale.US, "%.1f", required)} GB boş alan gerekiyor.",
                1,
            )
        }
    }
    val ram = profile.totalRamGB
    if (ram != null && ram < model.minRamGB) {
        return ModelCompatibility(
            CompatibilityLevel.Poor,
            "Önerilmez",
            "En az ${model.minRamGB} GB RAM gerekiyor; cihazda yaklaşık ${jsNumber(ram)} GB görünüyor.",
            clamp((ram / model.minRamGB * 5).roundToInt(), 2, 5),
        )
    }
    if (ram == null && profile.yearClass == null && model.minRamGB > 4) {
        return ModelCompatibility(
            CompatibilityLevel.Poor,
            "Donanım belirsiz",
            "RAM ve işlemci sınıfı okunamadığı için bu büyük model güvenle önerilemiyor.",
            4,
        )
    }
    if (ram == null && profile.yearClass != null && profile.yearClass < model.minYearClass - 1) {
        return ModelCompatibility(
            CompatibilityLevel.Poor,
            "Önerilmez",
            "İşlemci nesli bu modelde çok yavaş kalabilir veya uygulama kapanabilir.",
            4,
        )
    }
    val ramProgress = if (ram == null) 0.35 else (ram - model.minRamGB) / maxOf(1, model.recommendedRamGB - model.minRamGB)
    var score = clamp(Math.round(6 + ramProgress * 3).toInt(), 6, 10)
    if (ram == null && profile.yearClass != null) {
        if (profile.yearClass < model.minYearClass) score -= 1
        if (profile.yearClass >= model.minYearClass + 3) score += 1
    }
    score = clamp(score, 2, 10)
    return when {
        score >= 9 -> ModelCompatibility(CompatibilityLevel.Great, "Rahat çalışır", "RAM, işlemci sınıfı ve depolama bu model için uygun.", score)
        score >= 6 -> ModelCompatibility(
            CompatibilityLevel.Okay,
            if (score >= 8) "İyi çalışır" else "Çalışır, yavaş olabilir",
            if (score >= 8) "Bu model cihazda kalite ve hız arasında iyi bir denge kurar." else "Model açılabilir; uzun cevaplarda ısınma veya bekleme yaşanabilir.",
            score,
        )
        else -> ModelCompatibility(CompatibilityLevel.Poor, "Önerilmez", "Bu model cihazın güvenli çalışma sınırına çok yakın.", score)
    }
}

/** offlineModelPolicy.ts `recommendSmartModel`: güvenli olanlar arasında en kaliteli model. */
fun recommendSmartModel(profile: DeviceProfile, models: List<OfflineModel>, alreadyDownloaded: Boolean = false): SmartModelRecommendation {
    val ranked = models
        .map { it to modelCompatibility(profile, it, alreadyDownloaded) }
        .filter { (_, c) -> (c.level == CompatibilityLevel.Great || c.level == CompatibilityLevel.Okay) && c.score >= 7 }
        .sortedWith(
            compareByDescending<Pair<OfflineModel, ModelCompatibility>> { it.first.qualityScore }
                .thenByDescending { it.second.score }
                .thenByDescending { it.first.parameterCountB }
                .thenBy { it.first.expectedBytes },
        )
    val best = ranked.firstOrNull()
        ?: return SmartModelRecommendation(null, emptyList(), "Bu cihaz için güvenli bir yerel model belirlenemedi.", 0)
    return SmartModelRecommendation(
        recommended = best.first,
        alternatives = ranked.drop(1).map { it.first },
        reason = "Tahmini Türkçe kalite ${best.first.qualityScore}/10 ve ${best.second.score}/10 rahat çalışma ile bu cihazdaki en güçlü güvenli seçenek.",
        comfortScore = best.second.score,
    )
}

/** offlineModelPolicy.ts `createAdaptiveInferenceProfile`. Düşünme modu telefonda kapalı. */
fun adaptiveInferenceProfile(profile: DeviceProfile, model: OfflineModel): AdaptiveInferenceProfile {
    val compatibility = modelCompatibility(profile, model, alreadyDownloaded = true)
    val ram = profile.totalRamGB ?: if (profile.yearClass != null && profile.yearClass >= 2023) 8.0 else 4.0
    // Android'de toplam RAM'in ~1/3'ü uygulamaya kalır; bağlam büyüdükçe bellek çökmesi riski artar.
    var contextSize = 2048
    if (ram >= 10 && model.parameterCountB <= 4) contextSize = 3072
    if (ram >= 12 && model.parameterCountB <= 4) contextSize = 4096
    if (ram >= 14 && model.parameterCountB > 4) contextSize = 4096
    val nPredict = if (model.parameterCountB >= 3) 768 else 512
    val historyBudget = maxOf(640, contextSize - nPredict - 320)
    val label = if (compatibility.score >= 8) "Dengeli" else "Hızlı"
    return when (model.family) {
        "gemma3", "gemma3n" -> AdaptiveInferenceProfile(
            label, contextSize, historyBudget, nPredict,
            temperature = if (model.parameterCountB >= 3) 0.7f else 0.5f, topP = 0.95f, topK = 64, minP = 0.05f,
        )
        "qwen2.5" -> AdaptiveInferenceProfile(label, contextSize, historyBudget, nPredict, 0.3f, 0.85f, 40, 0.05f)
        // Qwen3/3.5 düşünmesiz mod için resmi öneri: 0.7 / 0.8 / 20.
        else -> AdaptiveInferenceProfile(label, contextSize, historyBudget, nPredict, 0.7f, 0.8f, 20, 0f)
    }
}

/** Son mesajlardan başlayıp tahmini token bütçesine sığanları seçer (rol: user / assistant). */
fun selectHistoryWithinBudget(history: List<Pair<String, String>>, tokenBudget: Int): List<Pair<String, String>> {
    val normalized = history
        .filter { it.second.isNotBlank() }
        .map { (role, content) -> (if (role == "model") "assistant" else role) to content.trim() }
        .filter { it.first == "user" || it.first == "assistant" }
    val selected = ArrayDeque<Pair<String, String>>()
    var tokens = 0
    for (message in normalized.asReversed()) {
        val cost = ceil(message.second.length / 3.2).toInt() + 8
        if (selected.isNotEmpty() && tokens + cost > tokenBudget) break
        selected.addFirst(message)
        tokens += cost
    }
    return selected.toList()
}

fun stripThinkingBlocks(value: String): String = value
    .replace(Regex("<think>[\\s\\S]*?</think>", RegexOption.IGNORE_CASE), "")
    .replace(Regex("<think>[\\s\\S]*$", RegexOption.IGNORE_CASE), "")
    .replace(Regex("</?think>", RegexOption.IGNORE_CASE), "")
    .trim()

// ------------------------------------------------------------------ gerçek hız ölçümü

data class OfflineModelPerformance(
    val modelId: String,
    val tokensPerSecond: Double,
    val promptTokensPerSecond: Double,
    val comfortScore: Int,
    val sampleCount: Int,
    val measuredAt: String,
)

fun performanceComfortScore(tokensPerSecond: Double): Int = when {
    tokensPerSecond >= 10 -> 10
    tokensPerSecond >= 8 -> 9
    tokensPerSecond >= 6 -> 8
    tokensPerSecond >= 4 -> 7
    tokensPerSecond >= 2.5 -> 6
    tokensPerSecond >= 1.5 -> 5
    else -> 3
}

/** Son 5 ölçümün kayan ortalaması. */
fun averagePerformance(
    previous: OfflineModelPerformance?,
    modelId: String,
    tokensPerSecond: Double,
    promptTokensPerSecond: Double,
    measuredAt: String,
): OfflineModelPerformance {
    val sampleCount = minOf(5, (previous?.sampleCount ?: 0) + 1)
    val previousWeight = maxOf(0, sampleCount - 1)
    val speed = if (previous == null) tokensPerSecond else (previous.tokensPerSecond * previousWeight + tokensPerSecond) / sampleCount
    val promptSpeed = if (previous == null) promptTokensPerSecond else (previous.promptTokensPerSecond * previousWeight + promptTokensPerSecond) / sampleCount
    return OfflineModelPerformance(
        modelId = modelId,
        tokensPerSecond = Math.round(speed * 10) / 10.0,
        promptTokensPerSecond = Math.round(promptSpeed * 10) / 10.0,
        comfortScore = performanceComfortScore(speed),
        sampleCount = sampleCount,
        measuredAt = measuredAt,
    )
}
