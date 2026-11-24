package com.tyler.kocamind.ui.settings

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.tyler.kocamind.ui.components.rememberReduceMotion
import com.tyler.kocamind.ui.theme.KmColors
import com.tyler.kocamind.ui.theme.KmMotion
import com.tyler.kocamind.ui.theme.KmType
import com.tyler.kocamind.ui.theme.ThemeMode

private val labels = listOf(ThemeMode.System to "Sistem", ThemeMode.Light to "Açık", ThemeMode.Dark to "Koyu")

/** Üç parçalı tema seçici: Sistem / Açık / Koyu. */
@Composable
fun ThemeSelector(mode: ThemeMode, onSelect: (ThemeMode) -> Unit, modifier: Modifier = Modifier) {
    val reduce = rememberReduceMotion()
    Row(
        modifier
            .fillMaxWidth()
            .height(48.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(KmColors.surfaceElevated)
            .padding(3.dp)
            .selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        labels.forEach { (value, label) ->
            val selected = value == mode
            val bg by animateColorAsState(
                if (selected) KmColors.bg else Color.Transparent,
                tween(if (reduce) 0 else KmMotion.BASE, easing = KmMotion.standard),
                label = "seg",
            )
            Box(
                Modifier
                    .weight(1f)
                    .height(42.dp)
                    .clip(RoundedCornerShape(11.dp))
                    .background(bg)
                    .selectable(selected = selected, role = Role.RadioButton, onClick = { onSelect(value) }),
                contentAlignment = Alignment.Center,
            ) {
                Text(label, style = KmType.subhead, color = if (selected) KmColors.text else KmColors.textSecondary)
            }
        }
    }
}
