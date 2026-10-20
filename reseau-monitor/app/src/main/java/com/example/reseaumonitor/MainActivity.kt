package com.example.reseaumonitor

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {
    private lateinit var store: DeviceStore
    private lateinit var deviceAdapter: DeviceAdapter
    private lateinit var statusText: TextView
    private lateinit var toggleButton: Button
    private lateinit var emptyText: TextView

    private val notificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { MonitorService.start(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        store = DeviceStore(this)
        statusText = findViewById(R.id.statusText)
        toggleButton = findViewById(R.id.toggleButton)
        emptyText = findViewById(R.id.emptyText)

        deviceAdapter = DeviceAdapter(onClick = ::toggleTrust)
        findViewById<RecyclerView>(R.id.deviceList).apply {
            layoutManager = LinearLayoutManager(this@MainActivity)
            adapter = deviceAdapter
        }

        toggleButton.setOnClickListener {
            when {
                MonitorService.running -> MonitorService.stop(this)
                needsNotificationPermission() -> notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                else -> MonitorService.start(this)
            }
            refresh()
        }

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                while (true) {
                    refresh()
                    delay(REFRESH_INTERVAL_MS)
                }
            }
        }
    }

    private fun needsNotificationPermission(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED

    private fun toggleTrust(device: Device) {
        store.update { devices ->
            devices + (device.id to device.copy(trusted = !device.trusted))
        }
        refresh()
    }

    private fun refresh() {
        val devices = store.load().values
            .sortedWith(compareBy<Device> { it.trusted }.thenByDescending { it.lastSeen })

        deviceAdapter.submitList(devices)
        emptyText.visibility = if (devices.isEmpty()) View.VISIBLE else View.GONE

        statusText.setText(if (MonitorService.running) R.string.status_on else R.string.status_off)
        toggleButton.setText(if (MonitorService.running) R.string.stop else R.string.start)
    }

    private companion object {
        const val REFRESH_INTERVAL_MS = 2_000L
    }
}
