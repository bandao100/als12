package com.example.reseaumonitor

import android.content.Context

/** Banque des appareils, enregistrée dans SharedPreferences. */
class DeviceStore(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    @Synchronized
    fun load(): Map<String, Device> =
        prefs.getString(KEY_DEVICES, "").orEmpty()
            .lineSequence()
            .mapNotNull { Device.fromLine(it) }
            .associateBy { it.id }

    /**
     * Lit puis écrit la banque d'un seul bloc, pour qu'un scan et une action de l'utilisateur
     * ne s'écrasent pas mutuellement.
     */
    @Synchronized
    fun update(transform: (Map<String, Device>) -> Map<String, Device>) {
        val updated = transform(load())
        prefs.edit()
            .putString(KEY_DEVICES, updated.values.joinToString("\n") { it.toLine() })
            .apply()
    }

    private companion object {
        const val PREFS_NAME = "devices"
        const val KEY_DEVICES = "devices"
    }
}
