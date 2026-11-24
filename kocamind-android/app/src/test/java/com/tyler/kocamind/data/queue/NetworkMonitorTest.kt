package com.tyler.kocamind.data.queue

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadows.ShadowNetwork
import org.robolectric.shadows.ShadowNetworkCapabilities

@RunWith(AndroidJUnit4::class)
class NetworkMonitorTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val cm = context.getSystemService(ConnectivityManager::class.java)

    private fun caps(validated: Boolean): NetworkCapabilities = ShadowNetworkCapabilities.newInstance().also {
        shadowOf(it).addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        if (validated) shadowOf(it).addCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }

    /** Ağ geçişinde (hotspot → LTE) bildirim gelirken sistemin "aktif ağ" bilgisi henüz güncellenmemiş olabilir. */
    @Test
    fun followsDefaultNetworkCallback_evenWhenActiveNetworkLags() {
        shadowOf(cm).setActiveNetworkInfo(null)
        val monitor = NetworkMonitor(context)
        assertFalse(monitor.isOnline.value)

        val lte = ShadowNetwork.newInstance(133)
        shadowOf(cm).networkCallbacks.forEach { it.onCapabilitiesChanged(lte, caps(validated = true)) }
        assertTrue(monitor.isOnline.value)

        shadowOf(cm).networkCallbacks.forEach { it.onLost(lte) }
        assertFalse(monitor.isOnline.value)
    }
}
