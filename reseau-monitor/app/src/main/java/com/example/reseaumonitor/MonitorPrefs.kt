package com.example.reseaumonitor

import android.content.Context
import android.text.format.DateFormat
import java.util.Date

enum class ScanState { IDLE, SCANNING, NO_WIFI, DONE }

/** Réglages et état du dernier scan, partagés entre le service et l'interface. */
class MonitorPrefs(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /** Surveillance demandée par l'utilisateur : elle est relancée au redémarrage du téléphone. */
    var enabled: Boolean
        get() = prefs.getBoolean(KEY_ENABLED, false)
        set(value) = prefs.edit().putBoolean(KEY_ENABLED, value).apply()

    var intervalMinutes: Int
        get() = prefs.getInt(KEY_INTERVAL, DEFAULT_INTERVAL_MINUTES)
        set(value) = prefs.edit().putInt(KEY_INTERVAL, value).apply()

    var scanState: ScanState
        get() = prefs.getString(KEY_STATE, null)
            ?.let { name -> ScanState.entries.firstOrNull { it.name == name } }
            ?: ScanState.IDLE
        set(value) = prefs.edit().putString(KEY_STATE, value.name).apply()

    var lastScanAt: Long
        get() = prefs.getLong(KEY_LAST_SCAN_AT, 0L)
        set(value) = prefs.edit().putLong(KEY_LAST_SCAN_AT, value).apply()

    var onlineCount: Int
        get() = prefs.getInt(KEY_ONLINE_COUNT, 0)
        set(value) = prefs.edit().putInt(KEY_ONLINE_COUNT, value).apply()

    companion object {
        val INTERVAL_CHOICES = listOf(2, 5, 15, 30)
        const val DEFAULT_INTERVAL_MINUTES = 5

        private const val PREFS_NAME = "monitor"
        private const val KEY_ENABLED = "enabled"
        private const val KEY_INTERVAL = "interval_minutes"
        private const val KEY_STATE = "scan_state"
        private const val KEY_LAST_SCAN_AT = "last_scan_at"
        private const val KEY_ONLINE_COUNT = "online_count"
    }
}

/** Résumé du dernier scan, affiché dans l'application et dans la notification permanente. */
fun Context.scanSummary(prefs: MonitorPrefs, running: Boolean): String {
    val state = prefs.scanState
    return when {
        running && state == ScanState.SCANNING -> getString(R.string.state_scanning)
        running && state == ScanState.NO_WIFI -> getString(R.string.state_no_wifi)
        prefs.lastScanAt > 0 -> getString(
            R.string.state_last_scan,
            DateFormat.getTimeFormat(this).format(Date(prefs.lastScanAt)),
            resources.getQuantityString(R.plurals.online_devices, prefs.onlineCount, prefs.onlineCount),
        )
        else -> getString(R.string.state_idle)
    }
}
