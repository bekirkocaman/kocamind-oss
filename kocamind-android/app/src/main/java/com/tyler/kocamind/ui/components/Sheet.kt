package com.tyler.kocamind.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.Row
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import com.tyler.kocamind.ui.icons.KmIcons
import kotlinx.coroutines.launch
import com.tyler.kocamind.ui.theme.KmColors
import com.tyler.kocamind.ui.theme.KmRadius
import com.tyler.kocamind.ui.theme.KmSpace
import com.tyler.kocamind.ui.theme.KmType

/**
 * Sheet.tsx: alttan açılan panel. Tutamaçtan sürüklenerek ya da karartıya dokunarak kapanır.
 * [scrollable] false ise içerik kendi listesini yönetir.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun KmSheet(
    visible: Boolean,
    onClose: () -> Unit,
    title: String? = null,
    scrollable: Boolean = true,
    containerColor: Color = KmColors.bg,
    content: @Composable ColumnScope.() -> Unit,
) {
    if (!visible) return
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    // X düğmesi de sürükleyerek kapatma gibi aşağı kayarak kapansın.
    val close: () -> Unit = { scope.launch { state.hide() }.invokeOnCompletion { onClose() } }
    ModalBottomSheet(
        onDismissRequest = onClose,
        sheetState = state,
        // Tam boya uzayınca başlık durum çubuğunun altına girmesin.
        modifier = Modifier.statusBarsPadding(),
        containerColor = containerColor,
        contentColor = KmColors.text,
        scrimColor = KmColors.overlay,
        shape = RoundedCornerShape(topStart = 27.dp, topEnd = 27.dp),
        dragHandle = {
            Box(
                Modifier
                    .padding(top = 8.dp)
                    .width(34.dp)
                    .height(4.dp)
                    .clip(RoundedCornerShape(KmRadius.pill))
                    .background(KmColors.surfaceElevated),
            )
        },
    ) {
        // Klon düzeni: solda X, ortada başlık.
        if (title != null) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                KmIconButton(onClick = close, contentDescription = "Kapat", background = Color.Transparent) {
                    KmIcon(KmIcons.X, KmColors.text, 22.dp)
                }
                Text(
                    title,
                    style = KmType.headline,
                    color = KmColors.text,
                    textAlign = TextAlign.Center,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f).padding(end = 40.dp),
                )
            }
        }
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = KmSpace.lg)
                .padding(top = KmSpace.sm)
                .then(if (scrollable) Modifier.verticalScroll(rememberScrollState()) else Modifier)
                .navigationBarsPadding()
                .padding(bottom = KmSpace.lg),
            content = content,
        )
    }
}
