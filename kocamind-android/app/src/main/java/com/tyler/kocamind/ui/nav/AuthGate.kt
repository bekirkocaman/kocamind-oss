package com.tyler.kocamind.ui.nav

import androidx.compose.runtime.Composable
import com.tyler.kocamind.data.auth.AuthUser

/** Uygulama yalnızca e-postası doğrulanmış hesapla kullanılır; misafir ve doğrulanmamış hesap giriş ekranında kalır. */
fun requiresSignIn(user: AuthUser?): Boolean = user?.emailVerified != true

/** Giriş yoksa yalnızca [auth], varsa yalnızca [app] çizilir; oturum değişince kendiliğinden geçer. */
@Composable
fun AuthGate(user: AuthUser?, auth: @Composable () -> Unit, app: @Composable () -> Unit) {
    if (requiresSignIn(user)) auth() else app()
}
