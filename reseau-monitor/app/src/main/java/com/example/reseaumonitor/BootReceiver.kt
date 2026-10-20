package com.example.reseaumonitor

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Relance la surveillance après un redémarrage du téléphone ou une mise à jour de l'application. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_MY_PACKAGE_REPLACED) return

        if (MonitorPrefs(context).enabled) MonitorService.start(context)
    }
}
