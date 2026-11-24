package com.tyler.kocamind.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.tyler.kocamind.ui.theme.KmColors
import com.tyler.kocamind.ui.theme.KmMotion
import com.tyler.kocamind.ui.theme.KmRadius
import com.tyler.kocamind.ui.theme.KmSpace
import com.tyler.kocamind.ui.theme.KmType

// ---------------------------------------------------------------- Button

enum class ButtonVariant { Primary, Secondary, Ghost, Danger }
enum class ButtonSize { Md, Sm }

/** Button.tsx: 4 varyant, 2 boy, yükleniyor durumu, sol ikon. */
@Composable
fun KmButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: ButtonVariant = ButtonVariant.Primary,
    size: ButtonSize = ButtonSize.Md,
    loading: Boolean = false,
    enabled: Boolean = true,
    fullWidth: Boolean = false,
    leftIcon: (@Composable () -> Unit)? = null,
) {
    val fg = when (variant) {
        ButtonVariant.Primary -> KmColors.textOnBrand
        ButtonVariant.Danger -> KmColors.danger
        else -> KmColors.text
    }
    val shape = RoundedCornerShape(KmRadius.md)
    val bg = when (variant) {
        ButtonVariant.Primary -> KmColors.brand
        ButtonVariant.Secondary -> KmColors.surfaceElevated
        ButtonVariant.Ghost -> KmColors.pressed
        ButtonVariant.Danger -> KmColors.dangerMuted
    }
    val borderColor = when (variant) {
        ButtonVariant.Secondary -> KmColors.border
        ButtonVariant.Danger -> KmColors.danger
        else -> null
    }
    Box(
        modifier = modifier
            .then(if (fullWidth) Modifier.fillMaxWidth() else Modifier)
            .pressableScale(onClick = onClick, enabled = enabled && !loading, pressedOpacity = 0.82f)
            .clip(shape)
            .background(bg)
            .then(if (borderColor != null) Modifier.border(1.dp, borderColor, shape) else Modifier)
            .height(if (size == ButtonSize.Md) 48.dp else 36.dp)
            .defaultMinSize(minWidth = 44.dp)
            .padding(horizontal = if (size == ButtonSize.Md) KmSpace.lg else KmSpace.md),
        contentAlignment = Alignment.Center,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(KmSpace.sm)) {
            if (loading) {
                CircularProgressIndicator(Modifier.size(18.dp), color = fg, strokeWidth = 2.dp)
            } else {
                leftIcon?.invoke()
            }
            Text(
                text,
                style = KmType.callout.copy(fontWeight = FontWeight.SemiBold),
                color = fg,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

// ---------------------------------------------------------------- IconButton

enum class IconButtonVariant { Plain, Filled, Brand }

/** IconButton.tsx: yuvarlak, 32/40/44. */
@Composable
fun KmIconButton(
    onClick: () -> Unit,
    contentDescription: String,
    modifier: Modifier = Modifier,
    size: Dp = 40.dp,
    variant: IconButtonVariant = IconButtonVariant.Plain,
    background: Color? = null,
    enabled: Boolean = true,
    content: @Composable () -> Unit,
) {
    val bg = background ?: when (variant) {
        IconButtonVariant.Plain -> KmColors.pressed
        IconButtonVariant.Filled -> KmColors.surfaceElevated
        IconButtonVariant.Brand -> KmColors.brand
    }
    Box(
        modifier = modifier
            .size(size)
            .pressableScale(onClick = onClick, enabled = enabled, pressedOpacity = 0.72f, onClickLabel = contentDescription)
            .semantics { this.contentDescription = contentDescription }
            .clip(RoundedCornerShape(KmRadius.pill))
            .background(bg),
        contentAlignment = Alignment.Center,
    ) { content() }
}

/** lucide ikonu, RN'deki `<Icon color size />` gibi. */
@Composable
fun KmIcon(icon: ImageVector, tint: Color, size: Dp = 24.dp, modifier: Modifier = Modifier) {
    Icon(icon, contentDescription = null, tint = tint, modifier = modifier.size(size))
}

// ---------------------------------------------------------------- Surface

enum class SurfaceTone { Base, Elevated, Sunken }

/** Surface.tsx. */
@Composable
fun KmSurface(
    modifier: Modifier = Modifier,
    tone: SurfaceTone = SurfaceTone.Base,
    bordered: Boolean = false,
    radius: Dp = KmRadius.md,
    padding: Dp = 0.dp,
    elevation: Dp = 0.dp,
    content: @Composable () -> Unit,
) {
    val shape = RoundedCornerShape(radius)
    val bg = when (tone) {
        SurfaceTone.Base -> KmColors.surface
        SurfaceTone.Elevated -> KmColors.surfaceElevated
        SurfaceTone.Sunken -> KmColors.surfaceSunken
    }
    Box(
        modifier
            .then(if (elevation > 0.dp) Modifier.shadow(elevation, shape) else Modifier)
            .clip(shape)
            .background(bg)
            .then(if (bordered) Modifier.border(1.dp, KmColors.border, shape) else Modifier)
            .padding(padding),
    ) { content() }
}

// ---------------------------------------------------------------- Banner

enum class BannerTone { Info, Success, Warning, Danger, Neutral }

/** Banner.tsx: renkli şerit, sol çizgili ikon, solma animasyonu. */
@Composable
fun KmBanner(
    visible: Boolean,
    icon: @Composable () -> Unit,
    text: String,
    modifier: Modifier = Modifier,
    tone: BannerTone = BannerTone.Neutral,
    right: (@Composable RowScope.() -> Unit)? = null,
) {
    val (bg, accent) = when (tone) {
        BannerTone.Info -> KmColors.infoMuted to KmColors.info
        BannerTone.Success -> KmColors.successMuted to KmColors.success
        BannerTone.Warning -> KmColors.warningMuted to KmColors.warning
        BannerTone.Danger -> KmColors.dangerMuted to KmColors.danger
        BannerTone.Neutral -> KmColors.surfaceElevated to KmColors.textSecondary
    }
    val reduce = rememberReduceMotion()
    AnimatedVisibility(
        visible = visible,
        enter = if (reduce) fadeIn(tween(0)) else fadeIn(tween(KmMotion.BASE)),
        exit = if (reduce) fadeOut(tween(0)) else fadeOut(tween(KmMotion.BASE)),
        modifier = modifier,
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(KmRadius.md))
                .background(bg)
                .padding(KmSpace.md),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(KmSpace.md),
        ) {
            Box(
                Modifier
                    .heightIn(min = 24.dp)
                    .drawBehind { drawRect(accent, size = Size(2.dp.toPx(), size.height)) }
                    .padding(start = KmSpace.sm),
                contentAlignment = Alignment.Center,
            ) { icon() }
            Text(text, style = KmType.footnote, color = KmColors.text, modifier = Modifier.weight(1f))
            right?.invoke(this)
        }
    }
}

// ---------------------------------------------------------------- Skeleton

/** Skeleton.tsx: 0.5 ↔ 1 opaklık nabzı, 900 ms. */
@Composable
fun KmSkeleton(modifier: Modifier = Modifier, height: Dp = 16.dp, radius: Dp = KmRadius.sm) {
    val reduce = rememberReduceMotion()
    val alpha = if (reduce) {
        0.72f
    } else {
        val transition = rememberInfiniteTransition(label = "skeleton")
        val a by transition.animateFloat(
            initialValue = 0.5f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(
                tween(900, easing = KmMotion.standard),
                RepeatMode.Reverse,
            ),
            label = "alpha",
        )
        a
    }
    Box(
        modifier
            .height(height)
            .graphicsLayer { this.alpha = alpha }
            .clip(RoundedCornerShape(radius))
            .background(KmColors.surfaceElevated),
    )
}

@Composable
fun KmSkeletonText(lines: Int = 3, modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(KmSpace.sm)) {
        repeat(lines) { index ->
            KmSkeleton(Modifier.fillMaxWidth(if (index == lines - 1) 0.68f else 1f), height = 14.dp)
        }
    }
}

/** Ortak yatay ayırıcı (border renginde 1dp). */
@Composable
fun KmDivider(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(1.dp).background(KmColors.border))
}
