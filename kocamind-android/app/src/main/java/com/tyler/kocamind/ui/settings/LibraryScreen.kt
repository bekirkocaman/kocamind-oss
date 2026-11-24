package com.tyler.kocamind.ui.settings

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.tyler.kocamind.data.media.LibraryStore
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
import kotlinx.coroutines.launch

/** library.tsx: gönderilen ve üretilen görseller. */
@Composable
fun LibraryScreen(library: LibraryStore, onBack: () -> Unit, modifier: Modifier = Modifier) {
    val stored by library.images.collectAsStateWithLifecycle()
    val images = remember(stored) { stored.reversed() }
    val scope = rememberCoroutineScope()
    var confirmClear by remember { mutableStateOf(false) }
    val reduce = rememberReduceMotion()

    Column(modifier) {
        Row(
            Modifier.fillMaxWidth().height(56.dp).padding(horizontal = KmSpace.lg),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            KmIconButton(onClick = onBack, contentDescription = "Geri dön") { KmIcon(KmIcons.ArrowLeft, KmColors.text, 24.dp) }
            Spacer(Modifier.width(KmSpace.lg))
            Text("Kitaplık", style = KmType.headline, color = KmColors.text, modifier = Modifier.weight(1f))
            if (images.isNotEmpty()) {
                Row(
                    Modifier.pressableScale(onClick = { confirmClear = true }, pressedOpacity = 0.9f, onClickLabel = "Kitaplığı temizle"),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    KmIcon(KmIcons.Trash2, KmColors.danger, 20.dp)
                    Text("Temizle", style = KmType.subhead, color = KmColors.danger)
                }
            }
        }

        if (images.isEmpty()) {
            val alpha = remember { Animatable(if (reduce) 1f else 0f) }
            LaunchedEffect(Unit) { alpha.animateTo(1f, tween(KmMotion.BASE, easing = KmMotion.standard)) }
            Column(
                Modifier.fillMaxSize().graphicsLayer { this.alpha = alpha.value }.padding(KmSpace.xl),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                KmIcon(KmIcons.Image, KmColors.textMuted, 40.dp, Modifier.padding(bottom = KmSpace.lg))
                Text("Kitaplığın boş", style = KmType.title, color = KmColors.text, modifier = Modifier.padding(bottom = KmSpace.sm))
                Text(
                    "Gönderdiğin fotoğraflar otomatik olarak burada saklanır.",
                    style = KmType.body,
                    color = KmColors.textSecondary,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = KmSpace.md),
                )
            }
        } else {
            Text(
                "${images.size} görsel",
                style = KmType.footnote,
                color = KmColors.textMuted,
                modifier = Modifier.padding(start = KmSpace.lg, end = KmSpace.lg, top = KmSpace.md, bottom = KmSpace.xs),
            )
            BoxWithConstraints(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
                val columns = when {
                    maxWidth >= 900.dp -> 5
                    maxWidth >= 600.dp -> 4
                    else -> 3
                }
                LazyVerticalGrid(
                    columns = GridCells.Fixed(columns),
                    modifier = Modifier.widthIn(max = 920.dp).fillMaxWidth(),
                    contentPadding = PaddingValues(KmSpace.sm),
                ) {
                    itemsIndexed(images, key = { _, image -> image.uri }) { index, image ->
                        val alpha = remember { Animatable(if (reduce) 1f else 0f) }
                        LaunchedEffect(Unit) {
                            alpha.animateTo(1f, tween(KmMotion.BASE, delayMillis = minOf(index * 30, 300), easing = KmMotion.standard))
                        }
                        Box(Modifier.padding(KmSpace.xs).graphicsLayer { this.alpha = alpha.value }) {
                            val shape = RoundedCornerShape(KmRadius.md)
                            AsyncImage(
                                model = image.uri,
                                contentDescription = "Görsel",
                                contentScale = ContentScale.Crop,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .aspectRatio(1f)
                                    .pressableScale(onClick = {}, pressedOpacity = 0.9f)
                                    .clip(shape)
                                    .background(KmColors.surfaceElevated)
                                    .border(0.5.dp, KmColors.border, shape),
                            )
                        }
                    }
                }
            }
        }
    }

    if (confirmClear) {
        AlertDialog(
            onDismissRequest = { confirmClear = false },
            title = { Text("Kitaplığı Temizle") },
            text = { Text("Tüm görseller silinecek. Bu işlem geri alınamaz.") },
            confirmButton = {
                TextButton(onClick = { confirmClear = false; scope.launch { library.clear() } }) { Text("Temizle", color = KmColors.danger) }
            },
            dismissButton = { TextButton(onClick = { confirmClear = false }) { Text("İptal", color = KmColors.textSecondary) } },
            containerColor = KmColors.surfaceElevated,
            titleContentColor = KmColors.text,
            textContentColor = KmColors.textSecondary,
        )
    }
}
