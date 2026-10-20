package com.example.reseaumonitor

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.io.File
import java.io.IOException
import java.net.Inet4Address

/**
 * Service de premier plan : scanne le Wi-Fi local à intervalles réguliers et signale
 * les appareils inconnus.
 */
class MonitorService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    // Réveille la boucle avant la fin de l'intervalle (scan immédiat, intervalle modifié).
    private val wake = Channel<Unit>(Channel.CONFLATED)
    private var monitorJob: Job? = null
    private lateinit var store: DeviceStore
    private lateinit var prefs: MonitorPrefs

    override fun onCreate() {
        super.onCreate()
        store = DeviceStore(this)
        prefs = MonitorPrefs(this)
        createChannels()
        running = true
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(
            SERVICE_NOTIFICATION_ID,
            buildServiceNotification(),
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
        )

        if (monitorJob?.isActive == true) {
            if (intent?.action == ACTION_SCAN_NOW) wake.trySend(Unit)
        } else {
            monitorJob = scope.launch {
                while (isActive) {
                    runScan()
                    withTimeoutOrNull(prefs.intervalMinutes * 60_000L) { wake.receive() }
                }
            }
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        running = false
        scope.cancel()
        if (prefs.scanState == ScanState.SCANNING) prefs.scanState = ScanState.IDLE
        super.onDestroy()
    }

    private suspend fun runScan() {
        val network = localWifiAddress()
        if (network == null) {
            prefs.scanState = ScanState.NO_WIFI
            updateServiceNotification()
            return
        }

        prefs.scanState = ScanState.SCANNING
        updateServiceNotification()

        val (localIp, prefix) = network
        val seen = scanSubnet(localIp, prefix)
        val now = System.currentTimeMillis()

        val newDevices = mutableListOf<Device>()
        store.update { known ->
            val result = mergeScan(known, seen, now)
            newDevices += result.newDevices
            result.devices
        }

        prefs.lastScanAt = now
        prefs.onlineCount = seen.size
        prefs.scanState = ScanState.DONE
        updateServiceNotification()

        if (newDevices.isNotEmpty()) notifyNewDevices(newDevices)
    }

    /** Adresse IPv4 et longueur de préfixe du Wi-Fi actif, ou null si le Wi-Fi n'est pas connecté. */
    private fun localWifiAddress(): Pair<String, Int>? {
        val connectivity = getSystemService(ConnectivityManager::class.java)
        val network = connectivity.activeNetwork ?: return null
        val capabilities = connectivity.getNetworkCapabilities(network) ?: return null
        if (!capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return null

        val address = connectivity.getLinkProperties(network)?.linkAddresses
            ?.firstOrNull { it.address is Inet4Address } ?: return null
        val ip = address.address.hostAddress ?: return null
        return ip to address.prefixLength
    }

    /** Retourne id -> hôte pour chaque hôte qui répond sur le sous-réseau. */
    private suspend fun scanSubnet(localIp: String, prefix: Int): Map<String, SeenHost> {
        val hosts = hostsInSubnet(localIp, prefix).filter { it != localIp }

        val alive = coroutineScope {
            hosts
                .map { ip -> async(Dispatchers.IO) { ip.takeIf { LanScanner.isAlive(it) } } }
                .awaitAll()
                .filterNotNull()
        }

        val named = coroutineScope {
            alive
                .map { ip -> async(Dispatchers.IO) { SeenHost(ip, LanScanner.hostnameOf(ip)) } }
                .awaitAll()
        }

        val arp = withContext(Dispatchers.IO) { readArpTable() }
        return named.associateBy { host -> arp[host.ip] ?: host.ip }
    }

    /** Vide si le fichier n'est pas lisible : les appareils sont alors identifiés par leur IP. */
    private fun readArpTable(): Map<String, String> =
        try {
            parseArpTable(File("/proc/net/arp").readLines())
        } catch (unreadable: IOException) {
            emptyMap()
        }

    private fun notifyNewDevices(devices: List<Device>) {
        if (!canPostNotifications()) return

        val title = resources.getQuantityString(R.plurals.alert_title, devices.size, devices.size)
        val details = devices.joinToString("\n") { "${it.displayName} (${it.ip})" }
        val notification = NotificationCompat.Builder(this, CHANNEL_ALERTS)
            .setSmallIcon(R.drawable.ic_stat_network)
            .setContentTitle(title)
            .setContentText(details)
            .setStyle(NotificationCompat.BigTextStyle().bigText(details))
            .setContentIntent(openAppIntent())
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .build()

        NotificationManagerCompat.from(this).notify(System.currentTimeMillis().toInt(), notification)
    }

    private fun updateServiceNotification() {
        if (!canPostNotifications()) return
        NotificationManagerCompat.from(this).notify(SERVICE_NOTIFICATION_ID, buildServiceNotification())
    }

    private fun canPostNotifications(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun openAppIntent(): PendingIntent =
        PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    private fun createChannels() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_SERVICE, getString(R.string.channel_service), NotificationManager.IMPORTANCE_LOW),
        )
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ALERTS, getString(R.string.channel_alerts), NotificationManager.IMPORTANCE_HIGH),
        )
    }

    private fun buildServiceNotification(): Notification =
        NotificationCompat.Builder(this, CHANNEL_SERVICE)
            .setSmallIcon(R.drawable.ic_stat_network)
            .setContentTitle(getString(R.string.service_title))
            .setContentText(scanSummary(prefs, running = true))
            .setContentIntent(openAppIntent())
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()

    companion object {
        /** Vrai tant que le service est lancé. */
        @Volatile
        var running = false
            private set

        private const val ACTION_SCAN_NOW = "com.example.reseaumonitor.SCAN_NOW"
        private const val CHANNEL_SERVICE = "surveillance"
        private const val CHANNEL_ALERTS = "alertes"
        private const val SERVICE_NOTIFICATION_ID = 1

        fun start(context: Context) {
            ContextCompat.startForegroundService(context, Intent(context, MonitorService::class.java))
        }

        /** Lance un scan tout de suite ; démarre le service s'il ne tourne pas. */
        fun scanNow(context: Context) {
            ContextCompat.startForegroundService(
                context,
                Intent(context, MonitorService::class.java).setAction(ACTION_SCAN_NOW),
            )
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, MonitorService::class.java))
        }
    }
}
