package com.tyler.kocamind.data.settings

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.tyler.kocamind.MainActivity
import com.tyler.kocamind.R

/** Ayarlar > Bildirimler: uygulama arka plandayken biten yanıt için bildirim. */
object ReplyNotifier {
    private const val CHANNEL = "replies"
    private const val ID = 4201

    /** Android 13 ve sonrasında izin gerekir; öncesinde her zaman true. */
    fun hasPermission(context: Context): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    /** Yanıtın ilk satırlarını gösterir; dokununca uygulama açılır. İzin yoksa sessizce geçer. */
    fun notify(context: Context, text: String) {
        if (!hasPermission(context)) return
        val manager = context.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(CHANNEL) == null) {
            manager.createNotificationChannel(NotificationChannel(CHANNEL, "Yanıtlar", NotificationManager.IMPORTANCE_DEFAULT))
        }
        val open = PendingIntent.getActivity(
            context, 0,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val preview = text.replace(Regex("[*_#`>]"), "").trim().take(200)
        val notification = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_launcher_mark_mono)
            .setContentTitle("KocaMind yanıtladı")
            .setContentText(preview)
            .setStyle(NotificationCompat.BigTextStyle().bigText(preview))
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        // Android 13+ bildirim izni kullanıcı tarafından reddedilmiş olabilir; o zaman sessizce geçilir.
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        try {
            NotificationManagerCompat.from(context).notify(ID, notification)
        } catch (e: SecurityException) {
            // İzin tam bu sırada geri alındı.
        }
    }
}
