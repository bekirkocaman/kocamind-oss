package com.tyler.kocamind.ui.settings

import android.Manifest
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.speech.tts.TextToSpeech
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tyler.kocamind.data.settings.AppPrefs
import com.tyler.kocamind.data.settings.ReplyNotifier
import com.tyler.kocamind.data.settings.VOICE_RATES
import com.tyler.kocamind.data.settings.VoiceLang
import com.tyler.kocamind.ui.components.KmButton
import com.tyler.kocamind.ui.components.KmIcon
import com.tyler.kocamind.ui.components.KmSheet
import com.tyler.kocamind.ui.components.pressableScale
import com.tyler.kocamind.ui.icons.KmIcons
import com.tyler.kocamind.ui.theme.KmColors
import com.tyler.kocamind.ui.theme.KmFont
import com.tyler.kocamind.ui.theme.KmReplyFont
import com.tyler.kocamind.ui.theme.KmSpace
import com.tyler.kocamind.ui.theme.KmType
import com.tyler.kocamind.ui.theme.ThemeMode
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.util.Locale

/** Ayarlar ekranından açılan alt sayfalar. */
enum class SettingsSheet { Profile, Usage, ColorMode, Font, Voice, Notifications, Privacy, BugReport }

fun themeLabel(mode: ThemeMode) = when (mode) {
    ThemeMode.System -> "Sistem"
    ThemeMode.Light -> "Açık"
    ThemeMode.Dark -> "Koyu"
}

/** Klon düzeni: en üstte e-posta, sağda plan hapı. */
@Composable
internal fun AccountRow(label: String, name: String, photo: String?, badge: String?, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(GroupOuter)
            .background(KmColors.surface)
            .pressableScale(onClick = onClick, pressedOpacity = 0.8f, onClickLabel = "Profil")
            .heightIn(min = 64.dp)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        ProfileAvatar(name, photo, 36.dp)
        Text(label, style = KmType.callout.copy(fontWeight = FontWeight.Normal), color = KmColors.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        if (badge != null) {
            Text(
                badge,
                style = KmType.caption.copy(fontWeight = FontWeight.SemiBold),
                color = KmColors.bg,
                modifier = Modifier.clip(CircleShape).background(KmColors.text).padding(horizontal = 12.dp, vertical = 5.dp),
            )
        }
        KmIcon(KmIcons.ChevronDown, KmColors.textMuted, 18.dp)
    }
}

/** Klon düzeni: çerçeveli "Daha fazlasını ister misin?" kartı. */
@Composable
internal fun UpgradeCard(onUpgrade: () -> Unit) {
    Column(
        Modifier
            .padding(top = 14.dp)
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .border(1.dp, KmColors.border, RoundedCornerShape(20.dp))
            .padding(22.dp),
    ) {
        Text("Daha fazlasını ister misin?", style = KmType.headline, color = KmColors.text)
        Text("Daha fazla kullanım ve özellik için yükselt.", style = KmType.body, color = KmColors.textSecondary, modifier = Modifier.padding(top = 4.dp))
        Text(
            "Yükselt",
            style = KmType.callout,
            color = KmColors.bg,
            modifier = Modifier
                .padding(top = 16.dp)
                .clip(CircleShape)
                .background(KmColors.text)
                .pressableScale(onClick = onUpgrade, onClickLabel = "Yükselt")
                .padding(horizontal = 20.dp, vertical = 12.dp),
        )
    }
}

/** Gruplu seçenek listesi; seçilinin yanında mavi tik. */
@Composable
private fun <T> Choices(options: List<Pair<T, String>>, selected: T, onSelect: (T) -> Unit, preview: ((T) -> TextStyle)? = null) {
    Column(Modifier.fillMaxWidth().clip(GroupOuter), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        options.forEach { (value, label) ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 56.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(KmColors.surface)
                    .pressableScale(onClick = { onSelect(value) }, pressedOpacity = 0.8f, onClickLabel = label)
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(label, style = preview?.invoke(value) ?: KmType.callout.copy(fontWeight = FontWeight.Normal), color = KmColors.text, modifier = Modifier.weight(1f))
                if (value == selected) KmIcon(KmIcons.Check, KmColors.info, 22.dp)
            }
        }
    }
}

