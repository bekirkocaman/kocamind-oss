package com.tyler.kocamind.data.media

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File

/** AsyncStorage `library_images` öğesi. */
@Serializable
data class LibraryImage(val uri: String, val date: String, val generated: Boolean = false, val prompt: String? = null)

/** Kitaplık ekranının gösterdiği görseller (seçilen ve üretilen). */
class LibraryStore(dir: File) {
    private val file = File(dir, "library_images.json")
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    private val lock = Mutex()
    private val items = MutableStateFlow(load())
    val images: StateFlow<List<LibraryImage>> = items

    private fun load(): List<LibraryImage> =
        runCatching { json.decodeFromString<List<LibraryImage>>(file.readText()) }.getOrDefault(emptyList())

    suspend fun add(image: LibraryImage) = lock.withLock {
        if (items.value.any { it.uri == image.uri }) return@withLock
        items.value = items.value + image
        save()
    }

    suspend fun remove(uri: String) = lock.withLock {
        items.value = items.value.filter { it.uri != uri }
        save()
    }

    suspend fun clear() = lock.withLock {
        items.value = emptyList()
        save()
    }

    private suspend fun save() = withContext(Dispatchers.IO) {
        file.parentFile?.mkdirs()
        file.writeText(json.encodeToString(items.value))
    }
}
