package com.tyler.kocamind.ui.settings

import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tyler.kocamind.AppContainer
import com.tyler.kocamind.data.backend.ConnectorButton
import com.tyler.kocamind.data.backend.ConnectorCatalog
import com.tyler.kocamind.data.backend.ConnectorInfo
import com.tyler.kocamind.data.backend.connectorButton
import com.tyler.kocamind.ui.components.ButtonSize
import com.tyler.kocamind.ui.components.ButtonVariant
import com.tyler.kocamind.ui.components.KmButton
import com.tyler.kocamind.ui.components.KmIcon
import com.tyler.kocamind.ui.components.KmSkeleton
import com.tyler.kocamind.ui.icons.KmIcons
import com.tyler.kocamind.ui.theme.KmColors
import com.tyler.kocamind.ui.theme.KmSpace
import com.tyler.kocamind.ui.theme.KmType
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

data class ConnectorsUiState(
    val catalog: ConnectorCatalog? = null,
    val failed: Boolean = false,
    /** İşlemi süren bağlantının kimliği (bağlanıyor ya da kesiliyor). */
    val busy: String? = null,
)

data class ConnectorsActions(
    val onRetry: () -> Unit = {},
    val onConnect: (ConnectorInfo) -> Unit = {},
    val onDisconnect: (ConnectorInfo) -> Unit = {},
)

/** Ayarlar > Bağlantılar: Google Takvim, Drive, Notion ve GitHub hesaplarını bağlar ya da keser. */
@Composable
fun ConnectorsScreen(container: AppContainer, onBack: () -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val backend = container.backendClient
    var catalog by remember { mutableStateOf<ConnectorCatalog?>(null) }
    var failed by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf<String?>(null) }
    var attempt by remember { mutableIntStateOf(0) }
    var askDisconnect by remember { mutableStateOf<ConnectorInfo?>(null) }
    val returned by container.connectorReturn.collectAsStateWithLifecycle()

    LaunchedEffect(attempt) {
        failed = false
        try {
            catalog = backend.connectors()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            failed = true
        }
    }
    // Tarayıcıdaki izin ekranından (deep link'le ya da geri tuşuyla) dönünce durum yenilenir.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        busy = null
        attempt++
    }
    LaunchedEffect(returned) {
        val result = returned ?: return@LaunchedEffect
        Toast.makeText(context, result.message, if (result.success) Toast.LENGTH_SHORT else Toast.LENGTH_LONG).show()
        container.connectorReturn.value = null
        attempt++
    }

    fun connect(info: ConnectorInfo) {
        busy = info.id
        scope.launch {
            try {
                val url = backend.startConnector(info.id)
                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                busy = null
                Toast.makeText(context, e.message ?: "Bağlantı başlatılamadı.", Toast.LENGTH_LONG).show()
            }
        }
    }

    fun disconnect(info: ConnectorInfo) {
        busy = info.id
        scope.launch {
            try {
                backend.disconnectConnector(info.id)
                Toast.makeText(context, "${info.label} bağlantısı kesildi.", Toast.LENGTH_SHORT).show()
                attempt++
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Toast.makeText(context, e.message ?: "Bağlantı kesilemedi.", Toast.LENGTH_LONG).show()
            } finally {
                busy = null
            }
        }
    }

    Column(modifier) {
        BackTitleHeader(title = "Bağlantılar", onBack = onBack)
        ConnectorsContent(
            ConnectorsUiState(catalog, failed = failed && catalog == null, busy = busy),
            ConnectorsActions(onRetry = { attempt++ }, onConnect = ::connect, onDisconnect = { askDisconnect = it }),
        )
    }

    askDisconnect?.let { info ->
        AlertDialog(
            onDismissRequest = { askDisconnect = null },
            icon = {
                Box(Modifier.size(40.dp).clip(CircleShape).background(KmColors.dangerMuted), contentAlignment = Alignment.Center) {
                    KmIcon(KmIcons.X, KmColors.danger, 20.dp)
                }
            },
            title = { Text("${info.label} bağlantısı kesilsin mi?", style = KmType.title.copy(fontWeight = FontWeight.Medium), textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()) },
            text = {
                Text(
                    "KocaMind bu hesaba artık erişemez. İstediğin zaman yeniden bağlayabilirsin.",
                    style = KmType.subhead, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    askDisconnect = null
                    disconnect(info)
                }) { Text("Bağlantıyı kes", color = KmColors.danger, fontWeight = FontWeight.SemiBold) }
            },
            dismissButton = { TextButton(onClick = { askDisconnect = null }) { Text("Vazgeç", color = KmColors.brand, fontWeight = FontWeight.SemiBold) } },
            containerColor = KmColors.surface,
            titleContentColor = KmColors.text,
            textContentColor = KmColors.textSecondary,
            shape = RoundedCornerShape(28.dp),
        )
    }
}

