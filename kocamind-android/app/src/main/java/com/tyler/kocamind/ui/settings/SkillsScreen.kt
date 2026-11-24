package com.tyler.kocamind.ui.settings

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.tyler.kocamind.data.backend.BackendClient
import com.tyler.kocamind.data.backend.SkillInfo
import com.tyler.kocamind.ui.components.ButtonSize
import com.tyler.kocamind.ui.components.ButtonVariant
import com.tyler.kocamind.ui.components.KmButton
import com.tyler.kocamind.ui.components.KmSkeleton
import com.tyler.kocamind.ui.theme.KmColors
import com.tyler.kocamind.ui.theme.KmSpace
import com.tyler.kocamind.ui.theme.KmType
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * Ayarlar > Skill'ler: yapay zekânın konuya göre kendiliğinden yüklediği talimat paketleri.
 * Yerleşik skill'ler salt okunur; kullanıcının sohbette kurdurduğu skill'ler buradan kaldırılabilir.
 */
@Composable
fun SkillsScreen(backend: BackendClient, onBack: () -> Unit, modifier: Modifier = Modifier) {
    var skills by remember { mutableStateOf<List<SkillInfo>?>(null) }
    var failed by remember { mutableStateOf(false) }
    var attempt by remember { mutableIntStateOf(0) }
    var busy by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    fun remove(skill: SkillInfo) {
        busy = skill.name
        scope.launch {
            try {
                backend.removeSkill(skill.name)
                Toast.makeText(context, "${skill.title} kaldırıldı.", Toast.LENGTH_SHORT).show()
                attempt++
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Toast.makeText(context, e.message ?: "Skill kaldırılamadı.", Toast.LENGTH_LONG).show()
            } finally {
                busy = null
            }
        }
    }

    LaunchedEffect(attempt) {
        failed = false
        try {
            skills = backend.skills()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            failed = true
        }
    }

    Column(modifier) {
        BackTitleHeader(title = "Skill'ler", onBack = onBack)
        SkillsContent(skills, failed = failed && skills == null, onRetry = { attempt++ }, onRemove = ::remove, busy = busy)
    }
}

@Composable
fun SkillsContent(
    skills: List<SkillInfo>?,
    failed: Boolean,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    onRemove: (SkillInfo) -> Unit = {},
    busy: String? = null,
) {
    Column(
        modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = KmSpace.lg).padding(top = KmSpace.sm, bottom = KmSpace.xl),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(Modifier.widthIn(max = 800.dp).fillMaxWidth()) {
            Rise(0) {
                Text(
                    "Skill'ler belirli işler için hazır talimatlardır. Bir şeye ihtiyaç duyduğunda KocaMind uygun olanı kendisi seçer; senin bir şey açman gerekmez. Sohbette bir skill'in adresini verip kurmasını istersen onayınla hesabına kurar; yalnızca metin talimatlar alınır, kod çalıştırılmaz.",
                    style = KmType.subhead, color = KmColors.textSecondary,
                    modifier = Modifier.padding(start = 4.dp, end = 4.dp, top = KmSpace.sm),
                )
            }
            when {
                skills == null && failed -> SettingsGroup(null, 1) {
                    SettingBlock {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text("Skill'ler yüklenemedi", style = KmType.callout, color = KmColors.text)
                                Text("İnternet bağlantını kontrol et.", style = KmType.footnote, color = KmColors.textMuted)
                            }
                            KmButton(text = "Tekrar dene", onClick = onRetry, size = ButtonSize.Sm, variant = ButtonVariant.Secondary)
                        }
                    }
                }
                skills == null -> SettingsGroup(null, 1) {
                    repeat(4) { SettingBlock { KmSkeleton(Modifier.fillMaxWidth(0.4f), height = 12.dp); GapV(8.dp); KmSkeleton(Modifier.fillMaxWidth(), height = 14.dp) } }
                }
                else -> {
                    val (installed, builtIn) = skills.partition { it.installed }
                    val (always, onDemand) = builtIn.partition { it.alwaysOn }
                    if (installed.isNotEmpty()) SettingsGroup("Kurduğun skill'ler", 1) {
                        installed.forEach { SkillRow(it, onRemove = { onRemove(it) }, removing = busy == it.name) }
                    }
                    if (always.isNotEmpty()) SettingsGroup("Her zaman açık", 2) { always.forEach { SkillRow(it) } }
                    if (onDemand.isNotEmpty()) SettingsGroup("Gerektiğinde yüklenir", 3) { onDemand.forEach { SkillRow(it) } }
                }
            }
        }
    }
}

@Composable
private fun SkillRow(skill: SkillInfo, onRemove: (() -> Unit)? = null, removing: Boolean = false) {
    SettingBlock {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(skill.title, style = KmType.callout, color = KmColors.text, modifier = Modifier.weight(1f))
            if (onRemove != null) {
                KmButton(
                    text = if (removing) "Kaldırılıyor" else "Kaldır",
                    onClick = onRemove,
                    size = ButtonSize.Sm,
                    variant = ButtonVariant.Secondary,
                    enabled = !removing,
                )
            }
            skill.where.forEach { place ->
                Text(
                    place,
                    style = KmType.footnote.copy(fontWeight = FontWeight.Medium),
                    color = KmColors.textSecondary,
                    modifier = Modifier.clip(RoundedCornerShape(50)).background(KmColors.bg).padding(horizontal = 10.dp, vertical = 4.dp),
                )
            }
        }
        GapV(6.dp)
        Text(skill.description, style = KmType.footnote, color = KmColors.textMuted)
        skill.sourceUrl?.let { source ->
            GapV(4.dp)
            Text("Kaynak: ${sourceLabel(source)}", style = KmType.footnote, color = KmColors.textMuted)
        }
    }
}

/** "https://raw.githubusercontent.com/sahip/repo/..." → "github.com/sahip/repo". */
internal fun sourceLabel(url: String): String {
    val uri = runCatching { java.net.URI(url) }.getOrNull() ?: return url
    val host = uri.host?.removePrefix("www.") ?: return url
    val parts = uri.path.orEmpty().split('/').filter { it.isNotEmpty() }.take(2)
    return (listOf(if (host == "raw.githubusercontent.com") "github.com" else host) + parts).joinToString("/")
}
