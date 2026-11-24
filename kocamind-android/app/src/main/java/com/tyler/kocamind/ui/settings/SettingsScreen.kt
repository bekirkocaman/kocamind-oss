package com.tyler.kocamind.ui.settings

import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
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
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.tyler.kocamind.AppContainer
import com.tyler.kocamind.BuildConfig
import com.tyler.kocamind.data.backend.DailyUsage
import com.tyler.kocamind.data.chat.ChatCommand
import com.tyler.kocamind.ui.components.ButtonSize
import com.tyler.kocamind.ui.components.ButtonVariant
import com.tyler.kocamind.ui.components.KmButton
import com.tyler.kocamind.ui.components.KmIcon
import com.tyler.kocamind.ui.components.KmIconButton
import com.tyler.kocamind.ui.components.KmSkeleton
import com.tyler.kocamind.ui.components.rememberReduceMotion
import com.tyler.kocamind.ui.icons.KmIcons
import com.tyler.kocamind.ui.theme.KmColors
import com.tyler.kocamind.ui.theme.KmMotion
import com.tyler.kocamind.ui.theme.KmSpace
import com.tyler.kocamind.ui.theme.KmType
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant
import java.util.Locale
import com.tyler.kocamind.ui.components.KmSheet
import com.tyler.kocamind.ui.theme.ThemeMode

private val TR = Locale.forLanguageTag("tr")

private data class Confirm(
    val title: String,
    val message: String,
    val action: String,
    val icon: ImageVector,
    val danger: Boolean,
    val confirmWord: String? = null,
    val run: () -> Unit,
)

/** Kullanım kartının durumu: uç yanıt vermezse sayı uydurulmaz. */
sealed interface UsageState {
    data object Loading : UsageState
    data class Ready(val usage: DailyUsage) : UsageState
    data object Failed : UsageState
}

/** Onay kelimesi (ör. "SİL") büyük/küçük harf ve boşluktan bağımsız eşleşir. */
fun confirmWordMatches(typed: String, word: String): Boolean = typed.trim().uppercase(TR) == word

private fun previewOf(text: String) = if (text.length > 46) text.take(44) + "…" else text

