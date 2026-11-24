package com.tyler.kocamind

import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.tyler.kocamind.data.offline.AdaptiveInferenceProfile
import com.tyler.kocamind.data.offline.LlamaNative
import com.tyler.kocamind.data.offline.LlamaSession
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * Gerçek cihazda llama.cpp köprüsünün duman testi. Model dosyası
 * files/offline-models/ altında yoksa atlanır (README: "Yerel AI cihaz testi").
 */
@RunWith(AndroidJUnit4::class)
class LlamaSmokeTest {
    @Test
    fun loadsModel_streamsTurkishReply_andBenchmarks() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val file = File(context.filesDir, "offline-models/qwen2.5-0.5b-instruct-q4_k_m.gguf")
        assumeTrue("Model dosyası yok: ${file.absolutePath}", file.exists())

        val variant = LlamaNative.ensureLoaded()
        val session = LlamaSession.open(file, contextSize = 2048)
        assertNotNull("Model açılamadı", session)
        session!!
        try {
            val prompt = session.formatChat(
                listOf("system" to "Sen KocaMind adlı Türkçe asistansın. Kısa cevap ver.", "user" to "Merhaba! Türkiye'nin başkenti neresi?"),
            )
            val profile = AdaptiveInferenceProfile("Hızlı", 2048, 1216, 64, 0.3f, 0.85f, 40, 0.05f)
            val partials = mutableListOf<String>()
            val (text, stats) = session.generate(prompt, profile, listOf("<|im_end|>", "<|endoftext|>")) { partials += it }
            // İkinci üretim: ısınmış (sayfaları belleğe alınmış) modelin gerçek hızı.
            val (text2, stats2) = session.generate(prompt, profile, listOf("<|im_end|>", "<|endoftext|>")) {}
            Log.i("LlamaSmoke", "ikinci cevap=\"$text2\" istatistik=$stats2")
            val (pp, tg) = session.bench(64, 16)
            Log.i("LlamaSmoke", "varyant=$variant istem=${prompt.length} karakter")
            Log.i("LlamaSmoke", "cevap=\"$text\"")
            Log.i("LlamaSmoke", "istatistik=$stats parça=${partials.size} bench pp=$pp tg=$tg")
            assertTrue("Boş cevap", text.isNotBlank())
            assertTrue("Akış parçası gelmedi", partials.isNotEmpty())
            assertTrue("Şablon chatml olmalı", prompt.contains("<|im_start|>user"))
            assertTrue("Hız ölçülemedi", tg > 0)
        } finally {
            session.close()
        }
    }
}