@Composable
fun ConnectorsContent(state: ConnectorsUiState, actions: ConnectorsActions, modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = KmSpace.lg).padding(top = KmSpace.sm, bottom = KmSpace.xl),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(Modifier.widthIn(max = 800.dp).fillMaxWidth()) {
            Rise(0) {
                Text(
                    "Hesaplarını bağla, KocaMind sohbette takvimine, dosyalarına ve notlarına bakabilsin. Bir şey eklemek ya da değiştirmek için her zaman onayını ister.",
                    style = KmType.subhead, color = KmColors.textSecondary,
                    modifier = Modifier.padding(start = 4.dp, end = 4.dp, top = KmSpace.sm),
                )
            }
            val catalog = state.catalog
            when {
                catalog == null && state.failed -> SettingsGroup(null, 1) {
                    SettingBlock {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text("Bağlantılar yüklenemedi", style = KmType.callout, color = KmColors.text)
                                Text("İnternet bağlantını kontrol et.", style = KmType.footnote, color = KmColors.textMuted)
                            }
                            KmButton(text = "Tekrar dene", onClick = actions.onRetry, size = ButtonSize.Sm, variant = ButtonVariant.Secondary)
                        }
                    }
                }
                catalog == null -> SettingsGroup(null, 1) {
                    repeat(4) { SettingBlock { KmSkeleton(Modifier.fillMaxWidth(0.4f), height = 12.dp); GapV(8.dp); KmSkeleton(Modifier.fillMaxWidth(), height = 14.dp) } }
                }
                else -> {
                    if (!catalog.enabled) {
                        Text(
                            "Bağlantılar çok yakında açılıyor.",
                            style = KmType.footnote, color = KmColors.textMuted,
                            modifier = Modifier.padding(start = 4.dp, top = KmSpace.md),
                        )
                    }
                    SettingsGroup(null, 1) {
                        catalog.connectors.forEach { info ->
                            ConnectorRow(info, connectorButton(info, catalog), busy = state.busy == info.id, actions)
                        }
                    }
                }
            }
        }
    }
}

private fun connectorIcon(id: String): ImageVector = when (id) {
    "google_calendar" -> KmIcons.Calendar
    "google_drive" -> KmIcons.Database
    "notion" -> KmIcons.Notebook
    "github" -> KmIcons.BracketsCurly
    else -> KmIcons.Globe2
}

@Composable
private fun ConnectorRow(info: ConnectorInfo, button: ConnectorButton, busy: Boolean, actions: ConnectorsActions) {
    SettingBlock {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Box(Modifier.size(38.dp).clip(CircleShape).background(KmColors.bg), contentAlignment = Alignment.Center) {
                KmIcon(connectorIcon(info.id), KmColors.textSecondary, 19.dp)
            }
            Column(Modifier.weight(1f)) {
                Text(info.label, style = KmType.callout, color = KmColors.text)
                val status = when (button) {
                    ConnectorButton.Connected -> "Bağlı"
                    ConnectorButton.Reauth -> "Yeniden bağlanman gerekiyor"
                    else -> null
                }
                if (status != null) {
                    Text(status, style = KmType.footnote, color = if (button == ConnectorButton.Reauth) KmColors.warning else KmColors.success)
                }
            }
            when (button) {
                ConnectorButton.Connect -> KmButton("Bağla", onClick = { actions.onConnect(info) }, size = ButtonSize.Sm, loading = busy)
                ConnectorButton.Reauth -> KmButton("Yeniden bağla", onClick = { actions.onConnect(info) }, size = ButtonSize.Sm, loading = busy)
                ConnectorButton.Connected -> KmButton(
                    "Kes", onClick = { actions.onDisconnect(info) }, size = ButtonSize.Sm, variant = ButtonVariant.Secondary, loading = busy,
                )
                ConnectorButton.Plus -> Badge("Plus")
                ConnectorButton.Soon -> Badge("Yakında")
            }
        }
        GapV(8.dp)
        Text(info.description, style = KmType.footnote, color = KmColors.textMuted)
    }
}

@Composable
private fun Badge(text: String) {
    Text(
        text,
        style = KmType.footnote.copy(fontWeight = FontWeight.Medium),
        color = KmColors.textSecondary,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(KmColors.bg).padding(horizontal = 10.dp, vertical = 4.dp),
    )
}
