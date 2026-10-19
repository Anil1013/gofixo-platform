package com.gofixo.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.IBinder
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.NotificationCompat
import com.gofixo.R
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Handles data-only booking pushes so cancellation events can stop the alert even
 * when Android would otherwise display a system-owned notification.
 */
class GofixoMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val type = message.data["type"] ?: return
        val bookingId = message.data["booking_id"] ?: return
        if (type == "booking_cancelled") {
            GofixoBookingAlertService.stop(this, bookingId)
        } else if (type == "booking_request") {
            val title = message.data["title"] ?: "Gofixo — New service request"
            val body = message.data["body"] ?: "A nearby request is available."
            GofixoBookingAlertService.start(this, bookingId, title, body)
        }
    }
}

class GofixoBookingAlertService : Service() {
    private var player: MediaPlayer? = null
    private var vibrator: Vibrator? = null
    private var bookingId: String = ""

    override fun onCreate() {
        super.onCreate()
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                val target = intent.getStringExtra(EXTRA_BOOKING_ID).orEmpty()
                if (bookingId.isEmpty() || target.isEmpty() || target == bookingId) stopSelf()
                return START_NOT_STICKY
            }
            ACTION_START -> {
                bookingId = intent.getStringExtra(EXTRA_BOOKING_ID).orEmpty()
                if (bookingId.isEmpty()) {
                    stopSelf()
                    return START_NOT_STICKY
                }
                val title = intent.getStringExtra(EXTRA_TITLE) ?: "Gofixo — New service request"
                val body = intent.getStringExtra(EXTRA_BODY) ?: "A nearby request is available."
                startForeground(NOTIFICATION_ID, buildNotification(title, body))
                startRepeatingAlert()
                // Safety cap: an alert cannot ring forever if the device loses connectivity.
                android.os.Handler(mainLooper).postDelayed({ stopSelf() }, MAX_ALERT_MS)
            }
        }
        return START_NOT_STICKY
    }

    private fun startRepeatingAlert() {
        stopRepeatingAlert()
        try {
            val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            player = MediaPlayer().apply {
                setDataSource(this@GofixoBookingAlertService, uri)
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                isLooping = true
                prepare()
                start()
            }
        } catch (_: Exception) {
            player?.release()
            player = null
        }
        vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            getSystemService(VibratorManager::class.java)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }
        val pattern = longArrayOf(0, 700, 350, 700, 900)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator?.vibrate(VibrationEffect.createWaveform(pattern, 0))
            } else {
                @Suppress("DEPRECATION")
                vibrator?.vibrate(pattern, 0)
            }
        } catch (_: Exception) {
            // Vibration is best-effort on devices without a vibrator.
        }
    }

    private fun stopRepeatingAlert() {
        try { player?.stop() } catch (_: Exception) {}
        player?.release()
        player = null
        try { vibrator?.cancel() } catch (_: Exception) {}
        vibrator = null
    }

    private fun buildNotification(title: String, body: String): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setAutoCancel(false)
            .build()

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID, "Incoming booking alerts", NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Repeating sound and vibration for pending partner requests"
                setSound(null, null)
                enableVibration(false)
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    override fun onDestroy() {
        stopRepeatingAlert()
        getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val CHANNEL_ID = "gofixo_repeating_booking_alert"
        private const val NOTIFICATION_ID = 73104
        private const val MAX_ALERT_MS = 120_000L
        private const val ACTION_START = "com.gofixo.app.BOOKING_ALERT_START"
        private const val ACTION_STOP = "com.gofixo.app.BOOKING_ALERT_STOP"
        private const val EXTRA_BOOKING_ID = "booking_id"
        private const val EXTRA_TITLE = "title"
        private const val EXTRA_BODY = "body"

        fun start(context: Context, bookingId: String, title: String, body: String) {
            val intent = Intent(context, GofixoBookingAlertService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_BOOKING_ID, bookingId)
                putExtra(EXTRA_TITLE, title)
                putExtra(EXTRA_BODY, body)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context, bookingId: String? = null) {
            val intent = Intent(context, GofixoBookingAlertService::class.java).apply {
                action = ACTION_STOP
                putExtra(EXTRA_BOOKING_ID, bookingId)
            }
            context.startService(intent)
        }
    }
}
