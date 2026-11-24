package com.tyler.kocamind.ui.chat

import android.net.Uri
import android.widget.MediaController
import android.widget.VideoView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.tyler.kocamind.ui.theme.KmColors
import com.tyler.kocamind.ui.theme.KmRadius
import com.tyler.kocamind.ui.theme.KmSpace

/** GeneratedVideo.tsx: kontrolleri olan, döngüde oynayan video. */
@Composable
fun GeneratedVideo(uri: String) {
    AndroidView(
        factory = { context ->
            VideoView(context).apply {
                val controller = MediaController(context)
                controller.setAnchorView(this)
                setMediaController(controller)
                setOnPreparedListener { it.isLooping = true }
                setVideoURI(Uri.parse(uri))
                seekTo(1)
            }
        },
        onRelease = { it.stopPlayback() },
        modifier = Modifier
            .padding(bottom = KmSpace.md)
            .widthIn(max = 560.dp)
            .fillMaxWidth()
            .aspectRatio(16f / 9f)
            .clip(RoundedCornerShape(KmRadius.md))
            .background(KmColors.surfaceSunken),
    )
}
