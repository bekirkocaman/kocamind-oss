package com.tyler.kocamind.data.memory

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

private class FakeMemoryApi : MemoryApi {
    var stored = mutableListOf(Memory("isim", "Bekir", "kisisel"), Memory("araba", "Toyota", "genel"))
    val extracted = mutableListOf<String>()
    var extractChanges = 1
    var failList = false

    override suspend fun listMemories(): List<Memory> {
        if (failList) throw IllegalStateException("ağ yok")
        return stored.toList()
    }
    override suspend fun extractMemories(message: String): ExtractResult {
        extracted += message
        if (extractChanges > 0) stored += Memory("şehir", "İstanbul", "kisisel")
        return ExtractResult(if (extractChanges > 0) listOf("şehir") else emptyList(), 0)
    }
    var failDelete = false
    override suspend fun deleteMemory(key: String?) {
        if (failDelete) throw IllegalStateException("ağ yok")
        if (key == null) stored.clear() else stored.removeAll { it.key == key }
    }
    override suspend fun summarizeConversation(previous: String?, messages: List<SummaryMessage>) = "- özet"
    var insightFails = false
    override suspend fun importMemories(text: String): ImportResult {
        stored += Memory("hedef", "Şirket kurmak", "is")
        return ImportResult(1, 0)
    }
    override suspend fun memoryInsight(refresh: Boolean): MemoryInsight {
        if (insightFails) throw IllegalStateException("model yok")
        return MemoryInsight("Objektif yorum", stored.size)
    }
}

private class MemoryCacheFake : MemoryCache {
    val files = mutableMapOf<String, List<Memory>>()
    override suspend fun load(uid: String) = files[uid]
    override suspend fun save(uid: String, memories: List<Memory>) { files[uid] = memories }
    override suspend fun delete(uid: String) { files.remove(uid) }
}

@RunWith(AndroidJUnit4::class)
class MemoryRepositoryTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val api = FakeMemoryApi()

    private fun TestScope.repo() = MemoryRepository(api, MemoryPrefs(context), this)

    @Test fun refresh_loadsList_andFailureKeepsError() = runTest {
        val repo = repo()
        assertNull(repo.memories.value)
        assertTrue(repo.refresh())
        assertEquals(2, repo.memories.value!!.size)
        api.failList = true
        assertFalse(repo.refresh())
        assertEquals(2, repo.memories.value!!.size)
    }

    @Test fun prompt_usesMemories_onlyWhenEnabled() = runTest {
        val repo = repo()
        repo.refresh()
        assertTrue(repo.promptFor("selam").contains("- isim: Bekir"))
        repo.prefs.setEnabled(false)
        assertEquals("", repo.promptFor("selam"))
    }

    @Test fun remember_runsInBackground_andRefreshesOnChange() = runTest(StandardTestDispatcher()) {
        val repo = repo()
        repo.refresh()
        repo.rememberInBackground("İstanbul'da yaşıyorum")
        advanceUntilIdle()
        assertEquals(listOf("İstanbul'da yaşıyorum"), api.extracted)
        assertTrue(repo.memories.value!!.any { it.key == "şehir" })
    }

    @Test fun remember_reportsSavedKeys() = runTest(StandardTestDispatcher()) {
        val repo = repo()
        val saved = mutableListOf<List<String>>()
        repo.rememberInBackground("İstanbul'da yaşıyorum") { saved += it }
        advanceUntilIdle()
        assertEquals(listOf(listOf("şehir")), saved)
    }

    @Test fun forget_deletesEachKey_andReportsFailure() = runTest {
        val repo = repo()
        repo.refresh()
        assertTrue(repo.forget(listOf("isim", "araba")))
        assertEquals(emptyList<Memory>(), repo.memories.value)
        api.failDelete = true
        assertFalse(repo.forget(listOf("şehir")))
    }

    @Test fun remember_skipped_whenAutoOff_orMemoryOff() = runTest(StandardTestDispatcher()) {
        val repo = repo()
        val prefs = repo.prefs
        prefs.setAutoSave(false)
        repo.rememberInBackground("a")
        prefs.setAutoSave(true); prefs.setEnabled(false)
        repo.rememberInBackground("b")
        advanceUntilIdle()
        assertTrue(api.extracted.isEmpty())
    }

    @Test fun delete_updatesListImmediately() = runTest {
        val repo = repo()
        repo.refresh()
        repo.delete("isim")
        assertEquals(listOf("araba"), repo.memories.value!!.map { it.key })
        repo.deleteAll()
        assertEquals(emptyList<Memory>(), repo.memories.value)
    }

    @Test fun clear_forgetsCachedList() = runTest {
        val repo = repo()
        repo.refresh()
        repo.clear()
        assertNull(repo.memories.value)
        assertEquals("", repo.promptFor("selam"))
    }

    @Test fun import_savesAndRefreshesList() = runTest {
        val repo = repo()
        repo.refresh()
        assertEquals(ImportResult(1, 0), repo.importText("- [İş] hedef: Şirket kurmak"))
        assertTrue(repo.memories.value!!.any { it.key == "hedef" })
    }

    @Test fun switchUser_loadsDeviceCopy_thenCloud_andKeepsCopyOffline() = runTest {
        val cache = MemoryCacheFake().apply { files["u1"] = listOf(Memory("eski", "kopya", "genel")) }
        val repo = MemoryRepository(api, MemoryPrefs(context), this, cache)
        api.failList = true
        repo.switchUser("u1")
        // Çevrimdışı: cihazdaki kopya kullanılır.
        assertEquals(listOf("eski"), repo.memories.value!!.map { it.key })
        api.failList = false
        assertTrue(repo.refresh())
        assertEquals(listOf("isim", "araba"), cache.files["u1"]!!.map { it.key })
        repo.delete("isim")
        assertEquals(listOf("araba"), cache.files["u1"]!!.map { it.key })
    }

    @Test fun switchUser_neverShowsOrWritesPreviousUsersMemories() = runTest {
        val cache = MemoryCacheFake()
        val repo = MemoryRepository(api, MemoryPrefs(context), this, cache)
        repo.switchUser("u1")
        repo.switchUser("u2")
        assertEquals(2, cache.files["u2"]!!.size)
        repo.switchUser(null)
        assertNull(repo.memories.value)
        assertEquals("", repo.promptFor("selam"))
    }

    @Test fun forget_deletesDeviceCopy() = runTest {
        val cache = MemoryCacheFake()
        val repo = MemoryRepository(api, MemoryPrefs(context), this, cache)
        repo.switchUser("u1")
        repo.forget("u1")
        assertNull(cache.files["u1"])
        assertNull(repo.memories.value)
    }

    @Test fun fileCache_roundTripsPerUser() = runTest {
        val dir = java.io.File(context.cacheDir, "memtest").apply { deleteRecursively() }
        val cache = FileMemoryCache(dir)
        cache.save("u1", listOf(Memory("isim", "Bekir", "kisisel")))
        assertEquals(listOf(Memory("isim", "Bekir", "kisisel")), cache.load("u1"))
        assertNull(cache.load("u2"))
        cache.delete("u1")
        assertNull(cache.load("u1"))
    }

    @Test fun insight_returnsNullOnFailure() = runTest {
        val repo = repo()
        assertEquals(MemoryInsight("Objektif yorum", 2), repo.insight(refresh = false))
        api.insightFails = true
        assertNull(repo.insight(refresh = true))
    }
}
