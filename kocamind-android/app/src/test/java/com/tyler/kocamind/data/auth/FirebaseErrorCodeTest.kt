package com.tyler.kocamind.data.auth

import org.junit.Assert.assertEquals
import org.junit.Test

class FirebaseErrorCodeTest {
    @Test
    fun androidCodes_mapToJsSdkCodes() {
        assertEquals("auth/invalid-credential", firebaseErrorCodeToJs("ERROR_INVALID_CREDENTIAL"))
        assertEquals("auth/email-already-in-use", firebaseErrorCodeToJs("ERROR_EMAIL_ALREADY_IN_USE"))
        assertEquals("auth/user-not-found", firebaseErrorCodeToJs("ERROR_USER_NOT_FOUND"))
        assertEquals("auth/weak-password", firebaseErrorCodeToJs("ERROR_WEAK_PASSWORD"))
        assertEquals("auth/invalid-email", firebaseErrorCodeToJs("ERROR_INVALID_EMAIL"))
        assertEquals("auth/operation-not-allowed", firebaseErrorCodeToJs("ERROR_OPERATION_NOT_ALLOWED"))
        assertEquals("auth/wrong-password", firebaseErrorCodeToJs("ERROR_WRONG_PASSWORD"))
    }
}