/** Ayarlar: profil + günlük limit, gruplu kartlar (Android 16 düzeni). */
@Composable
fun SettingsScreen(
    container: AppContainer,
    onBack: () -> Unit,
    onAdmin: () -> Unit,
    onOfflineModels: () -> Unit,
    onLibrary: () -> Unit,
    onCustomInstructions: () -> Unit,
    onMemory: () -> Unit,
    onConnectors: () -> Unit,
    onSkills: () -> Unit,
    onSignedOut: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val authUser by container.authRepository.currentUser.collectAsStateWithLifecycle()
    val user = authUser?.takeIf { it.emailVerified }
    var isAdmin by remember { mutableStateOf(false) }
    var plan by remember { mutableStateOf("free") }
    var usage by remember { mutableStateOf<UsageState>(UsageState.Loading) }
    var usageAttempt by remember { mutableIntStateOf(0) }
    var confirm by remember { mutableStateOf<Confirm?>(null) }
    var info by remember { mutableStateOf<Pair<String, String>?>(null) }
    var exporting by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    val themeMode by container.themePrefs.mode.collectAsStateWithLifecycle()
    val reduceMotion by container.themePrefs.reduceMotion.collectAsStateWithLifecycle()
    val library by container.libraryStore.images.collectAsStateWithLifecycle()
    val openChatId by container.chatCommands.openChatId.collectAsStateWithLifecycle()
    // Özel talimatlar sayfasından dönünce güncel alt yazı için her bileşimde okunur.
    val instructions = container.chatPrefs.customInstructions(user?.email)
    val memories by container.memoryRepository.memories.collectAsStateWithLifecycle()
    val memoryOn by container.memoryRepository.prefs.enabled.collectAsStateWithLifecycle()

    LaunchedEffect(user?.uid) {
        if (user == null) {
            isAdmin = false
            plan = "free"
            return@LaunchedEffect
        }
        isAdmin = runCatching { container.authRepository.isAdmin() }.getOrDefault(false)
        plan = try { container.backendClient.getBillingPlan() } catch (e: CancellationException) { throw e } catch (e: Exception) { "free" }
    }
    LaunchedEffect(user?.uid, usageAttempt) {
        if (user == null) return@LaunchedEffect
        usage = UsageState.Loading
        usage = try {
            container.backendClient.dailyUsage()?.let { UsageState.Ready(it) } ?: UsageState.Failed
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            UsageState.Failed
        }
    }

    fun clearHistory() {
        scope.launch {
            val result = clearChatHistory(container.chatStore, user?.uid) { uid ->
                container.cloudChatSync?.deleteAll(uid)
            }
            container.chatCommands.send(ChatCommand.NewChat)
            when (result) {
                ClearResult.Done -> Toast.makeText(context, "Tüm sohbet geçmişin silindi", Toast.LENGTH_SHORT).show()
                ClearResult.CloudFailed -> info = "Kısmen temizlendi" to
                    "Bu cihazdaki sohbetler silindi ama buluttaki sohbetler silinemedi. İnternet bağlantını kontrol edip tekrar dene."
            }
        }
    }

    fun signOut() {
        container.authRepository.signOut()
        container.chatCommands.send(ChatCommand.NewChat)
        onSignedOut()
    }

    fun deleteAccount() {
        deleting = true
        scope.launch {
            try {
                val uid = container.authRepository.currentUser.value?.uid
                container.backendClient.deleteAccount()
                uid?.let { container.memoryRepository.forget(it) }
                container.authRepository.signOut()
                container.chatCommands.send(ChatCommand.NewChat)
                onSignedOut()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                deleting = false
                info = "Hesap silinemedi" to (e.message ?: "İşlem tamamlanamadı.")
            }
        }
    }

    fun open(url: String) {
        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            .onFailure { Toast.makeText(context, "Bağlantı açılamadı", Toast.LENGTH_SHORT).show() }
    }

    val appPrefs = container.appPrefs
    val replySans by appPrefs.replySans.collectAsStateWithLifecycle()
    val haptics by appPrefs.haptics.collectAsStateWithLifecycle()
    var sheet by remember { mutableStateOf<SettingsSheet?>(null) }
    fun soon(name: String): () -> Unit = { Toast.makeText(context, "$name yakında", Toast.LENGTH_SHORT).show() }
    val soonLabel = "Yakında"

    // Klon düzeni: bölüm başlığı yok; en üstte hesap satırı ve yükseltme kartı, sonra gruplar.
    Column(modifier) {
        BackTitleHeader(title = "Ayarlar", onBack = onBack)
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = KmSpace.lg)
                .padding(top = KmSpace.sm, bottom = KmSpace.xl),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(Modifier.widthIn(max = 800.dp).fillMaxWidth()) {
                Rise(0) {
                    AccountRow(
                        label = user?.email ?: "Misafir",
                        name = user?.displayName?.takeIf { it.isNotBlank() } ?: if (user != null) "Kullanıcı" else "Misafir",
                        photo = user?.photoUrl,
                        badge = when {
                            user == null -> null
                            plan == "pro" -> "Pro"
                            else -> "Ücretsiz"
                        },
                        onClick = { sheet = SettingsSheet.Profile },
                    )
                }
                if (user != null && plan != "pro") {
                    Rise(1) { UpgradeCard(onUpgrade = soon("Yükseltme")) }
                }

                SettingsGroup(null, 1) {
                    SettingRow(KmIcons.User, "Profil", onClick = { sheet = SettingsSheet.Profile })
                    SettingRow(KmIcons.Calendar, "Faturalandırma", value = soonLabel, onClick = soon("Faturalandırma"))
                    SettingRow(KmIcons.Clock, "Kullanım", onClick = { sheet = SettingsSheet.Usage })
                }

                SettingsGroup(null, 2) {
                    SettingRow(KmIcons.Star, "Özellikler", value = soonLabel, onClick = soon("Özellikler"))
                    SettingRow(KmIcons.Terminal, "Code", value = soonLabel, onClick = soon("Code ayarları"))
                    SettingRow(KmIcons.Globe2, "Bağdaştırıcılar", "Google Takvim, Drive, Notion ve GitHub hesaplarını bağla", onClick = onConnectors)
                    SettingRow(KmIcons.BracketsCurly, "API anahtarı", value = soonLabel, onClick = soon("API anahtarı"))
                }

                SettingsGroup(null, 3) {
                    SettingRow(
                        KmIcons.MessageSquarePlus, "Özel Talimatlar",
                        subtitle = instructions.takeIf { it.isNotBlank() }?.let(::previewOf) ?: "AI'ın davranışını özelleştir",
                        onClick = onCustomInstructions,
                    )
                    SettingRow(
                        KmIcons.Notebook, "Hafıza",
                        subtitle = when {
                            !memoryOn -> "Kapalı"
                            memories.isNullOrEmpty() -> "Seni nasıl hatırladığını yönet"
                            else -> "${memories!!.size} bilgi hatırlanıyor"
                        },
                        onClick = onMemory,
                    )
                    SettingRow(KmIcons.Lightbulb, "Skill'ler", "Yapay zekânın kullandığı hazır talimatlar", onClick = onSkills)
                    SettingRow(KmIcons.CloudSlash, "Çevrimdışı AI Modelleri", "Model indir, cihaz puanını gör veya indirilen modeli sil", onClick = onOfflineModels)
                }

                SettingsGroup(null, 4) {
                    SettingRow(KmIcons.Eye, "Renk modu", value = themeLabel(themeMode), onClick = { sheet = SettingsSheet.ColorMode })
                    SettingRow(KmIcons.Quotes, "Yazı tipi stili", value = if (replySans) "Sade" else "Serif", onClick = { sheet = SettingsSheet.Font })
                    SettingRow(KmIcons.Volume2, "Ses", onClick = { sheet = SettingsSheet.Voice })
                    SettingSwitchRow(KmIcons.Smartphone, "Dokunsal geri bildirim", null, checked = haptics, onChange = appPrefs::setHaptics)
                    SettingSwitchRow(
                        KmIcons.Gauge, "Azaltılmış hareket", "Animasyonları en aza indirir",
                        checked = reduceMotion, onChange = container.themePrefs::setReduceMotion,
                    )
                    SettingRow(KmIcons.MailCheck, "Bildirimler", onClick = { sheet = SettingsSheet.Notifications })
                    SettingRow(KmIcons.Lock, "Gizlilik", onClick = { sheet = SettingsSheet.Privacy })
                    SettingRow(KmIcons.Share2, "Paylaşım", value = soonLabel, onClick = soon("Paylaşım"))
                }

                SettingsGroup(null, 5) {
                    SettingRow(KmIcons.LayoutGrid, "Kitaplık", if (library.isEmpty()) "Henüz görsel yok" else "${library.size} görsel", onClick = onLibrary)
                    SettingRow(KmIcons.Download, "Sohbetleri Dışa Aktar", "Okunaklı belge, Markdown veya metin olarak indir", onClick = { exporting = true })
                    SettingRow(KmIcons.Trash2, "Sohbet Geçmişini Temizle", if (user != null) "Bu cihazdaki ve buluttaki sohbetler" else "Bu cihazdaki sohbetler") {
                        confirm = Confirm(
                            "Sohbet geçmişi silinsin mi?", "Tüm sohbet geçmişin silinecek. Bu işlem geri alınamaz.",
                            "Sil", KmIcons.Trash2, danger = true, run = ::clearHistory,
                        )
                    }
                }

                if (isAdmin) {
                    SettingsGroup(null, 6) {
                        SettingRow(KmIcons.ShieldCheck, "Admin Paneli", "Kullanıcıları arayın ve yönetin", onClick = onAdmin)
                    }
                }

                SettingsGroup(null, 7) {
                    SettingRow(KmIcons.Mail, "Bize Ulaşın") {
                        open("mailto:destek@kocamind.com?subject=" + Uri.encode("KocaMind Geri Bildirim / Hata Bildirimi"))
                    }
                    SettingRow(KmIcons.MessageCircle, "Hata bildir") { sheet = SettingsSheet.BugReport }
                    SettingRow(KmIcons.Shield, "Gizlilik Politikası") { open("https://kocamind.com/privacy.html") }
                    SettingRow(KmIcons.FileText, "Kullanım Koşulları") { open("https://kocamind.com/terms.html") }
                    SettingRow(KmIcons.Info, "Uygulama Versiyonu", value = BuildConfig.VERSION_NAME, onClick = null)
                }

                if (user != null) {
                    SettingsGroup(null, 8) {
                        SettingRow(KmIcons.LogOut, "Oturumu kapat", chevron = false) {
                            confirm = Confirm(
                                "Çıkış Yap", "Hesabınızdan çıkış yapmak istediğinize emin misiniz?",
                                "Çıkış Yap", KmIcons.LogOut, danger = false, run = ::signOut,
                            )
                        }
                        SettingRow(
                            KmIcons.Trash2, "Hesabı sil",
                            subtitle = if (deleting) "Siliniyor…" else "Hesap kilitlenir, veriler 60 gün sonra silinir",
                            danger = true, chevron = false,
                            onClick = if (deleting) null else {
                                {
                                    confirm = Confirm(
                                        "Hesabı sil",
                                        "Hesabın hemen kilitlenir. Sohbetlerin, hafızan ve dosyaların 60 gün sonra kalıcı olarak silinir; bu süre içinde giriş yapıp geri alabilirsin.",
                                        "Hesabı sil", KmIcons.Trash2, danger = true, confirmWord = "SİL", run = ::deleteAccount,
                                    )
                                }
                            },
                        )
                    }
                }
            }
        }
    }

    when (sheet) {
        SettingsSheet.Profile -> ProfileSheet(
            name = user?.displayName.orEmpty(),
            email = user?.email,
            photo = user?.photoUrl,
            planLabel = when {
                user == null -> "Misafir modu"
                plan == "pro" -> "PRO Üye"
                else -> "Ücretsiz plan"
            },
            signedIn = user != null,
            onSave = { name -> container.authRepository.updateDisplayName(name) },
            onClose = { sheet = null },
        )
        SettingsSheet.Usage -> KmSheet(visible = true, onClose = { sheet = null }, title = "Kullanım") {
            if (user == null) {
                Text("Kullanım bilgisi için giriş yapmalısın.", style = KmType.subhead, color = KmColors.textSecondary)
            } else {
                Column(Modifier.fillMaxWidth().clip(GroupOuter)) { UsageCard(usage, onRetry = { usageAttempt++ }) }
                Text(
                    "Günlük limit her gün gece yarısı yenilenir. PRO üyelikte limit daha yüksektir.",
                    style = KmType.footnote, color = KmColors.textMuted,
                    modifier = Modifier.padding(top = KmSpace.md, start = 6.dp),
                )
            }
        }
        SettingsSheet.ColorMode -> ChoiceSheet(
            title = "Renk modu",
            options = listOf(ThemeMode.System to "Sistem", ThemeMode.Light to "Açık", ThemeMode.Dark to "Koyu"),
            selected = themeMode,
            onSelect = container.themePrefs::set,
            onClose = { sheet = null },
        )
        SettingsSheet.Font -> FontSheet(replySans, appPrefs::setReplySans) { sheet = null }
        SettingsSheet.Voice -> VoiceSheet(appPrefs) { sheet = null }
        SettingsSheet.Notifications -> NotificationsSheet(appPrefs) { sheet = null }
        SettingsSheet.BugReport -> key(user?.uid) {
            BugReportSheet(
                signedIn = user != null,
                onReport = { container.backendClient.sendBugReport(it) },
                onClose = { sheet = null },
            )
        }
        SettingsSheet.Privacy -> PrivacySheet(
            appPrefs = appPrefs,
            memoryOn = memoryOn,
            onMemoryChange = container.memoryRepository.prefs::setEnabled,
            onPolicy = { open("https://kocamind.com/privacy.html") },
            onClose = { sheet = null },
        )
        null -> Unit
    }

    ExportSheet(visible = exporting, store = container.chatStore, openChatId = openChatId, onClose = { exporting = false })

    confirm?.let { c -> ConfirmDialog(c, onDismiss = { confirm = null }) }
    info?.let { (title, message) ->
        AlertDialog(
            onDismissRequest = { info = null },
            title = { Text(title, style = KmType.title.copy(fontWeight = FontWeight.Medium), textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()) },
            text = { Text(message, style = KmType.subhead, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()) },
            confirmButton = { TextButton(onClick = { info = null }) { Text("Tamam", color = KmColors.brand) } },
            containerColor = KmColors.surface,
            titleContentColor = KmColors.text,
            textContentColor = KmColors.textSecondary,
            shape = RoundedCornerShape(28.dp),
        )
    }
}

