package com.tyler.kocamind.ui.chat

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.speech.tts.TextToSpeech
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.tyler.kocamind.data.backend.QuotaState
import com.tyler.kocamind.data.backend.RemoteModel
import com.tyler.kocamind.ui.settings.quotaExhaustedText
import com.tyler.kocamind.ui.settings.quotaNotice
import java.time.Instant
import kotlinx.coroutines.delay
import com.tyler.kocamind.data.settings.AppPrefs
import com.tyler.kocamind.data.settings.ReplyNotifier
import com.tyler.kocamind.ui.theme.LocalHaptics
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.selection.toggleable
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.tyler.kocamind.data.media.AndroidMediaFiles
import com.tyler.kocamind.ui.components.BannerTone
import com.tyler.kocamind.ui.components.KmBanner
import com.tyler.kocamind.ui.components.KmIcon
import com.tyler.kocamind.ui.components.KmIconButton
import com.tyler.kocamind.ui.components.pressableScale
import com.tyler.kocamind.ui.components.rememberReduceMotion
import com.tyler.kocamind.ui.icons.KmIcons
import com.tyler.kocamind.ui.theme.KmColors
import com.tyler.kocamind.ui.theme.KmMotion
import com.tyler.kocamind.ui.theme.KmRadius
import com.tyler.kocamind.ui.theme.KmSpace
import com.tyler.kocamind.ui.theme.KmType
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import java.util.Locale
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.sp
import com.tyler.kocamind.data.chat.ChatHistoryRepository
import com.tyler.kocamind.data.chat.SharedContent
import com.tyler.kocamind.data.chat.mergeSharedText
import com.tyler.kocamind.ui.components.KmMark
import com.tyler.kocamind.ui.components.MarkState
import com.tyler.kocamind.ui.icons.ExtraIcons
import com.tyler.kocamind.ui.nav.LocalDrawer
import com.tyler.kocamind.ui.theme.KmReplyFont

