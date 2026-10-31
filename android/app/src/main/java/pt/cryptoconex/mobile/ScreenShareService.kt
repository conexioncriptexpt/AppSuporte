package pt.cryptoconex.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat

/** Foreground service that owns the MediaProjection while a session is active. Always shows a notification with TERMINAR. */
class ScreenShareService : Service() {
    private var wake: PowerManager.WakeLock? = null
    private var wifi: WifiManager.WifiLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            Assist.end(true)
            stopSelf()
            return START_NOT_STICKY
        }
        val n = notification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else {
            startForeground(1, n)
        }
        acquireLocks()
        @Suppress("DEPRECATION")
        val data: Intent? = if (Build.VERSION.SDK_INT >= 33) intent?.getParcelableExtra("data", Intent::class.java) else intent?.getParcelableExtra("data")
        if (data == null) { stopSelf(); return START_NOT_STICKY }
        Assist.start(this, data)
        return START_NOT_STICKY
    }

    private fun notification(): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Assistência ativa", NotificationManager.IMPORTANCE_LOW))
        }
        val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), flags)
        val stop = PendingIntent.getService(this, 1, Intent(this, ScreenShareService::class.java).setAction(ACTION_STOP), flags)
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle("Assistência remota ativa")
            .setContentText("O técnico está a ver o teu ecrã. Toca em TERMINAR para parar.")
            .setOngoing(true)
            .setContentIntent(open)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "TERMINAR", stop)
            .build()
    }

    private fun acquireLocks() {
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "conex:session").apply { setReferenceCounted(false); acquire(4 * 60 * 60 * 1000L) }
        val wm = applicationContext.getSystemService(WIFI_SERVICE) as WifiManager
        @Suppress("DEPRECATION")
        val mode = if (Build.VERSION.SDK_INT >= 29) WifiManager.WIFI_MODE_FULL_LOW_LATENCY else WifiManager.WIFI_MODE_FULL_HIGH_PERF
        wifi = wm.createWifiLock(mode, "conex:wifi").apply { setReferenceCounted(false); acquire() }
    }

    override fun onDestroy() {
        wake?.let { if (it.isHeld) it.release() }
        wifi?.let { if (it.isHeld) it.release() }
        super.onDestroy()
    }

    companion object {
        const val CHANNEL = "assist"
        const val ACTION_STOP = "pt.cryptoconex.STOP"
    }
}
