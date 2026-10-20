package com.example.reseaumonitor

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.View
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.Spinner
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.isVisible
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.color.DynamicColors
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {
    private lateinit var store: DeviceStore
    private lateinit var prefs: MonitorPrefs
    private lateinit var deviceAdapter: DeviceAdapter
    private lateinit var statusText: TextView
    private lateinit var summaryText: TextView
    private lateinit var toggleButton: Button
    private lateinit var scanNowButton: Button
    private lateinit var batteryCard: View
    private lateinit var devicesHeader: TextView
    private lateinit var emptyText: TextView

    private val notificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { startMonitoring() }

    override fun onCreate(savedInstanceState: Bundle?) {
        DynamicColors.applyToActivityIfAvailable(this)
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        store = DeviceStore(this)
        prefs = MonitorPrefs(this)
        statusText = findViewById(R.id.statusText)
        summaryText = findViewById(R.id.summaryText)
        toggleButton = findViewById(R.id.toggleButton)
        scanNowButton = findViewById(R.id.scanNowButton)
        batteryCard = findViewById(R.id.batteryCard)
        devicesHeader = findViewById(R.id.devicesHeader)
        emptyText = findViewById(R.id.emptyText)

        deviceAdapter = DeviceAdapter(onClick = ::showDeviceActions)
        findViewById<RecyclerView>(R.id.deviceList).apply {
            layoutManager = LinearLayoutManager(this@MainActivity)
            adapter = deviceAdapter
        }

        toggleButton.setOnClickListener {
            when {
                MonitorService.running -> stopMonitoring()
                needsNotificationPermission() -> notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                else -> startMonitoring()
            }
            refresh()
        }
        scanNowButton.setOnClickListener {
            MonitorService.scanNow(this)
            refresh()
        }
        findViewById<Button>(R.id.batteryButton).setOnClickListener { requestBatteryExemption() }
        setUpIntervalSpinner(findViewById(R.id.intervalSpinner))

        // Reprend la surveillance si elle était active, par exemple après une mise à jour.
        if (prefs.enabled && !MonitorService.running) MonitorService.start(this)

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                while (true) {
                    refresh()
                    delay(REFRESH_INTERVAL_MS)
                }
            }
        }
    }

    private fun startMonitoring() {
        prefs.enabled = true
        MonitorService.start(this)
    }

    private fun stopMonitoring() {
        prefs.enabled = false
        MonitorService.stop(this)
    }

    private fun needsNotificationPermission(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED

    private fun setUpIntervalSpinner(spinner: Spinner) {
        val choices = MonitorPrefs.INTERVAL_CHOICES
        spinner.adapter = ArrayAdapter(
            this,
            android.R.layout.simple_spinner_item,
            choices.map { getString(R.string.interval_minutes, it) },
        ).also { it.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item) }
        spinner.setSelection(choices.indexOf(prefs.intervalMinutes).coerceAtLeast(0), false)

        spinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                val minutes = choices[position]
                if (minutes == prefs.intervalMinutes) return

                prefs.intervalMinutes = minutes
                // Le scan immédiat relance l'attente avec le nouvel intervalle.
                if (MonitorService.running) MonitorService.scanNow(this@MainActivity)
            }

            override fun onNothingSelected(parent: AdapterView<*>?) = Unit
        }
    }

    private fun isIgnoringBatteryOptimizations(): Boolean =
        getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(packageName)

    private fun requestBatteryExemption() {
        val request = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))
        try {
            startActivity(request)
        } catch (unsupported: ActivityNotFoundException) {
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
    }

    private fun showDeviceActions(device: Device) {
        val trustAction = getString(if (device.trusted) R.string.action_mark_unknown else R.string.action_mark_trusted)
        val actions = arrayOf(getString(R.string.action_rename), trustAction, getString(R.string.action_forget))

        MaterialAlertDialogBuilder(this)
            .setTitle(device.displayName)
            .setItems(actions) { _, which ->
                when (which) {
                    0 -> showRenameDialog(device)
                    1 -> updateDevice(device.id) { it.copy(trusted = !it.trusted) }
                    2 -> confirmForget(device)
                }
            }
            .show()
    }

    private fun showRenameDialog(device: Device) {
        val input = EditText(this).apply {
            setText(device.name)
            hint = device.hostname.ifBlank { device.id }
            setSingleLine()
            setSelection(text.length)
        }
        val padding = (20 * resources.displayMetrics.density).toInt()
        val container = FrameLayout(this).apply {
            setPadding(padding, padding / 2, padding, 0)
            addView(input)
        }

        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.rename_title)
            .setView(container)
            .setPositiveButton(R.string.save) { _, _ ->
                updateDevice(device.id) { it.copy(name = input.text.toString().trim()) }
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun confirmForget(device: Device) {
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.forget_title)
            .setMessage(getString(R.string.forget_message, device.displayName))
            .setPositiveButton(R.string.forget) { _, _ ->
                store.update { devices -> devices - device.id }
                refresh()
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun updateDevice(id: String, change: (Device) -> Device) {
        store.update { devices ->
            val device = devices[id] ?: return@update devices
            devices + (id to change(device))
        }
        refresh()
    }

    private fun refresh() {
        val running = MonitorService.running
        val lastScanAt = prefs.lastScanAt
        val rows = sortForDisplay(store.load().values, lastScanAt)
            .map { DeviceRow(it, online = it.isOnline(lastScanAt)) }

        deviceAdapter.submitList(rows)
        devicesHeader.text = getString(R.string.devices_header, rows.size)
        emptyText.isVisible = rows.isEmpty()

        statusText.setText(if (running) R.string.status_on else R.string.status_off)
        summaryText.text = scanSummary(prefs, running)
        toggleButton.setText(if (running) R.string.stop else R.string.start)
        scanNowButton.isEnabled = running
        batteryCard.isVisible = !isIgnoringBatteryOptimizations()
    }

    private companion object {
        const val REFRESH_INTERVAL_MS = 2_000L
    }
}