@Composable
private fun SheetNote(text: String) {
    Text(text, style = KmType.footnote, color = KmColors.textMuted, modifier = Modifier.padding(start = 6.dp, top = 10.dp, bottom = 4.dp))
}

@Composable
private fun SheetLabel(text: String) {
    Text(text, style = KmType.subhead, color = KmColors.textSecondary, modifier = Modifier.padding(start = 6.dp, top = 16.dp, bottom = 8.dp))
}

@Composable
internal fun <T> ChoiceSheet(title: String, options: List<Pair<T, String>>, selected: T, onSelect: (T) -> Unit, onClose: () -> Unit) {
    KmSheet(visible = true, onClose = onClose, title = title) {
        Choices(options, selected, onSelect = { onSelect(it); onClose() })
    }
}

/** Profil: görünen adı değiştirir; e-posta ve plan bilgi amaçlıdır. */
@Composable
internal fun ProfileSheet(
    name: String,
    email: String?,
    photo: String?,
    planLabel: String,
    signedIn: Boolean,
    onSave: suspend (String) -> Unit,
    onClose: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var text by remember { mutableStateOf(name) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val context = LocalContext.current
    KmSheet(visible = true, onClose = onClose, title = "Profil") {
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            ProfileAvatar(text.ifBlank { name }, photo, 72.dp)
            Text(planLabel, style = KmType.footnote, color = KmColors.textSecondary, modifier = Modifier.padding(top = 8.dp))
        }
        if (!signedIn) {
            SheetNote("Profilini düzenlemek için giriş yapmalısın.")
            return@KmSheet
        }
        SheetLabel("Ad")
        val shape = RoundedCornerShape(14.dp)
        BasicTextField(
            value = text,
            onValueChange = { text = it.take(60); error = null },
            singleLine = true,
            textStyle = KmType.body.copy(color = KmColors.text),
            cursorBrush = SolidColor(KmColors.brand),
            modifier = Modifier
                .fillMaxWidth()
                .clip(shape)
                .background(KmColors.surface)
                .border(1.dp, KmColors.border, shape)
                .semantics { contentDescription = "Ad" }
                .padding(14.dp),
        )
        SheetLabel("E-posta")
        Text(email.orEmpty(), style = KmType.body, color = KmColors.textSecondary, modifier = Modifier.padding(start = 6.dp))
        error?.let { Text(it, style = KmType.footnote, color = KmColors.danger, modifier = Modifier.padding(start = 6.dp, top = 12.dp)) }
        Spacer(Modifier.height(20.dp))
        KmButton(
            text = "Kaydet",
            loading = saving,
            enabled = text.isNotBlank() && text.trim() != name,
            fullWidth = true,
            onClick = {
                saving = true
                scope.launch {
                    try {
                        onSave(text.trim())
                        android.widget.Toast.makeText(context, "Profil güncellendi", android.widget.Toast.LENGTH_SHORT).show()
                        onClose()
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        error = e.message ?: "Ad kaydedilemedi."
                    } finally {
                        saving = false
                    }
                }
            },
        )
    }
}

/** Yazı tipi stili: yanıtların serif ya da sade görünümü, her seçenek kendi yazısıyla. */
@Composable
internal fun FontSheet(sans: Boolean, onChange: (Boolean) -> Unit, onClose: () -> Unit) {
    KmSheet(visible = true, onClose = onClose, title = "Yazı tipi stili") {
        Choices(
            options = listOf(false to "Serif", true to "Sade"),
            selected = sans,
            onSelect = onChange,
            preview = { s -> TextStyle(fontFamily = if (s) KmFont else KmReplyFont, fontSize = 17.sp) },
        )
        SheetNote("Yapay zekânın yanıtlarında kullanılan yazı tipi. Arayüz yazısı değişmez.")
    }
}

