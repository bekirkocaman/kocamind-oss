package com.tyler.kocamind.ui.offline

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tyler.kocamind.data.offline.CompatibilityLevel
import com.tyler.kocamind.data.offline.DeviceProfile
import com.tyler.kocamind.data.offline.OFFLINE_MODELS
import com.tyler.kocamind.data.offline.OfflineAiService
import com.tyler.kocamind.data.offline.OfflineModel
import com.tyler.kocamind.data.offline.formatModelSize
import com.tyler.kocamind.data.offline.modelCompatibility
import com.tyler.kocamind.data.offline.recommendSmartModel
import com.tyler.kocamind.ui.components.KmIcon
import com.tyler.kocamind.ui.components.KmSkeleton
import com.tyler.kocamind.ui.components.pressableScale
import com.tyler.kocamind.ui.components.rememberReduceMotion
import com.tyler.kocamind.ui.icons.KmIcons
import com.tyler.kocamind.ui.settings.BackTitleHeader
import com.tyler.kocamind.ui.theme.KmColors
import com.tyler.kocamind.ui.theme.KmMotion
import com.tyler.kocamind.ui.theme.KmRadius
import com.tyler.kocamind.ui.theme.KmSpace
import com.tyler.kocamind.ui.theme.KmType
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
@ReadOnlyComposable
private fun levelColor(level: CompatibilityLevel) = when (level) {
    CompatibilityLevel.Great -> KmColors.success
    CompatibilityLevel.Okay -> KmColors.warning
    else -> KmColors.danger
}

private data class Prompt(val title: String, val message: String, val confirm: String? = null, val danger: Boolean = false, val onConfirm: () -> Unit = {})

