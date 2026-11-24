package com.tyler.kocamind.data.auth

data class AuthUser(
    val uid: String,
    val email: String?,
    val displayName: String?,
    val emailVerified: Boolean,
    val photoUrl: String? = null,
)
