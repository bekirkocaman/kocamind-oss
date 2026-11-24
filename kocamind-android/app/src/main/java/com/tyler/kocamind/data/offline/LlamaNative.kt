package com.tyler.kocamind.data.offline

import android.os.Build
import android.util.Log
import java.io.File

/** Akış sırasında o ana kadarki tüm metnin UTF-8 baytları. */
fun interface PartialCallback {
    fun onPartial(bytes: ByteArray)
}

/** llama_jni.cpp ile aynı sıra. */
enum class StopReason { Eos, Limit, Interrupted, Word, ContextFull }

data class GenerationStats(val promptTokensPerSecond: Double, val tokensPerSecond: Double, val stopReason: StopReason, val generatedTokens: Int)

/**
 * llama.cpp JNI köprüsü. Kütüphane, işlemcinin desteklediği en hızlı varyantla
 * (dotprod / i8mm) ilk kullanımda yüklenir (llama.rn RNLlama.java ile aynı seçim).
 */
object LlamaNative {
    private const val TAG = "LlamaNative"

    @Volatile
    private var loadedVariant: String? = null

    val isSupported: Boolean get() = Build.SUPPORTED_ABIS.any { it == "arm64-v8a" }

    @Synchronized
    fun ensureLoaded(): String {
        loadedVariant?.let { return it }
        if (!isSupported) throw IllegalStateException("Yerel AI için 64 bit ARM işlemci gerekiyor.")
        val features = runCatching { File("/proc/cpuinfo").readText() }.getOrDefault("")
        val dotProd = features.contains("asimddp") || features.contains("dotprod")
        val i8mm = features.contains("i8mm")
        val candidates = buildList {
            if (dotProd && i8mm) add("v8_2_dotprod_i8mm")
            if (dotProd) add("v8_2_dotprod")
            add("v8")
        }
        for (variant in candidates) {
            try {
                System.loadLibrary("kocamind_llama_$variant")
                loadedVariant = variant
                Log.i(TAG, "llama.cpp yüklendi: $variant")
                return variant
            } catch (e: UnsatisfiedLinkError) {
                Log.w(TAG, "$variant yüklenemedi", e)
            }
        }
        throw IllegalStateException("Yerel AI kütüphanesi yüklenemedi.")
    }

    external fun nativeLoad(path: String, nCtx: Int, nBatch: Int, nThreads: Int): Long
    external fun nativeFree(handle: Long)
    external fun nativeStop(handle: Long)
    external fun nativeFormatChat(handle: Long, roles: Array<ByteArray>, contents: Array<ByteArray>): ByteArray
    external fun nativeCountTokens(handle: Long, text: ByteArray): Int
    external fun nativeContextSize(handle: Long): Int
    external fun nativeGenerate(
        handle: Long,
        prompt: ByteArray,
        nPredict: Int,
        temperature: Float,
        topP: Float,
        topK: Int,
        minP: Float,
        stopWords: Array<ByteArray>,
        callback: PartialCallback,
    ): ByteArray
    external fun nativeLastStats(handle: Long): DoubleArray
    external fun nativeBench(handle: Long, promptTokens: Int, generateTokens: Int): DoubleArray
}

/** Yüklenmiş bir model. Tek iş parçacığından kullanılmalı (servis bunu sağlar). */
class LlamaSession private constructor(private val handle: Long, override val contextSize: Int) : LocalLlm {
    @Volatile
    private var closed = false

    override fun formatChat(messages: List<Pair<String, String>>): String = String(
        LlamaNative.nativeFormatChat(
            handle,
            messages.map { it.first.toByteArray() }.toTypedArray(),
            messages.map { it.second.toByteArray() }.toTypedArray(),
        ),
        Charsets.UTF_8,
    )

    override fun countTokens(text: String): Int = LlamaNative.nativeCountTokens(handle, text.toByteArray())

    override fun generate(
        prompt: String,
        profile: AdaptiveInferenceProfile,
        stopWords: List<String>,
        onPartial: (String) -> Unit,
    ): Pair<String, GenerationStats> {
        // Asıl koruma OfflineAiService kilidi; bu, serbest bırakılmış belleğe son savunma.
        check(!closed) { "Yerel model kapatıldı" }
        val bytes = LlamaNative.nativeGenerate(
            handle, prompt.toByteArray(), profile.nPredict, profile.temperature, profile.topP, profile.topK, profile.minP,
            stopWords.map { it.toByteArray() }.toTypedArray(),
        ) { partial -> onPartial(String(partial, Charsets.UTF_8)) }
        val stats = LlamaNative.nativeLastStats(handle)
        return String(bytes, Charsets.UTF_8) to GenerationStats(
            promptTokensPerSecond = stats[0],
            tokensPerSecond = stats[1],
            stopReason = StopReason.entries.getOrElse(stats[2].toInt()) { StopReason.Limit },
            generatedTokens = stats[3].toInt(),
        )
    }

    @Synchronized
    override fun stop() {
        if (!closed) LlamaNative.nativeStop(handle)
    }

    /** [prompt tok/s, üretim tok/s] */
    override fun bench(promptTokens: Int, generateTokens: Int): Pair<Double, Double> =
        LlamaNative.nativeBench(handle, promptTokens, generateTokens).let { it[0] to it[1] }

    @Synchronized
    override fun close() {
        if (closed) return
        closed = true
        LlamaNative.nativeFree(handle)
    }

    companion object {
        /** Modeli açar; başarısızsa null. Uzun sürebilir, ana iş parçacığında çağırma. */
        fun open(file: File, contextSize: Int): LlamaSession? {
            LlamaNative.ensureLoaded()
            val threads = Runtime.getRuntime().availableProcessors().let { (it - 2).coerceIn(2, 6) }
            val batch = if (contextSize >= 4096) 512 else 256
            val handle = LlamaNative.nativeLoad(file.absolutePath, contextSize, batch, threads)
            return if (handle == 0L) null else LlamaSession(handle, LlamaNative.nativeContextSize(handle))
        }
    }
}