/** kocamind-mobil/src/app/index.tsx ekranı. */
@Composable
fun ChatScreen(
    vm: ChatViewModel,
    mediaFiles: AndroidMediaFiles,
    onOpenOfflineModels: () -> Unit,
    history: ChatHistoryRepository,
    onNewChat: () -> Unit,
    appPrefs: AppPrefs,
    modifier: Modifier = Modifier,
    /** Başka uygulamadan "Paylaş" ile gelen içerik; işlenince temizlenir. */
    shared: MutableStateFlow<SharedContent?>? = null,
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val input by vm.input.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val scope = rememberCoroutineScope()
    var modelsOpen by remember { mutableStateOf(false) }
    var toolsOpen by remember { mutableStateOf(false) }
    var alert by remember { mutableStateOf<ChatEvent.Alert?>(null) }
    fun toast(text: String) = Toast.makeText(context, text, Toast.LENGTH_SHORT).show()
    // Hafıza bildirimi "Geri al" eylemi taşıdığı için sistem Toast'u yerine Snackbar.
    val snackbar = remember { SnackbarHostState() }
    val haptic = LocalHapticFeedback.current
    val hapticsOn = LocalHaptics.current
    // Ayarlar > Dokunsal geri bildirim.
    fun buzz() { if (hapticsOn) haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove) }

    // Ayarlar > Bildirimler: uygulama ön planda değilken biten yanıt bildirilir. Akış yaşam
    // döngüsünden bağımsız toplanır; arka planda da yanıtın bitişi görülür.
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(vm) {
        var wasLoading = vm.state.value.isLoading
        vm.state.collect { s ->
            val finished = wasLoading && !s.isLoading
            wasLoading = s.isLoading
            // Gizli sohbet cevabı bildirim ve kilit ekranına düşmez.
            if (!finished || !appPrefs.notifyReplies.value || s.privateChat) return@collect
            if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) return@collect
            val reply = s.messages.lastOrNull { !it.isUser && it.isError != true }?.content
            if (!reply.isNullOrBlank()) ReplyNotifier.notify(context.applicationContext, reply)
        }
    }

    // ------------------------------------------------------------ sesli okuma
    val tts = remember { mutableStateOf<TextToSpeech?>(null) }
    DisposableEffect(Unit) {
        val engine = TextToSpeech(context.applicationContext) { status ->
            if (status == TextToSpeech.SUCCESS) {
                tts.value?.language = Locale.forLanguageTag("tr-TR")
                tts.value?.setSpeechRate(0.9f)
            }
        }
        tts.value = engine
        onDispose { engine.shutdown() }
    }

    // ------------------------------------------------------------ ses kaydı
    val recorder = remember { AudioRecorder(context.applicationContext) }
    var isRecording by remember { mutableStateOf(false) }
    DisposableEffect(Unit) { onDispose { recorder.release() } }
    fun startRecording() {
        try {
            recorder.start()
            isRecording = true
            toast("Dinliyorum… Bitirmek için tekrar dokun.")
        } catch (e: Exception) {
            isRecording = false
            alert = ChatEvent.Alert("Ses kaydı başlatılamadı", e.message ?: "Ses kaydı başlatılırken bir sorun oluştu.")
        }
    }
    val micPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            startRecording()
        } else {
            alert = ChatEvent.Alert("Mikrofon izni gerekli", "Konuşmanı yazıya çevirebilmek için mikrofon iznini açmalısın.")
        }
    }
    fun toggleRecording() {
        if (isRecording) {
            isRecording = false
            try {
                vm.transcribe(recorder.stop())
            } catch (e: Exception) {
                alert = ChatEvent.Alert("Ses çözülemedi", e.message ?: "Ses kaydı işlenemedi.")
            }
            return
        }
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            startRecording()
        } else {
            micPermission.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    // ------------------------------------------------------------ fotoğraf / kamera / belge
    val pickImage = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) {
            scope.launch {
                runCatching { mediaFiles.importImage(uri) }
                    .onSuccess(vm::attachImage)
                    .onFailure { alert = ChatEvent.Alert("Fotoğraf seçilemedi", it.message ?: "Fotoğraf seçilirken bir sorun oluştu.") }
            }
        }
    }
    // Kamera uygulaması açıkken ekran yeniden oluşabilir (ya da süreç kapanabilir); hedef korunmalı.
    var cameraTarget by rememberSaveable { mutableStateOf<Uri?>(null) }
    val takePhoto = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { saved ->
        val target = cameraTarget
        if (saved && target != null) {
            scope.launch {
                runCatching { mediaFiles.importImage(target) }
                    .onSuccess(vm::attachImage)
                    .onFailure { alert = ChatEvent.Alert("Fotoğraf çekilemedi", it.message ?: "Kamera açılırken bir sorun oluştu.") }
            }
        }
    }
    val pickDocument = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            scope.launch {
                runCatching { mediaFiles.importDocument(uri) }
                    .onSuccess(vm::attachDocument)
                    .onFailure { alert = ChatEvent.Alert("Dosya seçilemedi", it.message ?: "Dosya seçilirken bir sorun oluştu.") }
            }
        }
    }

    // Başka uygulamadan paylaşılan içerik mesaj kutusuna konur, gönderilmez; kullanıcı ne isteyeceğini yazar.
    LaunchedEffect(shared) {
        shared?.collect { content ->
            if (content == null) return@collect
            shared.value = null
            content.text?.let { vm.setInput(mergeSharedText(vm.input.value, it)) }
            content.imageUri?.let { uri ->
                runCatching { mediaFiles.importImage(Uri.parse(uri)) }
                    .onSuccess(vm::attachImage)
                    .onFailure { alert = ChatEvent.Alert("Fotoğraf eklenemedi", "Paylaşılan fotoğraf açılamadı.") }
            }
            content.documentUri?.let { uri ->
                runCatching { mediaFiles.importDocument(Uri.parse(uri)) }
                    .onSuccess(vm::attachDocument)
                    .onFailure { alert = ChatEvent.Alert("Dosya eklenemedi", "Paylaşılan dosya açılamadı.") }
            }
        }
    }

    LaunchedEffect(vm) {
        vm.events.collect { event ->
            when (event) {
                is ChatEvent.Alert -> alert = event
                is ChatEvent.Toast -> toast(event.text)
                is ChatEvent.MemorySaved -> scope.launch {
                    val result = snackbar.showSnackbar(
                        "Hafızaya eklendi: ${event.keys.joinToString(", ")}",
                        actionLabel = "Geri al",
                        duration = SnackbarDuration.Long,
                    )
                    if (result == SnackbarResult.ActionPerformed) vm.undoMemory(event.keys)
                }
            }
        }
    }

    val actions = remember(vm) {
        MessageActions(
            onEdit = vm::edit,
            onSpeak = { text ->
                // Ayarlar > Ses: dil ve hız her okumada güncel tercihten alınır.
                tts.value?.language = Locale.forLanguageTag(appPrefs.voiceLang.value.tag)
                tts.value?.setSpeechRate(appPrefs.voiceRate.value)
                tts.value?.speak(text.replace(Regex("[*_#`~]"), ""), TextToSpeech.QUEUE_FLUSH, null, "kocamind")
            },
            onCopy = { text ->
                buzz()
                clipboard.setText(AnnotatedString(text))
                toast("Kopyalandı")
            },
            onShare = { message ->
                val send = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, message.generatedVideo ?: message.generatedImage ?: message.content)
                }
                context.startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            },
            onRetry = vm::retry,
            onFeedback = vm::feedback,
            onCheckVideo = vm::checkVideo,
        )
    }

    // Yalnız ekran açıldıktan sonra eklenen mesajlar kayarak gelir (eski sohbet yüklenince değil).
    val seen = remember(state.chatId) { state.messages.map { it.id }.toMutableSet() }
    val placeholder = when (state.mode) {
        AssistantMode.Agent -> "Agent'a bir görev ver…"
        AssistantMode.DeepResearch -> "Derinlemesine araştırılacak konuyu yaz…"
        AssistantMode.Chat -> if (state.messages.isEmpty()) "KocaMind ile sohbet et…" else "KocaMind'e yanıt ver…"
    }

    val chats by history.chats.collectAsStateWithLifecycle()
    val current = chats?.firstOrNull { it.id == state.chatId }
    var renaming by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }

    Column(modifier.imePadding()) {
        ChatTopBar(
            hasMessages = state.messages.isNotEmpty(),
            title = current?.title,
            pinned = current?.isPinned == true,
            onNewChat = onNewChat,
            onShare = {
                val text = state.messages.joinToString("\n\n") { (if (it.isUser) "Sen: " else "KocaMind: ") + it.content }
                val send = Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, text) }
                context.startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            },
            onRename = current?.let { c -> { renaming = c.title } },
            onTogglePin = current?.let { c -> { scope.launch { history.togglePin(c.id) } } },
            onDelete = current?.let { { confirmDelete = true } },
        )
        ConnectionBanners(
            isOnline = state.isOnline,
            queuedCount = state.queuedCount,
            localLabel = state.selectedModel?.takeIf { state.isLocalSelected && !state.privateChat }?.label,
            privateChat = state.privateChat,
        )
        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (state.messages.isEmpty()) {
                EmptyState(
                    state.userName, state.emptyEpoch, state.privateChat, vm::setPrivateChat,
                    onSuggestion = { s ->
                        vm.setInput(s.prompt)
                        if (s.needsImage) pickImage.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                    },
                )
            } else {
                MessageList(state, seen, actions)
            }
            SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter))
        }
        ComposerExtras(
            mode = state.mode,
            image = state.selectedImage,
            document = state.selectedDocument,
            onCloseMode = { vm.setMode(AssistantMode.Chat) },
            onRemoveImage = vm::removeImage,
            onRemoveDocument = vm::removeDocument,
        )
        if (!state.isLocalSelected && !state.privateChat) {
            QuotaLine(
                quota = state.quota,
                exhaustedUntil = state.quotaExhaustedUntil,
                localModel = state.models.firstOrNull { it.provider == "local" && it.available },
                onUseLocal = vm::selectModel,
            )
        }
        Composer(
            value = input,
            placeholder = placeholder,
            onValueChange = vm::setInput,
            isLoading = state.isLoading,
            canSend = state.canSend(input),
            isRecording = isRecording,
            modelLabel = state.selectedModel?.label ?: "Model",
            deepThink = state.deepThink && !state.isLocalSelected,
            onSend = { buzz(); vm.send() },
            onStop = vm::stop,
            onTools = { toolsOpen = true },
            onModel = { modelsOpen = true },
            onMic = ::toggleRecording,
        )
    }

    renaming?.let { initial ->
        var text by remember { mutableStateOf(initial) }
        AlertDialog(
            onDismissRequest = { renaming = null },
            title = { Text("Yeniden adlandır") },
            text = {
                BasicTextField(
                    text, { text = it }, singleLine = true,
                    textStyle = KmType.body.copy(color = KmColors.text),
                    cursorBrush = SolidColor(KmColors.brand),
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .border(1.dp, KmColors.border, RoundedCornerShape(12.dp))
                        .padding(12.dp),
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    val id = current?.id
                    if (id != null && text.isNotBlank()) scope.launch { history.rename(id, text.trim()) }
                    renaming = null
                }) { Text("Kaydet", color = KmColors.brand) }
            },
            dismissButton = { TextButton(onClick = { renaming = null }) { Text("Vazgeç", color = KmColors.textSecondary) } },
            containerColor = KmColors.surface,
            titleContentColor = KmColors.text,
        )
    }
    if (confirmDelete && current != null) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Sohbet silinsin mi?") },
            text = { Text("Bu işlem geri alınamaz.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmDelete = false
                    val id = current.id
                    onNewChat()
                    scope.launch { history.delete(id) }
                    toast("Sohbet silindi")
                }) { Text("Sil", color = KmColors.danger) }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Vazgeç", color = KmColors.textSecondary) } },
            containerColor = KmColors.surface,
            titleContentColor = KmColors.text,
            textContentColor = KmColors.textSecondary,
        )
    }

    state.pendingFeedback?.let { pending ->
        key(pending.messageId) {
            FeedbackReasonSheet(
                onSubmit = { reason, note -> vm.submitFeedback(pending, reason, note) },
                onSkip = { vm.submitFeedback(pending) },
            )
        }
    }

    ModelSheet(
        visible = modelsOpen,
        models = if (state.isOnline) state.models else state.models.filter { it.provider == "local" },
        selected = state.selectedModel,
        onSelect = vm::selectModel,
        onClose = { modelsOpen = false },
    )
    AttachSheet(
        visible = toolsOpen,
        onClose = { toolsOpen = false },
        onImage = { pickImage.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
        onCamera = {
            runCatching { mediaFiles.newCameraFile() }
                .onSuccess { (_, uri) -> cameraTarget = uri; takePhoto.launch(uri) }
                .onFailure { alert = ChatEvent.Alert("Fotoğraf çekilemedi", it.message ?: "Kamera açılırken bir sorun oluştu.") }
        },
        onDocument = { pickDocument.launch(arrayOf("application/pdf", "text/*", "application/json")) },
        deepThink = state.deepThink,
        // Yerel modelde düşünme modu yok; anahtar yalnızca bulut modellerinde görünür.
        onDeepThinkChange = vm::setDeepThink.takeUnless { state.isLocalSelected },
    )

    alert?.let { a ->
        AlertDialog(
            onDismissRequest = { alert = null },
            title = { Text(a.title) },
            text = { Text(a.message) },
            confirmButton = {
                if (a.action == ChatAlertAction.OpenOfflineModels) {
                    TextButton(onClick = { alert = null; onOpenOfflineModels() }) { Text("Modellere git", color = KmColors.brand) }
                }
            },
            dismissButton = {
                TextButton(onClick = { alert = null }) {
                    Text(if (a.action != null) "Vazgeç" else "Tamam", color = KmColors.brand)
                }
            },
            containerColor = KmColors.surfaceElevated,
            titleContentColor = KmColors.text,
            textContentColor = KmColors.textSecondary,
        )
    }
    state.approval?.let { question ->
        fun answer(value: Boolean) = vm.answerApproval(value)
        AlertDialog(
            onDismissRequest = {},
            properties = DialogProperties(dismissOnBackPress = false, dismissOnClickOutside = false),
            title = { Text("İşlem onayı") },
            text = { Text(question) },
            confirmButton = { TextButton(onClick = { answer(true) }) { Text("Onayla", color = KmColors.brand) } },
            dismissButton = { TextButton(onClick = { answer(false) }) { Text("İptal", color = KmColors.textSecondary) } },
            containerColor = KmColors.surfaceElevated,
            titleContentColor = KmColors.text,
            textContentColor = KmColors.textSecondary,
        )
    }
}

