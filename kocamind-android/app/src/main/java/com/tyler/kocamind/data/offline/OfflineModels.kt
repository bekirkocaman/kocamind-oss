package com.tyler.kocamind.data.offline

/** offlineAI.ts `OfflineModel`. */
data class OfflineModel(
    val id: String,
    val name: String,
    val sizeMB: Int,
    val expectedBytes: Long,
    val url: String,
    val fileName: String,
    val description: String,
    val qualityLabel: String,
    /** Türkçe sohbet kalitesi (1-10). */
    val qualityScore: Int,
    val parameterCountB: Double,
    val family: String,
    val supportsThinking: Boolean,
    val minRamGB: Int,
    val recommendedRamGB: Int,
    val minYearClass: Int,
    /** İndirilen dosyanın SHA-256 özeti; [url] aynı içeriğe sabitlenmiş bir commit'i gösterir. */
    val sha256: String,
) {
    val isGemma: Boolean get() = family.startsWith("gemma")
}

// Adresler `resolve/main` değil, belirli bir commit'e sabitli: depo sahibi dosyayı değiştirse de
// aynı dosya iner ve [OfflineModel.sha256] ile doğrulanır. Sürüm yükseltmek için commit ve özet
// Hugging Face API'sinden (`/api/models/<depo>/revision/<commit>?blobs=true`) birlikte güncellenir.
// qualityScore: qwen3.5-2b, gemma3-1b, qwen2.5-1.5b ve qwen3-1.7b 25 Eylül 2026'da 35 soruluk
// Türkçe testle ölçüldü; diğerleri tahmindir.
val OFFLINE_MODELS: List<OfflineModel> = listOf(
    OfflineModel(
        "qwen2.5-0.5b", "Qwen 2.5 Mini (0.5B)", 491, 491400032,
        "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/9217f5db79a29953eb74d5343926648285ec7e67/qwen2.5-0.5b-instruct-q4_k_m.gguf",
        "qwen2.5-0.5b-instruct-q4_k_m.gguf",
        "Deneysel: Türkçede çok zayıf, yalnızca çok eski telefonlar için.",
        "Deneysel", 1, 0.5, "qwen2.5", false, 3, 4, 2018,
        sha256 = "74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db",
    ),
    OfflineModel(
        "qwen3.5-0.8b", "Qwen 3.5 Mini (0.8B)", 533, 532517120,
        "https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/6ab461498e2023f6e3c1baea90a8f0fe38ab64d0/Qwen3.5-0.8B-Q4_K_M.gguf",
        "Qwen3.5-0.8B-Q4_K_M.gguf",
        "Deneysel: Türkçede zayıf; giriş seviye cihazlarda Gemma 3 1B önerilir.",
        "Deneysel", 2, 0.8, "qwen3.5", true, 3, 4, 2019,
        sha256 = "bd258782e35f7f458f8aced1adc053e6e92e89bc735ba3be89d38a06121dc517",
    ),
    OfflineModel(
        "gemma3-1b", "Gemma 3 Mini (1B)", 806, 806058240,
        "https://huggingface.co/ggml-org/gemma-3-1b-it-GGUF/resolve/f9c28bcd85737ffc5aef028638d3341d49869c27/gemma-3-1b-it-Q4_K_M.gguf",
        "gemma-3-1b-it-Q4_K_M.gguf",
        "Kısa ve düzgün Türkçe (%41) ama mantık sorularında zayıf; düşük RAM'li telefonlar için.",
        "Temel", 4, 1.0, "gemma3", false, 3, 4, 2019,
        sha256 = "8ccc5cd1f1b3602548715ae25a66ed73fd5dc68a210412eea643eb20eb75a135",
    ),
    OfflineModel(
        "qwen2.5-1.5b", "Qwen 2.5 (1.5B)", 1117, 1117320736,
        "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/91cad51170dc346986eccefdc2dd33a9da36ead9/qwen2.5-1.5b-instruct-q4_k_m.gguf",
        "qwen2.5-1.5b-instruct-q4_k_m.gguf",
        "Hızlı ama Türkçe testte zayıf (%34); sık uydurur.",
        "Hızlı", 3, 1.5, "qwen2.5", false, 4, 6, 2020,
        sha256 = "6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e",
    ),
    OfflineModel(
        "qwen3-1.7b", "Qwen 3 (1.7B)", 1282, 1282439264,
        "https://huggingface.co/ggml-org/Qwen3-1.7B-GGUF/resolve/daeb8e2d528a760970442092f6bf1e55c3b659eb/Qwen3-1.7B-Q4_K_M.gguf",
        "Qwen3-1.7B-Q4_K_M.gguf",
        "Türkçe testte orta (%50); Qwen 3.5 2B daha iyi sonuç verdi.",
        "Hızlı", 5, 1.7, "qwen3", true, 4, 6, 2020,
        sha256 = "d2387ca2dbfee2ffabce7120d3770dadca0b293052bc2f0e138fdc940d9bc7b5",
    ),
    OfflineModel(
        "qwen3.5-2b", "Qwen 3.5 (2B)", 1281, 1280835840,
        "https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/f6d5376be1edb4d416d56da11e5397a961aca8ae/Qwen3.5-2B-Q4_K_M.gguf",
        "Qwen3.5-2B-Q4_K_M.gguf",
        "Türkçe testte en iyi küçük model (%61). Bilgi sorularında zaman zaman uydurabilir.",
        "Dengeli", 6, 2.0, "qwen3.5", true, 4, 6, 2021,
        sha256 = "aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223",
    ),
    OfflineModel(
        "qwen2.5-3b", "Qwen 2.5 (3B)", 2105, 2104932768,
        "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/7dabda4d13d513e3e842b20f0d435c732f172cbe/qwen2.5-3b-instruct-q4_k_m.gguf",
        "qwen2.5-3b-instruct-q4_k_m.gguf",
        "Tutarlı ama Türkçede aynı boyuttaki Gemma'nın gerisinde.",
        "Dengeli", 5, 3.0, "qwen2.5", false, 8, 12, 2021,
        sha256 = "626b4a6678b86442240e33df819e00132d3ba7dddfe1cdc4fbb18e0a9615c62d",
    ),
    OfflineModel(
        "gemma3n-e2b", "Gemma 3n (E2B)", 3027, 3026881888,
        "https://huggingface.co/unsloth/gemma-3n-E2B-it-GGUF/resolve/d7bd20d510eff26f3f95260c50f032fee8931a35/gemma-3n-E2B-it-Q4_K_M.gguf",
        "gemma-3n-E2B-it-Q4_K_M.gguf",
        "Telefonlar için tasarlandı; orta sınıf cihazlarda iyi Türkçe.",
        "Akıllı", 7, 2.0, "gemma3n", false, 10, 12, 2021,
        sha256 = "189d42b4303cb1078ea8d00963f437cd6d884069b7ba2ba80b38cd09585dc415",
    ),
    OfflineModel(
        "qwen3-4b", "Qwen 3 (4B)", 2497, 2497280256,
        "https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/bc640142c66e1fdd12af0bd68f40445458f3869b/Qwen3-4B-Q4_K_M.gguf",
        "Qwen3-4B-Q4_K_M.gguf",
        "Mantık ve matematikte güçlü; Türkçesi iyi-orta.",
        "Güçlü", 6, 4.0, "qwen3", true, 10, 12, 2022,
        sha256 = "7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5",
    ),
    OfflineModel(
        "qwen3.5-4b", "Qwen 3.5 (4B)", 2741, 2740937888,
        "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/e87f176479d0855a907a41277aca2f8ee7a09523/Qwen3.5-4B-Q4_K_M.gguf",
        "Qwen3.5-4B-Q4_K_M.gguf",
        "Güçlü telefonlarda iyi muhakeme; Türkçesi iyi-orta.",
        "Güçlü", 7, 4.0, "qwen3.5", true, 10, 12, 2023,
        sha256 = "00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4",
    ),
    OfflineModel(
        "gemma3-4b", "Gemma 3 (4B)", 2490, 2489757856,
        "https://huggingface.co/ggml-org/gemma-3-4b-it-GGUF/resolve/d0976223747697cb51e056d85c532013931fe52e/gemma-3-4b-it-Q4_K_M.gguf",
        "gemma-3-4b-it-Q4_K_M.gguf",
        "Türkçe sohbette güçlü ve doğal; 12 GB RAM'li telefonlar için.",
        "Çok akıllı", 8, 4.0, "gemma3", false, 10, 12, 2022,
        sha256 = "882e8d2db44dc554fb0ea5077cb7e4bc49e7342a1f0da57901c0802ea21a0863",
    ),
    OfflineModel(
        "gemma3n-e4b", "Gemma 3n (E4B)", 4539, 4539054208,
        "https://huggingface.co/unsloth/gemma-3n-E4B-it-GGUF/resolve/90fa8b0e431faeae50c305828bc260d6f71720e1/gemma-3n-E4B-it-Q4_K_M.gguf",
        "gemma-3n-E4B-it-Q4_K_M.gguf",
        "Üst seviye telefonlarda en iyi Türkçe kalite.",
        "En akıllı", 9, 4.0, "gemma3n", false, 12, 16, 2023,
        sha256 = "43b489bb77a81bda85180e7c490d40ad7f1d5c2ce654c9b05e15e104bd3c777e",
    ),
    OfflineModel(
        "qwen3.5-9b", "Qwen 3.5 Max (9B)", 5681, 5680522464,
        "https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/3885219b6810b007914f3a7950a8d1b469d598a5/Qwen3.5-9B-Q4_K_M.gguf",
        "Qwen3.5-9B-Q4_K_M.gguf",
        "16 GB sınıfı amiral gemileri için; yavaş ama güçlü.",
        "Zirve", 8, 9.0, "qwen3.5", true, 12, 16, 2024,
        sha256 = "03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8",
    ),
)

/** Boyutu "2.5 GB" / "806 MB" biçiminde yazar (offline-models.tsx `formatModelSize`). */
fun formatModelSize(model: OfflineModel): String =
    if (model.expectedBytes >= 1_000_000_000) {
        String.format(java.util.Locale.US, "%.1f GB", model.expectedBytes / 1_000_000_000.0)
    } else {
        "${Math.round(model.expectedBytes / 1_000_000.0)} MB"
    }
