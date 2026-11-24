package com.tyler.kocamind.data.queue

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * İnternet durumu. Eski uygulama 5 sn'de bir ping atıyordu; burada sistemin "doğrulanmış internet"
 * bilgisi dinlenir (pil dostu, anında).
 */
class NetworkMonitor(context: Context) {
    private val cm = context.getSystemService(ConnectivityManager::class.java)
    private val online = MutableStateFlow(currentlyOnline())
    val isOnline: StateFlow<Boolean> = online

    init {
        // Varsayılan ağ dinlenir ve bildirimdeki yetenekler kullanılır: ağ geçişinde (hotspot → LTE)
        // cm.activeNetwork henüz güncellenmemiş olabilir, ona bakmak "internet yok"ta takılı bırakıyordu.
        runCatching {
            cm?.registerDefaultNetworkCallback(
                object : ConnectivityManager.NetworkCallback() {
                    override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                        online.value = isValidatedInternet(caps)
                    }

                    override fun onLost(network: Network) {
                        online.value = false
                    }
                },
            )
        }
    }

    private fun currentlyOnline(): Boolean =
        cm?.getNetworkCapabilities(cm.activeNetwork)?.let(::isValidatedInternet) ?: false

    private fun isValidatedInternet(caps: NetworkCapabilities): Boolean =
        caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
}