@Composable
private fun ConfirmDialog(c: Confirm, onDismiss: () -> Unit) {
    var typed by remember { mutableStateOf("") }
    val ready = c.confirmWord == null || confirmWordMatches(typed, c.confirmWord)
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = {
            Box(
                Modifier.size(40.dp).clip(CircleShape).background(if (c.danger) KmColors.dangerMuted else KmColors.bg),
                contentAlignment = Alignment.Center,
            ) { KmIcon(c.icon, if (c.danger) KmColors.danger else KmColors.textSecondary, 20.dp) }
        },
        title = { Text(c.title, style = KmType.title.copy(fontWeight = FontWeight.Medium), textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()) },
        text = {
            Column {
                Text(c.message, style = KmType.subhead, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
                if (c.confirmWord != null) {
                    GapV(14.dp)
                    Text("Onaylamak için ${c.confirmWord} yaz", style = KmType.footnote, color = KmColors.textMuted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
                    GapV(8.dp)
                    val shape = RoundedCornerShape(14.dp)
                    BasicTextField(
                        value = typed,
                        onValueChange = { typed = it.take(12) },
                        singleLine = true,
                        textStyle = KmType.callout.copy(color = KmColors.text, textAlign = TextAlign.Center),
                        cursorBrush = SolidColor(KmColors.danger),
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(shape)
                            .background(KmColors.bg)
                            .border(1.dp, if (ready) KmColors.danger else KmColors.border, shape)
                            .semantics { contentDescription = "Onay kelimesi" }
                            .padding(horizontal = 14.dp, vertical = 12.dp),
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onDismiss(); c.run() }, enabled = ready) {
                Text(c.action, color = if (!ready) KmColors.textMuted else if (c.danger) KmColors.danger else KmColors.brand, fontWeight = FontWeight.SemiBold)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Vazgeç", color = KmColors.brand, fontWeight = FontWeight.SemiBold) }
        },
        containerColor = KmColors.surface,
        titleContentColor = KmColors.text,
        textContentColor = KmColors.textSecondary,
        shape = RoundedCornerShape(28.dp),
    )
}

/** Ortalanmış başlıklı, geri düğmeli üst çubuk; [action] sağ köşeye konur, başlık ekranın ortasında kalır. */
@Composable
fun BackTitleHeader(title: String, onBack: () -> Unit, action: (@Composable () -> Unit)? = null) {
    Column(Modifier.fillMaxWidth()) {
        Box(
            Modifier
                .widthIn(max = 920.dp)
                .fillMaxWidth()
                .align(Alignment.CenterHorizontally)
                .padding(horizontal = KmSpace.lg, vertical = KmSpace.md),
            contentAlignment = Alignment.Center,
        ) {
            Box(Modifier.align(Alignment.CenterStart)) {
                KmIconButton(onClick = onBack, contentDescription = "Geri dön", background = KmColors.surface) {
                    KmIcon(KmIcons.ArrowLeft, KmColors.text, 24.dp)
                }
            }
            Text(
                title,
                style = KmType.headline,
                color = KmColors.text,
                textAlign = TextAlign.Center,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(horizontal = 84.dp),
            )
            if (action != null) Box(Modifier.align(Alignment.CenterEnd)) { action() }
        }
        Box(Modifier.fillMaxWidth().height(0.5.dp).background(KmColors.border))
    }
}

/** Profil fotoğrafı ya da adın baş harfi. */
@Composable
fun ProfileAvatar(name: String, photo: String?, size: Dp, modifier: Modifier = Modifier) {
    if (photo != null) {
        AsyncImage(
            model = photo,
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = modifier.size(size).clip(CircleShape),
        )
    } else {
        Box(modifier.size(size).clip(CircleShape).background(KmColors.brandMuted), contentAlignment = Alignment.Center) {
            Text(
                name.firstOrNull()?.toString()?.uppercase(TR) ?: "M",
                style = if (size >= 48.dp) KmType.title else KmType.subhead.copy(fontWeight = FontWeight.SemiBold),
                color = KmColors.brand,
            )
        }
    }
}

@Composable
private fun UsageCard(state: UsageState, onRetry: () -> Unit) {
    val reduce = rememberReduceMotion()
    Column(Modifier.fillMaxWidth().background(KmColors.surface).padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 16.dp)) {
        AnimatedContent(
            targetState = state,
            transitionSpec = { fadeIn(tween(if (reduce) 0 else 250)) togetherWith fadeOut(tween(if (reduce) 0 else 120)) },
            contentKey = { it::class },
            label = "usage",
        ) { s ->
            when (s) {
                UsageState.Loading -> Column {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Günlük limit", style = KmType.subhead.copy(fontWeight = FontWeight.SemiBold), color = KmColors.text)
                        KmSkeleton(Modifier.width(90.dp), height = 14.dp)
                    }
                    KmSkeleton(Modifier.fillMaxWidth().padding(vertical = 10.dp), height = 8.dp)
                    KmSkeleton(Modifier.width(160.dp), height = 12.dp)
                }
                UsageState.Failed -> Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Günlük limit", style = KmType.subhead.copy(fontWeight = FontWeight.SemiBold), color = KmColors.text)
                        Text("Kullanım bilgisi alınamadı", style = KmType.footnote, color = KmColors.textMuted)
                    }
                    KmButton(text = "Tekrar dene", onClick = onRetry, size = ButtonSize.Sm, variant = ButtonVariant.Secondary)
                }
                is UsageState.Ready -> UsageMeter(s.usage)
            }
        }
    }
}

