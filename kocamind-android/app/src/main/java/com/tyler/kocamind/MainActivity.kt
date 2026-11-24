package com.tyler.kocamind

import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Bundle
import androidx.core.content.IntentCompat
import com.tyler.kocamind.data.chat.parseShare
import androidx.activity.ComponentActivity
import android.view.WindowManager
import androidx.activity.compose.setContent
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import com.tyler.kocamind.data.backend.parseConnectorReturn
import com.tyler.kocamind.ui.nav.KocaMindAppShell
import com.tyler.kocamind.ui.theme.ThemeHost
import com.tyler.kocamind.ui.theme.applyWindowTheme
import com.tyler.kocamind.ui.theme.resolveDark

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        val prefs = (application as KocaMindApp).container.themePrefs
        // İlk kareden önce kayıtlı tercihe göre pencere zemini ve çubuk simgeleri; beyaz/koyu parlama olmaz.
        val systemDark = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        applyWindowTheme(resolveDark(prefs.mode.value, systemDark))
        super.onCreate(savedInstanceState)
        installSplashExit()
        if (savedInstanceState == null) {
            handleLink(intent)
            // Son uygulamalardan yeniden açılınca eski paylaşım niyeti tekrar gelir; ikinci kez eklenmesin.
            if (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY == 0) handleShare(intent)
        }
        setContent {
            val appPrefs = (application as KocaMindApp).container.appPrefs
            // Ayarlar > Gizlilik: ekran görüntüsü ve son uygulamalar önizlemesi engellenir.
            val secure by appPrefs.blockScreenshots.collectAsState()
            LaunchedEffect(secure) {
                if (secure) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE) else window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
            }
            ThemeHost(prefs, appPrefs) { KocaMindAppShell() }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleLink(intent)
        handleShare(intent)
    }

    /** Başka uygulamadan "Paylaş > KocaMind": metin, fotoğraf ya da belge sohbetin mesaj kutusuna düşer. */
    private fun handleShare(intent: Intent?) {
        intent ?: return
        val stream = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)
        parseShare(
            action = intent.action,
            type = intent.type,
            text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString(),
            streamUri = stream?.toString(),
            ownAuthority = "$packageName.files",
        )?.let { (application as KocaMindApp).container.sharedContent.value = it }
    }

    /** `kocamind://baglantilar?durum=...`: Ayarlar > Bağlantılar açılır ve sonuç orada gösterilir. */
    private fun handleLink(intent: Intent?) {
        val uri = intent?.takeIf { it.action == Intent.ACTION_VIEW }?.data ?: return
        val query = uri.queryParameterNames.associateWith { uri.getQueryParameter(it) }
        parseConnectorReturn(uri.scheme, uri.host, query)?.let { (application as KocaMindApp).container.connectorReturn.value = it }
    }
}
