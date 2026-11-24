package com.tyler.kocamind.data.offline

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.StatFs
import com.tyler.kocamind.ui.chat.LocalAi
import kotlinx.coroutines.flow.StateFlow
import java.io.File
import java.util.Locale

private const val GB = 1024.0 * 1024 * 1024

private fun roundOne(value: Double) = Math.round(value * 10) / 10.0

/** deviceCompatibility.ts `getDeviceProfile` (expo-device karşılıkları). */
fun androidDeviceProfile(context: Context, storageDir: File): DeviceProfile {
    val memory = ActivityManager.MemoryInfo().also {
        (context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(it)
    }
    val storage = runCatching { StatFs(storageDir.apply { mkdirs() }.absolutePath).availableBytes / GB }.getOrNull()
    val manufacturer = Build.MANUFACTURER.replaceFirstChar { it.titlecase(Locale.ROOT) }
    val emulator = Build.FINGERPRINT.startsWith("generic") || Build.FINGERPRINT.contains("emulator") ||
        Build.MODEL.contains("sdk_gphone") || Build.HARDWARE.contains("ranchu") || Build.HARDWARE.contains("goldfish")
    return DeviceProfile(
        deviceName = listOf(manufacturer, Build.MODEL).filter { it.isNotBlank() }.joinToString(" ").ifBlank { "Bu cihaz" },
        totalRamGB = memory.totalMem.takeIf { it > 0 }?.let { roundOne(it / GB) },
        availableStorageGB = storage?.let(::roundOne),
        yearClass = null,
        architectures = Build.SUPPORTED_ABIS.toList(),
        isPhysicalDevice = !emulator,
    )
}

/** AsyncStorage anahtarlarıyla aynı adlar; çökme işareti için yazım eşzamanlı (commit). */
class SharedPrefsOfflinePrefs(context: Context) : OfflinePrefs {
    private val prefs = context.getSharedPreferences("kocamind_offline", Context.MODE_PRIVATE)
    override fun get(key: String): String? = prefs.getString(key, null)
    override fun set(key: String, value: String?) {
        prefs.edit().apply { if (value == null) remove(key) else putString(key, value) }.commit()
    }
}

/** Sohbet ekranının gördüğü yerel model arayüzü. */
class OfflineLocalAi(private val service: OfflineAiService) : LocalAi {
    override val changes: StateFlow<Int> = service.changes
    override fun downloadedModels() = service.downloadedModels()
    override fun selectedModelId() = service.selectedModel().id
    override suspend fun select(id: String, preserveAutoMode: Boolean) = service.setSelected(id, preserveAutoMode)
    override suspend fun generate(
        history: List<Pair<String, String>>,
        onPartial: (String) -> Unit,
        customInstructions: String?,
        memoryContext: String?,
    ) = service.generateReply(history, onPartial, customInstructions, memoryContext)
    override fun stop() = service.stop()
}