/** Ses: sesli okuma dili ve hızı, önizlemeyle. */
@Composable
internal fun VoiceSheet(prefs: AppPrefs, onClose: () -> Unit) {
    val context = LocalContext.current
    val rate by prefs.voiceRate.collectAsStateWithLifecycle()
    val lang by prefs.voiceLang.collectAsStateWithLifecycle()
    val tts = remember { mutableStateOf<TextToSpeech?>(null) }
    DisposableEffect(Unit) {
        val engine = TextToSpeech(context.applicationContext) {}
        tts.value = engine
        onDispose { engine.shutdown() }
    }
    KmSheet(visible = true, onClose = onClose, title = "Ses") {
        SheetLabel("Dil")
        Choices(VoiceLang.entries.map { it to it.label }, lang, prefs::setVoiceLang)
        SheetLabel("Okuma hızı")
        Choices(VOICE_RATES, VOICE_RATES.minBy { kotlin.math.abs(it.first - rate) }.first, prefs::setVoiceRate)
        Spacer(Modifier.height(18.dp))
        KmButton(
            text = "Önizle",
            fullWidth = true,
            onClick = {
                tts.value?.language = Locale.forLanguageTag(lang.tag)
                tts.value?.setSpeechRate(rate)
                val sample = if (lang == VoiceLang.Turkish) "Merhaba, ben KocaMind. Yanıtlarımı böyle okuyacağım." else "Hi, I'm KocaMind. This is how I'll read my replies."
                tts.value?.speak(sample, TextToSpeech.QUEUE_FLUSH, null, "preview")
            },
        )
        SheetNote("Yanıtın altındaki hoparlör düğmesi bu ayarlarla okur.")
    }
}

/** Bildirimler: arka planda biten yanıt için bildirim; Android 13+ izni burada istenir. */
@Composable
internal fun NotificationsSheet(prefs: AppPrefs, onClose: () -> Unit) {
    val context = LocalContext.current
    val on by prefs.notifyReplies.collectAsStateWithLifecycle()
    var denied by remember { mutableStateOf(false) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        prefs.setNotifyReplies(granted)
        denied = !granted
    }
    KmSheet(visible = true, onClose = onClose, title = "Bildirimler") {
        Column(Modifier.fillMaxWidth().clip(GroupOuter), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            SettingSwitchRow(
                KmIcons.MailCheck, "Yanıt hazır olunca bildir", "Uygulama arka plandayken yanıt bitince haber verir",
                checked = on && ReplyNotifier.hasPermission(context),
                onChange = { want ->
                    if (want && Build.VERSION.SDK_INT >= 33 && !ReplyNotifier.hasPermission(context)) {
                        permission.launch(Manifest.permission.POST_NOTIFICATIONS)
                    } else {
                        prefs.setNotifyReplies(want)
                    }
                },
            )
            SettingRow(KmIcons.Settings, "Sistem bildirim ayarları") {
                val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                runCatching { context.startActivity(intent) }
            }
        }
        if (denied) SheetNote("Bildirim izni verilmedi. Sistem bildirim ayarlarından açabilirsin.")
    }
}

/** Gizlilik: ekran görüntüsü engeli, hafıza ve politika. */
@Composable
internal fun PrivacySheet(
    appPrefs: AppPrefs,
    memoryOn: Boolean,
    onMemoryChange: (Boolean) -> Unit,
    onPolicy: () -> Unit,
    onClose: () -> Unit,
) {
    val secure by appPrefs.blockScreenshots.collectAsStateWithLifecycle()
    KmSheet(visible = true, onClose = onClose, title = "Gizlilik") {
        Column(Modifier.fillMaxWidth().clip(GroupOuter), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            SettingSwitchRow(
                KmIcons.EyeOff, "Ekran görüntüsünü engelle", "Ekran görüntüsü, kayıt ve son uygulamalar önizlemesi kapanır",
                checked = secure, onChange = appPrefs::setBlockScreenshots,
            )
            SettingSwitchRow(
                KmIcons.Notebook, "Hafıza", "Sohbetlerden öğrendiklerini hatırlar",
                checked = memoryOn, onChange = onMemoryChange,
            )
            SettingRow(KmIcons.Shield, "Gizlilik Politikası", onClick = onPolicy)
        }
        Spacer(Modifier.width(KmSpace.sm))
    }
}
