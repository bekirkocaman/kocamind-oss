package com.tyler.kocamind.ui.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.layout.offset
import coil.compose.AsyncImage
import com.tyler.kocamind.data.chat.ChatMessage
import com.tyler.kocamind.ui.components.KmMark
import com.tyler.kocamind.ui.components.MarkState
import com.tyler.kocamind.ui.components.KmIcon
import com.tyler.kocamind.ui.components.KmIconButton
import com.tyler.kocamind.ui.components.pressableScale
import com.tyler.kocamind.ui.components.rememberReduceMotion
import com.tyler.kocamind.ui.icons.KmIcons
import com.tyler.kocamind.ui.markdown.MarkdownText
import com.tyler.kocamind.ui.theme.KmColors
import com.tyler.kocamind.ui.theme.KmMotion
import com.tyler.kocamind.ui.theme.KmRadius
import com.tyler.kocamind.ui.theme.KmSpace
import com.tyler.kocamind.ui.theme.KmType

class MessageActions(
    val onEdit: (ChatMessage) -> Unit,
    val onSpeak: (String) -> Unit,
    val onCopy: (String) -> Unit,
    val onShare: (ChatMessage) -> Unit,
    val onRetry: (ChatMessage) -> Unit,
    val onFeedback: (String, Feedback) -> Unit,
    val onCheckVideo: (ChatMessage) -> Unit = {},
)

/** MessageRow.tsx. */
@Composable
fun MessageRow(item: ChatMessage, animateIn: Boolean, feedback: Feedback?, actions: MessageActions) {
    FadeInDown(key = item.id, durationMs = KmMotion.BASE, distance = -8f, enabled = animateIn) {
        if (item.isUser) UserMessage(item, actions) else AiMessage(item, feedback, actions)
    }
}

@Composable
private fun UserMessage(item: ChatMessage, actions: MessageActions) {
    val dark = KmColors.bg.luminance() < 0.5f
    val shape = RoundedCornerShape(18.dp)
    BoxWithConstraints(Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 20.dp)) {
        Column(Modifier.align(Alignment.TopEnd).widthIn(max = maxWidth * 0.86f), horizontalAlignment = Alignment.End) {
            Column(
                Modifier
                    .clip(shape)
                    .background(KmColors.surfaceElevated)
                    .border(1.dp, if (dark) KmColors.borderStrong else KmColors.border, shape)
                    .padding(horizontal = 17.dp, vertical = 12.dp),
            ) {
                item.image?.let {
                    AsyncImage(
                        model = it,
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.padding(bottom = KmSpace.sm).size(220.dp, 180.dp).clip(RoundedCornerShape(KmRadius.md)),
                    )
                }
                Text(item.content, style = KmType.body.copy(fontSize = 16.sp, lineHeight = 22.sp), color = KmColors.text)
            }
            Row(
                Modifier
                    .pressableScale(onClick = { actions.onEdit(item) })
                    .semantics { contentDescription = "Mesajı düzenle" }
                    .padding(start = KmSpace.xs, end = KmSpace.xs, top = KmSpace.sm),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(KmSpace.xs),
            ) {
                KmIcon(KmIcons.Pencil, KmColors.textMuted, 13.dp)
                Text("Düzenle", style = KmType.caption, color = KmColors.textMuted)
            }
        }
    }
}