/** index.tsx: çevrimdışı ve bekleyen mesaj şeritleri. */
/** Kalan günlük hak azalınca ince uyarı; bitince saniyede bir güncellenen geri sayım ve yerel modele geçiş. */
@Composable
private fun QuotaLine(quota: QuotaState?, exhaustedUntil: Long?, localModel: RemoteModel?, onUseLocal: (RemoteModel) -> Unit) {
    var now by remember { mutableStateOf(Instant.now()) }
    // Gece yarısı geçince hak yenilenmiştir; geri sayım sıfırdan başa sarmasın.
    val exhausted = exhaustedUntil != null && now.toEpochMilli() < exhaustedUntil
    if (exhaustedUntil != null) {
        LaunchedEffect(Unit) {
            while (true) {
                delay(1000)
                now = Instant.now()
            }
        }
    }
    val text = if (exhausted) quotaExhaustedText(now) else quota?.let(::quotaNotice)
    if (text == null) return
    Row(
        Modifier.fillMaxWidth().padding(horizontal = KmSpace.lg, vertical = KmSpace.xs).semantics { liveRegion = LiveRegionMode.Polite },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(KmSpace.sm),
    ) {
        Text(text, style = KmType.caption, color = if (exhausted) KmColors.danger else KmColors.textMuted, modifier = Modifier.weight(1f))
        if (exhausted && localModel != null) {
            TextButton(onClick = { onUseLocal(localModel) }) {
                Text("Telefondaki modelle devam et", style = KmType.caption, color = KmColors.brand, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
private fun ConnectionBanners(isOnline: Boolean, queuedCount: Int, localLabel: String?, privateChat: Boolean) {
    Box(Modifier.fillMaxWidth().padding(top = KmSpace.sm), contentAlignment = Alignment.Center) {
        KmBanner(
            visible = privateChat,
            tone = BannerTone.Success,
            icon = { KmIcon(KmIcons.Lock, KmColors.success, 14.dp) },
            text = "Gizli sohbet · Bu sohbet telefondan çıkmaz ve kaydedilmez",
            modifier = Modifier.fillMaxWidth(0.94f).widthIn(max = 920.dp),
        )
        KmBanner(
            visible = localLabel != null,
            tone = BannerTone.Success,
            icon = { KmIcon(KmIcons.Smartphone, KmColors.success, 14.dp) },
            text = "${localLabel ?: "Yerel AI"} aktif · yerel sohbet hafızası açık · internet kullanılmaz",
            modifier = Modifier.fillMaxWidth(0.94f).widthIn(max = 920.dp),
        )
        KmBanner(
            visible = !isOnline && localLabel == null && !privateChat,
            tone = BannerTone.Warning,
            icon = { KmIcon(KmIcons.WifiOff, KmColors.warning, 14.dp) },
            text = "İnternet yok · mesajlar bekletilecek",
            modifier = Modifier.fillMaxWidth(0.94f).widthIn(max = 920.dp),
            right = if (queuedCount > 0) {
                {
                    Row(
                        Modifier
                            .clip(RoundedCornerShape(KmRadius.pill))
                            .background(KmColors.surfaceElevated)
                            .padding(horizontal = KmSpace.sm, vertical = KmSpace.xxs),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(KmSpace.xs),
                    ) {
                        KmIcon(KmIcons.Clock, KmColors.warning, 11.dp)
                        Text("$queuedCount", style = KmType.caption, color = KmColors.warning)
                    }
                }
            } else {
                null
            },
        )
        KmBanner(
            visible = isOnline && queuedCount > 0,
            tone = BannerTone.Info,
            icon = { KmIcon(KmIcons.Smartphone, KmColors.info, 14.dp) },
            text = "$queuedCount bekleyen mesaj gönderiliyor…",
            modifier = Modifier.fillMaxWidth(0.94f).widthIn(max = 920.dp),
        )
    }
}

@Composable
internal fun MessageList(state: ChatUiState, seen: MutableSet<String>, actions: MessageActions) {
    val listState = rememberLazyListState()
    val nearBottom by remember {
        derivedStateOf {
            val info = listState.layoutInfo
            val last = info.visibleItemsInfo.lastOrNull() ?: return@derivedStateOf true
            last.index >= info.totalItemsCount - 1 && last.offset + last.size - info.viewportEndOffset <= 360
        }
    }
    // Kullanıcı sona yakınken yeni mesajlar ve akan metin takip edilir. Konum yeni mesaj
    // eklendikten sonra ölçülürse hep "yukarıda" çıkar; bu yüzden yalnız kaydırma bitince güncellenir.
    var follow by remember { mutableStateOf(true) }
    LaunchedEffect(listState) {
        snapshotFlow { listState.isScrollInProgress }.collect { scrolling -> if (!scrolling) follow = nearBottom }
    }
    // state düz bir sınıf; snapshotFlow her zaman güncelini okusun diye snapshot durumuna sarılır.
    val latest by rememberUpdatedState(state)
    LaunchedEffect(listState) {
        snapshotFlow { latest.messages.size to (latest.messages.lastOrNull()?.content?.length ?: 0) }
            .distinctUntilChanged()
            .collect { (count, _) ->
                // animateScrollToItem kaydırılamayan listede ya da ulaşılamayan ofsette hiç bitmiyor ve
                // akışı kilitliyordu; anlık kaydırma uzun mesajın da sonuna iner.
                if (follow && count > 0) listState.scrollToItem(count - 1, Int.MAX_VALUE / 2)
            }
    }
    // Başka sohbet açılınca sonundan başla.
    LaunchedEffect(state.chatId) {
        follow = true
        if (latest.messages.isNotEmpty()) listState.scrollToItem(latest.messages.lastIndex, Int.MAX_VALUE / 2)
    }
    val scope = rememberCoroutineScope()
    Box(Modifier.fillMaxSize()) {
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 17.dp, end = 17.dp, top = KmSpace.sm, bottom = KmSpace.xl),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            items(state.messages, key = { it.id }) { message ->
                val animate = message.id !in seen
                LaunchedEffect(message.id) { seen += message.id }
                Box(Modifier.widthIn(max = 920.dp).fillMaxWidth()) {
                    MessageRow(message, animateIn = animate, feedback = state.feedbacks[message.id], actions = actions)
                }
            }
            item(key = "disclaimer") {
                if (!state.isLoading) {
                    Text(
                        "KocaMind bir yapay zekâdır ve hata yapabilir.",
                        style = KmType.footnote,
                        color = KmColors.textSecondary,
                        modifier = Modifier.widthIn(max = 920.dp).fillMaxWidth(),
                    )
                }
            }
        }
        // Klon düzeni: aşağıda kalan yeni içerik için ortada yuvarlak "en alta" düğmesi.
        if (!nearBottom) {
            KmIconButton(
                onClick = { scope.launch { follow = true; listState.animateScrollToItem(listState.layoutInfo.totalItemsCount - 1) } },
                contentDescription = "En alta kaydır",
                size = 44.dp,
                background = KmColors.surface,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 8.dp)
                    .border(1.dp, KmColors.border, CircleShape),
            ) { KmIcon(KmIcons.ChevronDown, KmColors.text, 20.dp) }
        }
    }
}

/** Klon tasarımının üst çubuğu: solda menü; sohbet varken sağda yeni sohbet ve seçenekler. */
@Composable
private fun ChatTopBar(
    hasMessages: Boolean,
    title: String?,
    pinned: Boolean,
    onNewChat: () -> Unit,
    onShare: () -> Unit,
    onRename: (() -> Unit)?,
    onTogglePin: (() -> Unit)?,
    onDelete: (() -> Unit)?,
) {
    val drawer = LocalDrawer.current
    var menuOpen by remember { mutableStateOf(false) }
    Row(
        Modifier.fillMaxWidth().height(57.dp).padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        KmIconButton(onClick = drawer.open, contentDescription = "Menüyü aç", background = Color.Transparent) {
            KmIcon(KmIcons.AlignLeft, KmColors.text, 22.dp)
        }
        Spacer(Modifier.weight(1f))
        if (hasMessages) {
            KmIconButton(onClick = onNewChat, contentDescription = "Yeni sohbet", background = Color.Transparent) {
                KmIcon(KmIcons.MessageSquarePlus, KmColors.text, 22.dp)
            }
            Box {
                KmIconButton(onClick = { menuOpen = true }, contentDescription = "Diğer seçenekler", background = Color.Transparent) {
                    KmIcon(ExtraIcons.DotsVertical, KmColors.text, 22.dp)
                }
                DropdownMenu(
                    expanded = menuOpen,
                    onDismissRequest = { menuOpen = false },
                    offset = DpOffset(0.dp, 4.dp),
                    shape = RoundedCornerShape(15.dp),
                    containerColor = KmColors.surface,
                    modifier = Modifier.widthIn(min = 235.dp),
                ) {
                    if (title != null) {
                        Text(
                            title, style = KmType.footnote, color = KmColors.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(horizontal = 18.dp, vertical = 7.dp),
                        )
                    }
                    listOfNotNull(
                        Triple("Paylaş", KmIcons.Share2, onShare),
                        onRename?.let { Triple("Yeniden adlandır", KmIcons.Edit2, it) },
                        onTogglePin?.let { Triple(if (pinned) "Sabitlemeyi kaldır" else "Sabitle", KmIcons.Pin, it) },
                        onDelete?.let { Triple("Sil", KmIcons.Trash2, it) },
                    ).forEach { (label, icon, action) ->
                        val danger = label == "Sil"
                        DropdownMenuItem(
                            text = { Text(label, style = KmType.body, color = if (danger) KmColors.danger else KmColors.text) },
                            leadingIcon = { KmIcon(icon, if (danger) KmColors.danger else KmColors.textSecondary, 20.dp) },
                            onClick = { menuOpen = false; action() },
                            contentPadding = PaddingValues(horizontal = 18.dp),
                            modifier = Modifier.height(50.dp),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun EmptyState(
    userName: String,
    epoch: Int,
    privateChat: Boolean,
    onPrivateChat: (Boolean) -> Unit,
    onSuggestion: (Suggestion) -> Unit,
) {
    Column(
        Modifier.fillMaxSize().padding(horizontal = KmSpace.xl).padding(bottom = 34.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        FadeInDown(key = epoch) { KmMark(MarkState.Idle, size = 54.dp) }
        FadeInDown(key = epoch, delayMs = (KmMotion.FAST * 0.4).toInt()) {
            Text(
                if (userName.isNotBlank()) "Merhaba, ${userName.split(' ').first()}" else "Merhaba",
                style = TextStyle(fontFamily = KmReplyFont, fontSize = 34.sp, lineHeight = 40.sp),
                color = KmColors.text,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 15.dp),
            )
        }
        // Gizli sohbette kartlar gösterilmez: fotoğraf isteyenler yerel modelde çalışmaz.
        if (!privateChat) {
            FadeInDown(key = epoch, delayMs = (KmMotion.FAST * 0.6).toInt()) { SuggestionCards(onSuggestion) }
        }
        FadeInDown(key = epoch, delayMs = (KmMotion.FAST * 0.8).toInt()) {
            PrivateChatToggle(privateChat, onPrivateChat)
        }
    }
}

/** Türkiye işleri kartları: mesaj kutusunu doldurur, göndermez. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SuggestionCards(onPick: (Suggestion) -> Unit) {
    val shape = RoundedCornerShape(KmRadius.pill)
    FlowRow(
        Modifier.padding(top = KmSpace.xl).widthIn(max = 560.dp),
        horizontalArrangement = Arrangement.spacedBy(KmSpace.sm, Alignment.CenterHorizontally),
        verticalArrangement = Arrangement.spacedBy(KmSpace.sm),
    ) {
        SUGGESTIONS.forEach { s ->
            Row(
                Modifier
                    .clip(shape)
                    .background(KmColors.surface)
                    .border(1.dp, KmColors.border, shape)
                    .pressableScale(onClick = { onPick(s) })
                    .semantics(mergeDescendants = true) { role = Role.Button }
                    .heightIn(min = 48.dp)
                    .padding(horizontal = KmSpace.lg),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(KmSpace.sm),
            ) {
                val icon = when (s.id) {
                    "dilekce" -> KmIcons.FileText
                    "resmi-eposta" -> KmIcons.Mail
                    "fatura" -> KmIcons.FileText
                    else -> KmIcons.Camera
                }
                KmIcon(icon, KmColors.textSecondary, 15.dp)
                Text(s.label, style = KmType.subhead, color = KmColors.textSecondary)
            }
        }
    }
}

/** Boş ekrandaki "Gizli sohbet" hapı; açıkken sohbet yalnızca telefondaki modelle yürür ve kaydedilmez. */
@Composable
private fun PrivateChatToggle(on: Boolean, onChange: (Boolean) -> Unit) {
    val shape = RoundedCornerShape(KmRadius.pill)
    Row(
        Modifier
            .padding(top = KmSpace.lg)
            .clip(shape)
            .background(if (on) KmColors.surfaceElevated else KmColors.surface)
            .border(1.dp, if (on) KmColors.success else KmColors.border, shape)
            .toggleable(value = on, role = Role.Switch, onValueChange = onChange)
            .heightIn(min = 48.dp)
            .padding(horizontal = KmSpace.lg),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(KmSpace.sm),
    ) {
        KmIcon(KmIcons.Lock, if (on) KmColors.success else KmColors.textSecondary, 15.dp)
        Text("Gizli sohbet", style = KmType.subhead, color = if (on) KmColors.success else KmColors.textSecondary)
    }
}

/** Aktif mod şeridi, görsel ve dosya önizlemeleri (index.tsx). */
@Composable
private fun ComposerExtras(
    mode: AssistantMode,
    image: Attachment?,
    document: Attachment?,
    onCloseMode: () -> Unit,
    onRemoveImage: () -> Unit,
    onRemoveDocument: () -> Unit,
) {
    val reduce = rememberReduceMotion()
    val enter = fadeIn(tween(if (reduce) 0 else KmMotion.FAST)) + expandVertically(tween(if (reduce) 0 else KmMotion.BASE, easing = KmMotion.standard))
    val exit = fadeOut(tween(if (reduce) 0 else KmMotion.FAST)) + shrinkVertically(tween(if (reduce) 0 else KmMotion.BASE, easing = KmMotion.standard))
    val bar = Modifier.fillMaxWidth(0.94f).widthIn(max = 920.dp).padding(bottom = KmSpace.sm)
    val shape = RoundedCornerShape(KmRadius.md)
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        AnimatedVisibility(visible = mode != AssistantMode.Chat, enter = enter, exit = exit) {
            Row(
                bar.clip(shape).background(KmColors.surface).border(1.dp, KmColors.border, shape).padding(horizontal = KmSpace.md, vertical = KmSpace.sm),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(KmSpace.sm),
            ) {
                KmIcon(if (mode == AssistantMode.Agent) KmIcons.Terminal else KmIcons.Globe2, KmColors.brand, 14.dp)
                Text(mode.title, style = KmType.caption, color = KmColors.textSecondary, modifier = Modifier.weight(1f))
                KmIconButton(onClick = onCloseMode, contentDescription = "Modu kapat", size = 32.dp) { KmIcon(KmIcons.X, KmColors.textMuted, 15.dp) }
            }
        }
        AnimatedVisibility(visible = image != null, enter = enter, exit = exit) {
            Box(bar) {
                AsyncImage(
                    model = image?.uri,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.padding(top = 5.dp).size(58.dp).clip(shape),
                )
                KmIconButton(
                    onClick = onRemoveImage,
                    contentDescription = "Görseli kaldır",
                    size = 22.dp,
                    background = KmColors.surfaceSunken,
                    modifier = Modifier.offset(x = 46.dp),
                ) { KmIcon(KmIcons.X, KmColors.text, 13.dp) }
            }
        }
        AnimatedVisibility(visible = document != null, enter = enter, exit = exit) {
            Row(
                bar.clip(shape).background(KmColors.surface).border(1.dp, KmColors.border, shape).padding(KmSpace.md),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(KmSpace.md),
            ) {
                KmIcon(KmIcons.FileText, KmColors.brand, 18.dp)
                Text(
                    document?.name.orEmpty(),
                    style = KmType.footnote,
                    color = KmColors.textSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                KmIconButton(onClick = onRemoveDocument, contentDescription = "Dosyayı kaldır", size = 32.dp) { KmIcon(KmIcons.X, KmColors.textMuted, 15.dp) }
            }
        }
    }
}

/**
 * Klon tasarımının yazı kutusu: üstte metin, altta "+" ve model hapı; sağda duruma göre
 * mikrofon, gönder (turuncu) ya da durdur.
 */
@Composable
private fun Composer(
    value: String,
    placeholder: String,
    onValueChange: (String) -> Unit,
    isLoading: Boolean,
    canSend: Boolean,
    isRecording: Boolean,
    modelLabel: String,
    deepThink: Boolean,
    onSend: () -> Unit,
    onStop: () -> Unit,
    onTools: () -> Unit,
    onModel: () -> Unit,
    onMic: () -> Unit,
) {
    val shape = RoundedCornerShape(25.dp)
    Box(
        Modifier
            .fillMaxWidth()
            .background(KmColors.bg)
            .padding(start = 10.dp, end = 10.dp, bottom = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier
                .widthIn(max = 944.dp)
                .fillMaxWidth()
                .clip(shape)
                .background(KmColors.surface)
                .border(1.dp, KmColors.border, shape)
                .padding(start = 8.dp, end = 8.dp, top = 12.dp, bottom = 8.dp),
        ) {
            BasicTextField(
                value = value,
                onValueChange = { if (it.length <= 30000) onValueChange(it) },
                textStyle = KmType.body.copy(fontSize = 16.sp, color = KmColors.text),
                cursorBrush = SolidColor(KmColors.brand),
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 25.dp, max = 134.dp)
                    .padding(horizontal = 8.dp)
                    .semantics { contentDescription = "Mesaj" },
                decorationBox = { inner ->
                    if (value.isEmpty()) Text(placeholder, style = KmType.body.copy(fontSize = 16.sp), color = KmColors.textMuted)
                    inner()
                },
            )
            Row(
                Modifier.padding(top = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                KmIconButton(onClick = onTools, contentDescription = "Ekle", background = KmColors.surfaceElevated) {
                    KmIcon(KmIcons.Plus, KmColors.text, 20.dp)
                }
                Row(
                    Modifier
                        .weight(1f, fill = false)
                        .height(40.dp)
                        .clip(CircleShape)
                        .background(KmColors.surfaceElevated)
                        .pressableScale(onClick = onModel, onClickLabel = "Model seç")
                        .semantics { contentDescription = "Model seç" }
                        .padding(horizontal = 15.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(modelLabel, style = KmType.subhead.copy(fontWeight = FontWeight.Normal), color = KmColors.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    if (deepThink) Text(" Derin", style = KmType.subhead.copy(fontWeight = FontWeight.Normal), color = KmColors.textSecondary, maxLines = 1)
                }
                Spacer(Modifier.weight(1f))
                when {
                    isLoading -> KmIconButton(onClick = onStop, contentDescription = "Üretimi durdur", background = KmColors.text) {
                        Box(Modifier.size(12.dp).clip(RoundedCornerShape(2.dp)).background(KmColors.bg))
                    }
                    canSend -> KmIconButton(onClick = onSend, contentDescription = "Mesajı gönder", background = KmColors.brand) {
                        KmIcon(KmIcons.ArrowUp, KmColors.textOnBrand, 20.dp)
                    }
                    else -> KmIconButton(
                        onClick = onMic,
                        contentDescription = if (isRecording) "Kaydı bitir" else "Sesli mesaj",
                        background = if (isRecording) KmColors.dangerMuted else KmColors.surfaceElevated,
                    ) { KmIcon(KmIcons.Mic, if (isRecording) KmColors.danger else KmColors.text, 19.dp) }
                }
            }
        }
    }
}
