package com.tyler.kocamind.data.queue

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class FileOfflineQueueTest {
    @get:Rule
    val tmp = TemporaryFolder()

    @Test
    fun enqueuePersistsAndDequeueRemoves() = runTest {
        val q = FileOfflineQueue(tmp.root)
        val a = q.enqueue(content = "bir", ownerId = "u1", chatId = "c1", now = 10)
        q.enqueue(content = "iki", ownerId = "u2", chatId = "c2", now = 11)
        val reopened = FileOfflineQueue(tmp.root)
        assertEquals(listOf("bir", "iki"), reopened.all().map { it.content })
        assertEquals(1, reopened.count("u1"))
        assertEquals(0, reopened.count(null))
        reopened.dequeue(a.id)
        assertEquals(listOf("iki"), FileOfflineQueue(tmp.root).all().map { it.content })
    }
}