@Composable
private fun AiMessage(item: ChatMessage, feedback: Feedback?, actions: MessageActions) {
    val reduce = rememberReduceMotion()
    // Düşünme evresi: yanıt metni, agent durumu ya da medya durumu gelmeden önceki bekleyiş.
    val thinkingNow = item.streaming && item.content.isEmpty() && item.agentStatus == null && item.mediaStatus == null &&
        item.generatedImage == null && item.generatedVideo == null
    val markState = when {
        thinkingNow -> MarkState.Think
        item.streaming -> MarkState.Stream
        else -> MarkState.Done
    }
    // Klon düzeni: yanıtın yanında avatar yok; işaret yalnız yanıt beklenirken görünür.
    Row(Modifier.fillMaxWidth().padding(bottom = KmSpace.md)) {
        Column(Modifier.weight(1f)) {
            if (thinkingNow) Box(Modifier.padding(bottom = KmSpace.sm)) { KmMark(markState, size = 26.dp) }
            Column(Modifier.padding(top = 1.dp)) {
                if (thinkingNow || !item.thinking.isNullOrBlank()) {
                    ThinkingPanel(messageId = item.id, active = thinkingNow, thinking = item.thinking, thinkingMs = item.thinkingMs)
                }
                item.mediaStatus?.let { ThinkingDots(it) }
                item.generatedImage?.let {
                    val ratio = when (item.generatedAspectRatio) { "16:9" -> 16f / 9f; "9:16" -> 9f / 16f; else -> 1f }
                    AsyncImage(
                        model = it,
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier
                            .padding(bottom = KmSpace.md)
                            .widthIn(max = 560.dp)
                            .fillMaxWidth()
                            .aspectRatio(ratio)
                            .clip(RoundedCornerShape(KmRadius.md))
                            .background(KmColors.surface),
                    )
                }
                item.generatedVideo?.let { GeneratedVideo(it) }
                if (item.agentStatus != null || !item.agentSteps.isNullOrEmpty()) {
                    val shape = RoundedCornerShape(KmRadius.md)
                    Column(
                        Modifier
                            .padding(bottom = KmSpace.md)
                            .fillMaxWidth()
                            .clip(shape)
                            .background(KmColors.surface)
                            .border(1.dp, KmColors.border, shape)
                            .padding(KmSpace.md),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(KmSpace.sm)) {
                            KmIcon(KmIcons.Terminal, KmColors.brand, 15.dp)
                            val count = item.agentSteps?.size ?: 0
                            Text("Agent" + if (count > 0) " · $count adım" else "", style = KmType.subhead, color = KmColors.brand)
                        }
                        Spacer(Modifier.size(KmSpace.xs))
                        item.agentStatus?.let { ThinkingDots(it) }
                    }
                }
                if (item.isError == true) {
                    ErrorReply(item.content) { actions.onRetry(item) }
                } else if (item.content.isNotEmpty()) {
                    Column(
                        if (item.streaming && !reduce) {
                            Modifier.animateContentSize(tween(KmMotion.BASE, easing = KmMotion.standard))
                        } else {
                            Modifier
                        },
                    ) {
                        MarkdownText(item.content)
                        if (item.streaming) StreamCursor()
                    }
                    if (!item.streaming && item.answeredBy?.startsWith("local/") == true) {
                        Text("Telefonda üretildi · hak harcamaz", style = KmType.caption, color = KmColors.textMuted, modifier = Modifier.padding(top = KmSpace.xs))
                    }
                }
            }
            if (!item.streaming && item.content.isNotEmpty() && item.isError != true) {
                Row(
                    Modifier.padding(top = KmSpace.sm).offset(x = (-8).dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    ActionButton(KmIcons.Copy, "Kopyala") { actions.onCopy(item.content) }
                    ActionButton(KmIcons.Share2, "Paylaş") { actions.onShare(item) }
                    ActionButton(KmIcons.Volume2, "Sesli oku") { actions.onSpeak(item.content) }
                    if (item.mediaJobId != null && item.generatedVideo == null) {
                        Row(
                            Modifier
                                .pressableScale(onClick = { actions.onCheckVideo(item) })
                                .semantics { contentDescription = "Video durumunu kontrol et" }
                                .padding(KmSpace.sm),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(KmSpace.xs),
                        ) {
                            KmIcon(KmIcons.Clapperboard, KmColors.brand, 14.dp)
                            Text("Kontrol et", style = KmType.caption, color = KmColors.brand)
                        }
                    }
                    ActionButton(
                        KmIcons.ThumbsUp,
                        if (feedback == Feedback.Up) "Beğeniyi geri al" else "Beğendim",
                        if (feedback == Feedback.Up) KmColors.brand else KmColors.textSecondary,
                    ) {
                        actions.onFeedback(item.id, Feedback.Up)
                    }
                    ActionButton(
                        KmIcons.ThumbsDown,
                        if (feedback == Feedback.Down) "Beğenmedim oyunu geri al" else "Beğenmedim",
                        if (feedback == Feedback.Down) KmColors.danger else KmColors.textSecondary,
                    ) {
                        actions.onFeedback(item.id, Feedback.Down)
                    }
                    if (item.generatedImage == null && item.generatedVideo == null && item.mediaJobId == null) {
                        ActionButton(KmIcons.RotateCcw, "Yeniden dene") { actions.onRetry(item) }
                    }
                }
            }
        }
    }
}

@Composable
private fun ActionButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    tint: androidx.compose.ui.graphics.Color = KmColors.textSecondary,
    onClick: () -> Unit,
) {
    KmIconButton(onClick = onClick, contentDescription = label, background = Color.Transparent) { KmIcon(icon, tint, 18.dp) }
}

/** Cevap yerine gelen hata: uyarı rengiyle kart ve tek dokunuşla tekrar deneme. */
@Composable
private fun ErrorReply(message: String, onRetry: () -> Unit) {
    val shape = RoundedCornerShape(KmRadius.lg)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(KmColors.dangerMuted)
            .padding(horizontal = KmSpace.lg, vertical = KmSpace.md),
    ) {
        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(KmSpace.sm)) {
            KmIcon(KmIcons.Info, KmColors.danger, 18.dp, Modifier.padding(top = 2.dp))
            Text(message, style = KmType.subhead, color = KmColors.text, modifier = Modifier.weight(1f))
        }
        Row(
            Modifier
                .padding(top = KmSpace.sm)
                .clip(RoundedCornerShape(KmRadius.pill))
                .pressableScale(onClick = onRetry, onClickLabel = "Tekrar dene")
                .padding(horizontal = KmSpace.md, vertical = KmSpace.sm),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(KmSpace.xs),
        ) {
            KmIcon(KmIcons.RotateCcw, KmColors.danger, 15.dp)
            Text("Tekrar dene", style = KmType.subhead, color = KmColors.danger)
        }
    }
}