/** offline-models.tsx. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun OfflineModelsScreen(
    service: OfflineAiService,
    deviceProfile: suspend () -> DeviceProfile,
    appScope: CoroutineScope,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val scope = rememberCoroutineScope()
    val reduce = rememberReduceMotion()
    val changes by service.changes.collectAsStateWithLifecycle()
    var profile by remember { mutableStateOf<DeviceProfile?>(null) }
    var autoMode by remember { mutableStateOf(service.autoMode) }
    var selectedId by remember { mutableStateOf("") }
    var testingId by remember { mutableStateOf<String?>(null) }
    val progress by service.downloadProgress.collectAsStateWithLifecycle()
    var prompt by remember { mutableStateOf<Prompt?>(null) }

    LaunchedEffect(Unit) { profile = runCatching { withContext(Dispatchers.IO) { deviceProfile() } }.getOrNull() }
    // İndirme/silme sonrası durum diskten yeniden okunur.
    val downloaded = remember(changes) { OFFLINE_MODELS.associate { it.id to service.isDownloaded(it) } }
    val stored = remember(changes) { OFFLINE_MODELS.associate { it.id to service.hasFile(it) } }
    LaunchedEffect(changes) {
        val selected = service.selectedModel()
        selectedId = if (service.isDownloaded(selected)) selected.id else ""
        autoMode = service.autoMode
    }

    fun runDeviceTest(model: OfflineModel, preserveAutoMode: Boolean) {
        scope.launch {
            testingId = model.id
            try {
                if (!preserveAutoMode) {
                    service.autoMode = false
                    service.setSelected(model.id)
                }
                val measured = service.benchmark(model)
                prompt = Prompt("Cihaz testi tamamlandı", "${model.name}\n${measured.tokensPerSecond} token/sn • Gerçek rahatlık ${measured.comfortScore}/10")
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                prompt = Prompt("Cihaz testi tamamlanamadı", e.message ?: "Modelin gerçek hızı ölçülemedi.")
            } finally {
                testingId = null
            }
        }
    }

    fun startDownload(model: OfflineModel, activateAutoMode: Boolean = false) {
        // Uygulama kapsamında: ekrandan çıkılsa da indirme sürer.
        appScope.launch {
            try {
                service.setDownloadProgress(model.id, 1)
                service.download(model) { percent -> service.setDownloadProgress(model.id, maxOf(1, percent)) }
                if (activateAutoMode) service.autoMode = true
                service.setSelected(model.id, preserveAutoMode = activateAutoMode)
                service.setDownloadProgress(model.id, null)
                withContext(Dispatchers.Main) { runDeviceTest(model, activateAutoMode) }
            } catch (e: CancellationException) {
                service.setDownloadProgress(model.id, null)
                throw e
            } catch (e: Exception) {
                service.setDownloadProgress(model.id, null)
                prompt = Prompt("İndirme tamamlanamadı", e.message ?: "Model indirilemedi.")
            }
        }
    }

    fun chooseModel(model: OfflineModel) {
        val compatibility = profile?.let { modelCompatibility(it, model, downloaded[model.id] == true) }
        if (compatibility?.level == CompatibilityLevel.Unsupported) {
            prompt = Prompt(compatibility.label, compatibility.reason)
            return
        }
        if (downloaded[model.id] == true) {
            val activate = { scope.launch { service.setSelected(model.id) }; Unit }
            if (compatibility?.level == CompatibilityLevel.Poor) {
                prompt = Prompt("${compatibility.label}: ${model.name}", compatibility.reason, "Yine de kullan", onConfirm = activate)
            } else {
                activate()
            }
            return
        }
        val risky = compatibility?.level == CompatibilityLevel.Poor
        prompt = Prompt(
            title = if (risky) "${compatibility?.label}: ${model.name}" else "Çevrimdışı modeli indir",
            message = listOfNotNull(
                compatibility?.let { "${it.score}/10 • ${it.label}. ${it.reason}" },
                "${formatModelSize(model)} yer kaplar. Yalnızca Wi‑Fi kullanman önerilir.",
            ).joinToString("\n\n"),
            confirm = if (risky) "Yine de indir" else "İndir",
            onConfirm = { startDownload(model) },
        )
    }

    fun removeModel(model: OfflineModel) {
        prompt = Prompt(
            "İndirilen modeli sil",
            "${model.name} cihazdan silinsin mi? Yaklaşık ${formatModelSize(model)} alan açılır.",
            "Sil",
            danger = true,
            onConfirm = { scope.launch { service.delete(model) } },
        )
    }

    fun toggleAutoMode(enabled: Boolean) {
        autoMode = enabled
        service.autoMode = enabled
        if (!enabled) return
        scope.launch { service.bestDownloaded()?.let { service.setSelected(it.id, preserveAutoMode = true) } }
    }

    val recommendation = profile?.let { recommendSmartModel(it, OFFLINE_MODELS) }
    val recommended = recommendation?.recommended
    val recommendedCompat = if (profile != null && recommended != null) modelCompatibility(profile!!, recommended, downloaded[recommended.id] == true) else null

    fun useRecommendation() {
        val model = recommended ?: return
        if (downloaded[model.id] == true) {
            scope.launch {
                service.autoMode = true
                service.setSelected(model.id, preserveAutoMode = true)
                if (service.performance(model.id) == null) runDeviceTest(model, true)
            }
            return
        }
        prompt = Prompt(
            "En akıllı güvenli modeli kur",
            "${model.name}\n\nTahmini Türkçe kalite ${model.qualityScore}/10 • Rahatlık ${recommendedCompat?.score ?: 0}/10\n${formatModelSize(model)} indirilir ve ardından gerçek cihaz hız testi yapılır.",
            "İndir ve test et",
            onConfirm = { startDownload(model, activateAutoMode = true) },
        )
    }

    Column(modifier) {
        BackTitleHeader("Çevrimdışı AI Modelleri", onBack)
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(KmSpace.lg).padding(bottom = KmSpace.xl),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(Modifier.widthIn(max = 800.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(KmSpace.md)) {
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(KmRadius.lg)).background(KmColors.successMuted).padding(KmSpace.lg),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(KmSpace.md),
                ) {
                    KmIcon(KmIcons.ShieldCheck, KmColors.success, 22.dp)
                    Column(Modifier.weight(1f)) {
                        Text("Tamamen telefonunda çalışır", style = KmType.subhead.copy(fontWeight = FontWeight.SemiBold), color = KmColors.text)
                        Text(
                            "Model indirildikten sonra sohbet için internet gerekmez.",
                            style = KmType.caption,
                            color = KmColors.textSecondary,
                            modifier = Modifier.padding(top = KmSpace.xs),
                        )
                    }
                }

                val card = Modifier.fillMaxWidth().clip(RoundedCornerShape(KmRadius.lg)).background(KmColors.surface)
                    .border(1.dp, KmColors.border, RoundedCornerShape(KmRadius.lg)).padding(KmSpace.lg)
                val p = profile
                if (p == null) {
                    Column(card) {
                        KmSkeleton(Modifier.fillMaxWidth(0.6f), height = 16.dp)
                        Spacer(Modifier.height(KmSpace.sm))
                        KmSkeleton(Modifier.fillMaxWidth(0.4f), height = 12.dp)
                    }
                } else if (recommended != null) {
                    Column(card) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(KmSpace.md)) {
                            Column(Modifier.weight(1f)) {
                                Text(p.deviceName, style = KmType.callout.copy(fontWeight = FontWeight.SemiBold), color = KmColors.text)
                                Text(
                                    (p.totalRamGB?.let { "${jsNum(it)} GB RAM" } ?: "RAM bilinmiyor") +
                                        (p.availableStorageGB?.let { "  •  ${jsNum(it)} GB boş" } ?: ""),
                                    style = KmType.caption,
                                    color = KmColors.textSecondary,
                                    modifier = Modifier.padding(top = KmSpace.xs),
                                )
                            }
                            Text(
                                p.tier.label,
                                style = KmType.caption.copy(fontWeight = FontWeight.SemiBold),
                                color = KmColors.brandSoft,
                                modifier = Modifier.clip(RoundedCornerShape(KmRadius.sm)).background(KmColors.brandMuted).padding(horizontal = KmSpace.md, vertical = KmSpace.sm),
                            )
                        }
                        Row(Modifier.padding(top = KmSpace.lg), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(KmSpace.sm)) {
                            KmIcon(KmIcons.CircleCheck, KmColors.success, 17.dp)
                            Text("Telefonun için en akıllı güvenli model", style = KmType.caption.copy(fontWeight = FontWeight.SemiBold), color = KmColors.success)
                        }
                        Text(recommended.name, style = KmType.headline, color = KmColors.text, modifier = Modifier.padding(top = KmSpace.sm))
                        FlowRow(Modifier.padding(top = KmSpace.sm), horizontalArrangement = Arrangement.spacedBy(KmSpace.sm)) {
                            Badge("Türkçe ~${recommended.qualityScore}/10", KmColors.brandSoft, KmColors.brandMuted)
                            Badge("Rahatlık ${recommendedCompat?.score ?: 0}/10", KmColors.success, KmColors.successMuted)
                        }
                        Text(recommendation.reason, style = KmType.caption, color = KmColors.textSecondary, modifier = Modifier.padding(top = KmSpace.sm))
                        Row(
                            Modifier.padding(top = KmSpace.lg).fillMaxWidth().clip(RoundedCornerShape(KmRadius.md)).background(KmColors.surfaceElevated).padding(KmSpace.md),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(KmSpace.md),
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text("Otomatik Akıllı Seçim", style = KmType.subhead.copy(fontWeight = FontWeight.SemiBold), color = KmColors.text)
                                Text(
                                    "İndirilenler arasından bu telefondaki en zeki güvenli modeli kullanır.",
                                    style = KmType.caption,
                                    color = KmColors.textMuted,
                                    modifier = Modifier.padding(top = KmSpace.xs),
                                )
                            }
                            Switch(
                                checked = autoMode,
                                onCheckedChange = ::toggleAutoMode,
                                colors = SwitchDefaults.colors(
                                    checkedTrackColor = KmColors.successMuted,
                                    checkedThumbColor = KmColors.success,
                                    uncheckedTrackColor = KmColors.surfaceElevated,
                                    uncheckedThumbColor = KmColors.textMuted,
                                    uncheckedBorderColor = KmColors.border,
                                ),
                            )
                        }
                        val busy = (progress[recommended.id] ?: 0) > 0 || testingId == recommended.id
                        Row(
                            Modifier
                                .padding(top = KmSpace.md)
                                .fillMaxWidth()
                                .pressableScale(onClick = ::useRecommendation, enabled = !busy, pressedOpacity = 0.8f)
                                .clip(RoundedCornerShape(KmRadius.md))
                                .background(KmColors.brand)
                                .padding(vertical = KmSpace.md, horizontal = KmSpace.lg),
                            horizontalArrangement = Arrangement.Center,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            KmIcon(KmIcons.CloudSlash, KmColors.textOnBrand, 16.dp)
                            Spacer(Modifier.width(KmSpace.sm))
                            Text(
                                when {
                                    testingId == recommended.id -> "Cihaz testi yapılıyor…"
                                    (progress[recommended.id] ?: 0) > 0 -> "%${progress[recommended.id]} indiriliyor"
                                    downloaded[recommended.id] == true ->
                                        if (autoMode && selectedId == recommended.id) "Akıllı seçim aktif" else "En iyi modeli kullan"
                                    else -> "İndir, test et ve kullan"
                                },
                                style = KmType.subhead.copy(fontWeight = FontWeight.SemiBold),
                                color = KmColors.textOnBrand,
                            )
                        }
                        Text(
                            "Seçim RAM, işlemci yılı, 64-bit desteği ve boş alandan hesaplanır; indirme sonrası gerçek hız da ölçülür.",
                            style = KmType.caption,
                            color = KmColors.textMuted,
                            modifier = Modifier.padding(top = KmSpace.sm),
                        )
                    }
                }

                OFFLINE_MODELS.forEach { model ->
                    val isDownloaded = downloaded[model.id] == true
                    val hasStoredFile = stored[model.id] == true
                    val incomplete = hasStoredFile && !isDownloaded && progress[model.id] == null
                    val selected = isDownloaded && selectedId == model.id
                    val modelProgress = progress[model.id] ?: 0
                    val compatibility = profile?.let { modelCompatibility(it, model, isDownloaded) }
                    val performance = remember(changes) { service.performance(model.id) }
                    ModelRow(
                        model = model,
                        selected = selected,
                        reduce = reduce,
                        isRecommended = recommended?.id == model.id,
                        isDownloaded = isDownloaded,
                        hasStoredFile = hasStoredFile,
                        incomplete = incomplete,
                        progress = modelProgress,
                        compatibilityText = compatibility?.let { Triple(it.score, it.label, levelColor(it.level)) },
                        performanceText = performance?.let { "Gerçek hız: ${jsNum(it.tokensPerSecond)} token/sn • ${it.comfortScore}/10" },
                        testing = testingId == model.id,
                        anyTesting = testingId != null,
                        onChoose = { chooseModel(model) },
                        onTest = { runDeviceTest(model, false) },
                        onDelete = { removeModel(model) },
                    )
                }
            }
        }
    }

    prompt?.let { pr ->
        AlertDialog(
            onDismissRequest = { prompt = null },
            title = { Text(pr.title) },
            text = { Text(pr.message) },
            confirmButton = {
                if (pr.confirm != null) {
                    TextButton(onClick = { prompt = null; pr.onConfirm() }) {
                        Text(pr.confirm, color = if (pr.danger) KmColors.danger else KmColors.brand)
                    }
                } else {
                    TextButton(onClick = { prompt = null }) { Text("Tamam", color = KmColors.brand) }
                }
            },
            dismissButton = if (pr.confirm != null) {
                { TextButton(onClick = { prompt = null }) { Text("Vazgeç", color = KmColors.textSecondary) } }
            } else {
                null
            },
            containerColor = KmColors.surfaceElevated,
            titleContentColor = KmColors.text,
            textContentColor = KmColors.textSecondary,
        )
    }
}

private fun jsNum(value: Double): String = if (value == Math.floor(value)) value.toLong().toString() else value.toString()

@Composable
private fun Badge(text: String, color: Color, background: Color) {
    Text(
        text,
        style = KmType.caption.copy(fontWeight = FontWeight.SemiBold),
        color = color,
        modifier = Modifier.clip(RoundedCornerShape(KmRadius.sm)).background(background).padding(horizontal = KmSpace.sm, vertical = KmSpace.xxs),
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ModelRow(
    model: OfflineModel,
    selected: Boolean,
    reduce: Boolean,
    isRecommended: Boolean,
    isDownloaded: Boolean,
    hasStoredFile: Boolean,
    incomplete: Boolean,
    progress: Int,
    compatibilityText: Triple<Int, String, Color>?,
    performanceText: String?,
    testing: Boolean,
    anyTesting: Boolean,
    onChoose: () -> Unit,
    onTest: () -> Unit,
    onDelete: () -> Unit,
) {
    // Seçilince kenarlık marka rengine döner (offline-models.tsx ModelRow).
    val border by animateColorAsState(
        if (selected) KmColors.brand else KmColors.border,
        tween(if (reduce) 0 else KmMotion.FAST, easing = KmMotion.standard),
        label = "modelBorder",
    )
    val shape = RoundedCornerShape(KmRadius.lg)
    Column(Modifier.fillMaxWidth().clip(shape).background(KmColors.surface).border(1.dp, border, shape).padding(KmSpace.lg)) {
        Row(
            Modifier.fillMaxWidth().pressableScale(onClick = onChoose, enabled = progress == 0, pressedOpacity = 0.7f),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(KmSpace.md),
        ) {
            Column(Modifier.weight(1f)) {
                FlowRow(
                    Modifier.padding(bottom = KmSpace.xs),
                    horizontalArrangement = Arrangement.spacedBy(KmSpace.sm),
                    verticalArrangement = Arrangement.spacedBy(KmSpace.xs),
                ) {
                    Text(model.name, style = KmType.callout.copy(fontWeight = FontWeight.SemiBold), color = KmColors.text)
                    Badge(model.qualityLabel, KmColors.brandSoft, KmColors.brandMuted)
                    if (isRecommended) Badge("Önerilen", KmColors.success, KmColors.successMuted)
                }
                Text(model.description, style = KmType.footnote, color = KmColors.textMuted)
                Text(
                    "${formatModelSize(model)}  •  En az ${model.minRamGB} GB RAM",
                    style = KmType.caption,
                    color = KmColors.textSecondary,
                    modifier = Modifier.padding(top = KmSpace.sm),
                )
                if (incomplete) {
                    Text(
                        "Eksik indirme • yeniden indir veya sil",
                        style = KmType.caption.copy(fontWeight = FontWeight.SemiBold),
                        color = KmColors.danger,
                        modifier = Modifier.padding(top = KmSpace.sm),
                    )
                }
                compatibilityText?.let { (score, label, color) ->
                    Row(Modifier.padding(top = KmSpace.sm), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(KmSpace.sm)) {
                        Badge("Türkçe ~${model.qualityScore}/10", KmColors.brandSoft, KmColors.brandMuted)
                        Badge("Rahatlık $score/10", color, KmColors.surfaceElevated)
                        Box(Modifier.size(7.dp).clip(CircleShape).background(color))
                        Text(label, style = KmType.caption.copy(fontWeight = FontWeight.SemiBold), color = color)
                    }
                }
                AnimatedVisibility(performanceText != null, enter = fadeIn(tween(if (reduce) 0 else KmMotion.FAST))) {
                    Text(
                        performanceText.orEmpty(),
                        style = KmType.caption.copy(fontWeight = FontWeight.SemiBold),
                        color = KmColors.success,
                        modifier = Modifier.padding(top = KmSpace.sm),
                    )
                }
                AnimatedVisibility(testing, enter = fadeIn(tween(if (reduce) 0 else KmMotion.FAST))) {
                    Text(
                        "Cihaz testi yapılıyor…",
                        style = KmType.caption.copy(fontWeight = FontWeight.SemiBold),
                        color = KmColors.brandSoft,
                        modifier = Modifier.padding(top = KmSpace.sm),
                    )
                }
                AnimatedVisibility(progress > 0, exit = fadeOut(tween(if (reduce) 0 else KmMotion.FAST))) {
                    ProgressBar(progress, reduce)
                }
            }
            Text(
                when {
                    progress > 0 -> "%$progress"
                    selected -> "Seçili"
                    isDownloaded -> "Seç"
                    else -> "İndir"
                },
                style = KmType.subhead.copy(fontWeight = FontWeight.SemiBold),
                color = if (selected) KmColors.success else KmColors.brand,
            )
        }
        if (hasStoredFile && progress == 0) {
            FlowRow(Modifier.padding(top = KmSpace.md), horizontalArrangement = Arrangement.spacedBy(KmSpace.sm)) {
                if (isDownloaded) {
                    SmallAction(KmIcons.Gauge, if (testing) "Test ediliyor" else "Test et ve kullan", KmColors.brandSoft, KmColors.brandMuted, enabled = !anyTesting, onClick = onTest)
                }
                SmallAction(KmIcons.Trash2, "Sil", KmColors.danger, KmColors.dangerMuted, onClick = onDelete)
            }
        }
    }
}

@Composable
private fun SmallAction(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    text: String,
    color: Color,
    background: Color,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .pressableScale(onClick = onClick, enabled = enabled, pressedOpacity = 0.7f)
            .clip(RoundedCornerShape(KmRadius.sm))
            .background(background)
            .padding(horizontal = KmSpace.md, vertical = KmSpace.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(KmSpace.sm),
    ) {
        KmIcon(icon, color, 17.dp)
        Text(text, style = KmType.caption.copy(fontWeight = FontWeight.SemiBold), color = color)
    }
}

/** Soldan büyüyen ilerleme çubuğu (scaleX animasyonu). */
@Composable
private fun ProgressBar(progress: Int, reduce: Boolean) {
    val value by animateFloatAsState(
        progress.coerceIn(0, 100) / 100f,
        tween(if (reduce) 0 else KmMotion.BASE, easing = KmMotion.standard),
        label = "progress",
    )
    Box(
        Modifier.padding(top = KmSpace.sm).fillMaxWidth().height(4.dp).clip(RoundedCornerShape(KmRadius.pill)).background(KmColors.surfaceElevated),
    ) {
        Box(
            Modifier
                .fillMaxSize()
                .graphicsLayer { scaleX = value; transformOrigin = TransformOrigin(0f, 0.5f) }
                .clip(RoundedCornerShape(KmRadius.pill))
                .background(KmColors.brand),
        )
    }
}
