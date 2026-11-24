package com.tyler.kocamind.data.auth

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class WelcomeEmailTest {
    private class MemoryStore : WelcomeEmail.Store {
        val done = mutableSetOf<String>()
        override fun isDone(uid: String) = uid in done
        override fun markDone(uid: String) { done += uid }
    }

    @Test
    fun sendsOncePerUser_retriesAfterFailure() = runTest {
        val store = MemoryStore()
        var calls = 0
        var succeed = false
        val welcome = WelcomeEmail(store) { calls++; succeed }

        welcome.onVerifiedSignIn("u1")
        assertEquals(1, calls)
        succeed = true
        welcome.onVerifiedSignIn("u1")
        welcome.onVerifiedSignIn("u1")
        assertEquals(2, calls)
        welcome.onVerifiedSignIn("u2")
        assertEquals(3, calls)
        assertEquals(setOf("u1", "u2"), store.done)
    }
}