@Composable
private fun UsageMeter(usage: DailyUsage) {
    val reduce = rememberReduceMotion()
    val pct = usage.percent
    val fill = remember { Animatable(if (reduce) pct / 100f else 0f) }
    LaunchedEffect(pct) {
        if (!reduce) delay(250)
        fill.animateTo(pct / 100f, tween(if (reduce) 0 else 900, easing = KmMotion.standard))
    }
    val color by animateColorAsState(
        when (usageLevel(pct)) {
            UsageLevel.Ok -> KmColors.brand
            UsageLevel.Warn -> KmColors.warning
            UsageLevel.Bad -> KmColors.danger
        },
        label = "usageColor",
    )
    var countdown by remember { mutableStateOf(resetCountdown(Instant.now())) }
    LaunchedEffect(Unit) {
        while (true) {
            countdown = resetCountdown(Instant.now())
            delay(1000)
        }
    }
    Column {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Bottom) {
            Text("Günlük limit", style = KmType.subhead.copy(fontWeight = FontWeight.SemiBold), color = KmColors.text)
            Text("%$pct kullanıldı", style = KmType.subhead.copy(fontWeight = FontWeight.SemiBold), color = KmColors.text)
        }
        Box(
            Modifier
                .padding(top = 10.dp, bottom = 8.dp)
                .fillMaxWidth()
                .height(8.dp)
                .clip(RoundedCornerShape(99.dp))
                .background(KmColors.bg)
                .semantics {
                    contentDescription = "Günlük limit kullanımı"
                    progressBarRangeInfo = ProgressBarRangeInfo(pct / 100f, 0f..1f)
                },
        ) {
            Box(Modifier.fillMaxHeight().fillMaxWidth(fill.value).clip(RoundedCornerShape(99.dp)).background(color))
        }
        Text(
            (if (pct >= 100) "Limit doldu" else "Kalan %${100 - pct}") + " · Yenilenmeye $countdown",
            style = KmType.caption.copy(fontWeight = FontWeight.Normal),
            color = KmColors.textMuted,
        )
    }
}
