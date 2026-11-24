package com.tyler.kocamind.ui.settings

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.tyler.kocamind.ui.components.KmIcon
import com.tyler.kocamind.ui.components.pressableScale
import com.tyler.kocamind.ui.components.rememberReduceMotion
import com.tyler.kocamind.ui.icons.KmIcons
import com.tyler.kocamind.ui.theme.KmColors
import com.tyler.kocamind.ui.theme.KmMotion
import com.tyler.kocamind.ui.theme.KmType
import kotlinx.coroutines.delay

/** Android 16 gruplu kart: dış köşe 22dp, satırlar arası 2dp, iç köşe 6dp. */
internal val GroupOuter = RoundedCornerShape(22.dp)
private val RowShape = RoundedCornerShape(6.dp)

/** Sırayla yukarı kayarak beliren giriş (demodaki `.stag`). */
@Composable
internal fun Rise(index: Int, content: @Composable () -> Unit) {
    val reduce = rememberReduceMotion()
    val progress = remember { Animatable(if (reduce) 1f else 0f) }
    LaunchedEffect(Unit) {
        if (reduce) return@LaunchedEffect
        delay(40L * index.coerceAtMost(7))
        progress.animateTo(1f, tween(500, easing = KmMotion.standard))
    }
    Box(
        Modifier.graphicsLayer {
            alpha = progress.value
            translationY = (1f - progress.value) * 14.dp.toPx()
        },
    ) { content() }
}

@Composable
internal fun SettingsGroup(title: String?, index: Int, content: @Composable ColumnScope.() -> Unit) {
    Rise(index) {
        Column(Modifier.fillMaxWidth().padding(top = 22.dp)) {
            if (title != null) {
                Text(title, style = KmType.subhead, color = KmColors.brand, modifier = Modifier.padding(start = 6.dp, bottom = 8.dp))
            }
            Column(Modifier.fillMaxWidth().clip(GroupOuter), verticalArrangement = Arrangement.spacedBy(2.dp), content = content)
        }
    }
}

@Composable
private fun RowIcon(icon: ImageVector, tint: Color) {
    Box(Modifier.size(38.dp).clip(CircleShape).background(KmColors.bg), contentAlignment = Alignment.Center) {
        KmIcon(icon, tint, 19.dp)
    }
}

@Composable
private fun RowTexts(title: String, subtitle: String?, danger: Boolean, modifier: Modifier) {
    Column(modifier) {
        Text(title, style = KmType.callout, color = if (danger) KmColors.danger else KmColors.text)
        if (subtitle != null) {
            Text(subtitle, style = KmType.footnote, color = KmColors.textMuted, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 1.dp))
        }
    }
}

/** Gruptaki tek satır: ikon, başlık, açıklama, sağda değer ya da ok. */
@Composable
internal fun SettingRow(
    icon: ImageVector,
    title: String,
    subtitle: String? = null,
    value: String? = null,
    danger: Boolean = false,
    chevron: Boolean = true,
    onClick: (() -> Unit)?,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 64.dp)
            .clip(RowShape)
            .background(KmColors.surface)
            .then(if (onClick != null) Modifier.pressableScale(onClick = onClick, pressedOpacity = 0.92f, onClickLabel = title) else Modifier)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        RowIcon(icon, if (danger) KmColors.danger else KmColors.textSecondary)
        RowTexts(title, subtitle, danger, Modifier.weight(1f))
        if (value != null) Text(value, style = KmType.subhead, color = KmColors.textMuted, maxLines = 1)
        if (chevron && onClick != null) KmIcon(KmIcons.ChevronRight, KmColors.textMuted, 18.dp)
    }
}

/** Material 3 anahtarlı satır; tüm satıra dokunmak değiştirir. */
@Composable
internal fun SettingSwitchRow(icon: ImageVector, title: String, subtitle: String?, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 64.dp)
            .clip(RowShape)
            .background(KmColors.surface)
            .toggleable(value = checked, role = Role.Switch, onValueChange = onChange)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        RowIcon(icon, KmColors.textSecondary)
        RowTexts(title, subtitle, false, Modifier.weight(1f))
        KmSwitch(checked)
    }
}

/** Görsel M3 anahtar (etkileşimi satır taşır). */
@Composable
private fun KmSwitch(checked: Boolean) {
    val reduce = rememberReduceMotion()
    val spec = tween<Color>(if (reduce) 0 else 250)
    val track by animateColorAsState(if (checked) KmColors.brand else KmColors.surfaceElevated, spec, label = "track")
    val edge by animateColorAsState(if (checked) KmColors.brand else KmColors.textMuted, spec, label = "edge")
    val thumbColor by animateColorAsState(if (checked) KmColors.textOnBrand else KmColors.textMuted, spec, label = "thumb")
    val dpSpec = tween<androidx.compose.ui.unit.Dp>(if (reduce) 0 else 300, easing = KmMotion.standard)
    val thumb by animateDpAsState(if (checked) 24.dp else 16.dp, dpSpec, label = "thumbSize")
    val x by animateDpAsState(if (checked) 22.dp else 6.dp, dpSpec, label = "thumbX")
    Box(
        Modifier
            .size(width = 52.dp, height = 32.dp)
            .clip(RoundedCornerShape(99.dp))
            .background(track)
            .border(2.dp, edge, RoundedCornerShape(99.dp)),
        contentAlignment = Alignment.CenterStart,
    ) {
        Box(Modifier.offset(x = x - 2.dp).size(thumb).clip(CircleShape).background(thumbColor))
    }
}

/** Gruptaki serbest içerikli satır (tema seçici gibi). */
@Composable
internal fun SettingBlock(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxWidth().clip(RowShape).background(KmColors.surface).padding(horizontal = 16.dp, vertical = 12.dp),
        content = content,
    )
}

/** Genel parçalı seçici (Sistem/Açık/Koyu, Bu sohbet/Tüm sohbetler). */
@Composable
internal fun <T> KmSegmented(
    options: List<Pair<T, String>>,
    selected: T,
    onSelect: (T) -> Unit,
    modifier: Modifier = Modifier,
    enabled: (T) -> Boolean = { true },
    background: Color = KmColors.surfaceElevated,
    selectedBackground: Color = KmColors.bg,
) {
    val reduce = rememberReduceMotion()
    Row(
        modifier
            .fillMaxWidth()
            .height(48.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(background)
            .padding(3.dp)
            .selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        options.forEach { (value, label) ->
            val isSelected = value == selected
            val on = enabled(value)
            val bg by animateColorAsState(
                if (isSelected) selectedBackground else Color.Transparent,
                tween(if (reduce) 0 else KmMotion.BASE, easing = KmMotion.standard),
                label = "seg",
            )
            Box(
                Modifier
                    .weight(1f)
                    .height(42.dp)
                    .clip(RoundedCornerShape(11.dp))
                    .background(bg)
                    .selectable(selected = isSelected, enabled = on, role = Role.RadioButton, onClick = { onSelect(value) })
                    .graphicsLayer { alpha = if (on) 1f else 0.4f },
                contentAlignment = Alignment.Center,
            ) {
                Text(label, style = KmType.subhead, color = if (isSelected) KmColors.text else KmColors.textSecondary)
            }
        }
    }
}

@Composable
internal fun GapV(h: androidx.compose.ui.unit.Dp) = Spacer(Modifier.height(h))

@Composable
internal fun GapH(w: androidx.compose.ui.unit.Dp) = Spacer(Modifier.width(w))
