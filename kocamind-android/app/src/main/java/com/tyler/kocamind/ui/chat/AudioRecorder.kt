package com.tyler.kocamind.ui.chat

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import java.io.File

/** expo-audio HIGH_QUALITY karşılığı: AAC / m4a kayıt. */
class AudioRecorder(private val context: Context) {
    private var recorder: MediaRecorder? = null
    private var file: File? = null

    val isRecording: Boolean get() = recorder != null

    fun start() {
        val out = File(context.cacheDir, "recording-${System.currentTimeMillis()}.m4a")
        val r = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(context) else @Suppress("DEPRECATION") MediaRecorder()
        r.setAudioSource(MediaRecorder.AudioSource.MIC)
        r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
        r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
        r.setAudioSamplingRate(44100)
        r.setAudioEncodingBitRate(128_000)
        r.setOutputFile(out.absolutePath)
        r.prepare()
        r.start()
        recorder = r
        file = out
    }

    /** Kaydı bitirir ve ses baytlarını döner. */
    fun stop(): ByteArray {
        val r = recorder ?: throw IllegalStateException("Kayıt başlatılmamış.")
        recorder = null
        try {
            r.stop()
        } finally {
            r.release()
        }
        val out = file ?: throw IllegalStateException("Kayıt dosyası oluşturulamadı.")
        file = null
        return out.readBytes().also { out.delete() }
    }

    fun release() {
        runCatching { recorder?.release() }
        recorder = null
    }
}
