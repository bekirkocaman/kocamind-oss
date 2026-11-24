package com.tyler.kocamind.ui.settings

import com.tyler.kocamind.data.admin.AdminUserRow
import com.tyler.kocamind.data.admin.adminVisibleUsers
import com.tyler.kocamind.data.chat.ChatMessage
import com.tyler.kocamind.data.chat.FileChatHistoryRepository
import com.tyler.kocamind.data.chat.StoredChat
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

@OptIn(ExperimentalCoroutinesApi::class)
class SettingsAndAdminLogicTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private fun user(id: String, name: String?, email: String?, lastLogin: String?) = AdminUserRow(id, name, email, null, lastLogin)

    @Test
    fun admin_sortsByLastLoginNewestFirst_missingLast() {
        val users = listOf(
            user("a", "Ali", "ali@x.com", null),
            user("b", "Bora", "bora@x.com", "2026-10-01T10:00:00Z"),
            user("c", "Cem", "cem@x.com", "2026-10-05T10:00:00Z"),
        )
        assertEquals(listOf("c", "b", "a"), adminVisibleUsers(users, "").map { it.id })
    }

    @Test
    fun admin_searchesNameEmailAndId() {
        val users = listOf(
            user("uid-İSTANBUL", "Ayşe", "ayse@x.com", null),
            user("u2", "Bekir", "BEKIR@gmail.com", null),
        )
        assertEquals(listOf("u2"), adminVisibleUsers(users, "bekir").map { it.id })
        assertEquals(listOf("u2"), adminVisibleUsers(users, "gmail").map { it.id })
        assertEquals(listOf("uid-İSTANBUL"), adminVisibleUsers(users, "istanbul").map { it.id })
        assertTrue(adminVisibleUsers(users, "yok").isEmpty())
    }

    @Test
    fun export_writesStoredChatsAsJson() = runTest {
        val store = FileChatHistoryRepository(tmp.root).apply { setOwner("a@b.com") }
        store.upsert(StoredChat("c1", "Başlık", "2026-10-07T10:00:00Z", messages = listOf(ChatMessage("1", "user", "selam"))))
        val json = exportChatsJson(store.all())!!
        val first = Json.parseToJsonElement(json).jsonArray.single().jsonObject
        assertEquals("Başlık", first["title"]!!.jsonPrimitive.content)
        assertNull(exportChatsJson(emptyList()))
    }

    @Test
    fun clearHistory_localAndCloud_reportsPartialFailure() = runTest {
        val store = FileChatHistoryRepository(tmp.root).apply { setOwner("a@b.com") }
        store.upsert(StoredChat("c1", "x", "2026-10-07T10:00:00Z"))
        val ok = clearChatHistory(store, uid = "u1") { /* bulut silindi */ }
        assertEquals(ClearResult.Done, ok)
        assertTrue(store.all().isEmpty())

        store.upsert(StoredChat("c2", "y", "2026-10-07T10:00:00Z"))
        val partial = clearChatHistory(store, uid = "u1") { throw RuntimeException("ağ yok") }
        assertEquals(ClearResult.CloudFailed, partial)
        assertTrue(store.all().isEmpty())

        store.upsert(StoredChat("c3", "z", "2026-10-07T10:00:00Z"))
        assertEquals(ClearResult.Done, clearChatHistory(store, uid = null) { error("misafirde çağrılmamalı") })
    }
}
