package com.tyler.kocamind.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.background
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.tyler.kocamind.ui.icons.KmIcons
import com.tyler.kocamind.ui.nav.LocalDrawer
import com.tyler.kocamind.ui.theme.KmColors
import com.tyler.kocamind.ui.theme.KmSpace
import com.tyler.kocamind.ui.theme.KmType

/** React Navigation'ın varsayılan drawer başlığı: menü düğmesi + başlık (ör. Kitaplık). */
@Composable
fun KmScreenHeader(title: String, modifier: Modifier = Modifier, right: (@Composable () -> Unit)? = null) {
    val drawer = LocalDrawer.current
    Row(
        modifier
            .fillMaxWidth()
            .height(56.dp)
            .padding(horizontal = KmSpace.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        KmIconButton(onClick = drawer.open, contentDescription = "Menüyü aç", size = 40.dp, background = KmColors.bg) {
            KmIcon(KmIcons.Menu, KmColors.text, 22.dp)
        }
        Spacer(Modifier.width(KmSpace.md))
        Text(title, style = KmType.headline, color = KmColors.text, modifier = Modifier.weight(1f))
        right?.invoke()
    }
}

/** Kendi başlığını çizen ekranlar için geri düğmeli başlık (auth, ayarlar, admin). */
@Composable
fun KmBackHeader(onBack: () -> Unit, title: String? = null, modifier: Modifier = Modifier) {
    Row(
        modifier
            .fillMaxWidth()
            .padding(horizontal = KmSpace.xl, vertical = KmSpace.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        KmIconButton(onClick = onBack, contentDescription = "Geri dön", background = KmColors.surface) {
            KmIcon(KmIcons.ArrowLeft, KmColors.text, 22.dp)
        }
        if (title != null) {
            Spacer(Modifier.width(KmSpace.md))
            Text(title, style = KmType.headline, color = KmColors.text)
        }
    }
}
