package com.tyler.kocamind

import android.app.Activity
import android.os.Build
import android.view.animation.PathInterpolator

/**
 * Android 12+ açılış ekranından uygulamaya yumuşak geçiş: dönen noktalar hafifçe büyüyüp kaybolur,
 * zemin solar ve altındaki ekran ortaya çıkar. Sistemin animasyon hızı ayarına uyar (kapalıysa anında geçer).
 */
fun Activity.installSplashExit() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
    splashScreen.setOnExitAnimationListener { splash ->
        val ease = PathInterpolator(0.2f, 0f, 0f, 1f)
        splash.iconView?.animate()
            ?.scaleX(1.25f)?.scaleY(1.25f)?.alpha(0f)
            ?.setDuration(320)?.setInterpolator(ease)
            ?.start()
        splash.animate()
            .alpha(0f)
            .setStartDelay(80)
            .setDuration(360)
            .setInterpolator(ease)
            .withEndAction { splash.remove() }
            .start()
    }
}
