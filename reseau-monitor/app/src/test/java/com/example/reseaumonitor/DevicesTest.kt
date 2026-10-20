package com.example.reseaumonitor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DevicesTest {

    @Test
    fun mergeScan_firstScan_isBaseline_noAlerts_andDevicesAreTrusted() {
        val result = mergeScan(
            known = emptyMap(),
            seen = mapOf("aa:01" to "192.168.1.10", "aa:02" to "192.168.1.11"),
            now = 100L,
        )

        assertTrue(result.newDevices.isEmpty())
        assertEquals(2, result.devices.size)
        assertTrue(result.devices.values.all { it.trusted })
    }

    @Test
    fun mergeScan_unknownDevice_isReportedAsNew_andUntrusted() {
        val known = mergeScan(emptyMap(), mapOf("aa:01" to "192.168.1.10"), now = 100L).devices

        val result = mergeScan(known, mapOf("aa:01" to "192.168.1.10", "bb:02" to "192.168.1.99"), now = 200L)

        assertEquals(1, result.newDevices.size)
        assertEquals("bb:02", result.newDevices.single().id)
        assertEquals(false, result.newDevices.single().trusted)
        assertEquals(200L, result.devices.getValue("bb:02").firstSeen)
    }

    @Test
    fun mergeScan_knownDevice_updatesIpAndLastSeen_butKeepsFirstSeen() {
        val known = mergeScan(emptyMap(), mapOf("aa:01" to "192.168.1.10"), now = 100L).devices

        val result = mergeScan(known, mapOf("aa:01" to "192.168.1.25"), now = 300L)

        val device = result.devices.getValue("aa:01")
        assertEquals("192.168.1.25", device.ip)
        assertEquals(300L, device.lastSeen)
        assertEquals(100L, device.firstSeen)
        assertTrue(result.newDevices.isEmpty())
    }

    @Test
    fun mergeScan_absentDevice_keepsItsLastSeen() {
        val known = mergeScan(
            emptyMap(),
            mapOf("aa:01" to "192.168.1.10", "aa:02" to "192.168.1.11"),
            now = 100L,
        ).devices

        val result = mergeScan(known, mapOf("aa:01" to "192.168.1.10"), now = 400L)

        assertEquals(100L, result.devices.getValue("aa:02").lastSeen)
    }

    @Test
    fun device_roundTripsThroughStorageLine() {
        val device = Device("aa:01", "192.168.1.10", firstSeen = 100L, lastSeen = 200L, trusted = true)

        assertEquals(device, Device.fromLine(device.toLine()))
    }

    @Test
    fun device_fromMalformedLine_isNull() {
        assertNull(Device.fromLine(""))
        assertNull(Device.fromLine("aa:01|192.168.1.10|x|200|true"))
    }
}
