package com.example.reseaumonitor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DevicesTest {

    private fun baseline(vararg hosts: Pair<String, String>): Map<String, Device> =
        mergeScan(emptyMap(), hosts.associate { (id, ip) -> id to SeenHost(ip) }, now = 100L).devices

    @Test
    fun mergeScan_firstScan_isBaseline_noAlerts_andDevicesAreTrusted() {
        val result = mergeScan(
            known = emptyMap(),
            seen = mapOf("aa:01" to SeenHost("192.168.1.10"), "aa:02" to SeenHost("192.168.1.11")),
            now = 100L,
        )

        assertTrue(result.newDevices.isEmpty())
        assertEquals(2, result.devices.size)
        assertTrue(result.devices.values.all { it.trusted })
    }

    @Test
    fun mergeScan_unknownDevice_isReportedAsNew_andUntrusted() {
        val known = baseline("aa:01" to "192.168.1.10")

        val result = mergeScan(
            known,
            mapOf("aa:01" to SeenHost("192.168.1.10"), "bb:02" to SeenHost("192.168.1.99", "tablette")),
            now = 200L,
        )

        val newDevice = result.newDevices.single()
        assertEquals("bb:02", newDevice.id)
        assertFalse(newDevice.trusted)
        assertEquals("tablette", newDevice.hostname)
        assertEquals(200L, result.devices.getValue("bb:02").firstSeen)
    }

    @Test
    fun mergeScan_knownDevice_updatesIpAndLastSeen_butKeepsFirstSeenAndName() {
        val known = baseline("aa:01" to "192.168.1.10")
            .mapValues { (_, device) -> device.copy(name = "Télé du salon") }

        val result = mergeScan(known, mapOf("aa:01" to SeenHost("192.168.1.25")), now = 300L)

        val device = result.devices.getValue("aa:01")
        assertEquals("192.168.1.25", device.ip)
        assertEquals(300L, device.lastSeen)
        assertEquals(100L, device.firstSeen)
        assertEquals("Télé du salon", device.name)
        assertTrue(result.newDevices.isEmpty())
    }

    @Test
    fun mergeScan_keepsPreviousHostname_whenResolutionFails() {
        val known = mergeScan(emptyMap(), mapOf("aa:01" to SeenHost("192.168.1.10", "imprimante")), now = 100L).devices

        val result = mergeScan(known, mapOf("aa:01" to SeenHost("192.168.1.10", "")), now = 200L)

        assertEquals("imprimante", result.devices.getValue("aa:01").hostname)
    }

    @Test
    fun mergeScan_absentDevice_keepsItsLastSeen() {
        val known = baseline("aa:01" to "192.168.1.10", "aa:02" to "192.168.1.11")

        val result = mergeScan(known, mapOf("aa:01" to SeenHost("192.168.1.10")), now = 400L)

        assertEquals(100L, result.devices.getValue("aa:02").lastSeen)
    }

    @Test
    fun displayName_prefersUserName_thenHostname_thenId() {
        val device = Device("aa:01", "192.168.1.10", 0L, 0L, trusted = true)

        assertEquals("aa:01", device.displayName)
        assertEquals("routeur", device.copy(hostname = "routeur").displayName)
        assertEquals("Box", device.copy(hostname = "routeur", name = "Box").displayName)
    }

    @Test
    fun device_roundTripsThroughStorageLine_evenWithSeparatorsInName() {
        val device = Device(
            id = "aa:01",
            ip = "192.168.1.10",
            firstSeen = 100L,
            lastSeen = 200L,
            trusted = true,
            name = "Bureau | étage\\2\nfond",
            hostname = "pc-bureau",
        )

        val line = device.toLine()

        assertFalse(line.contains('\n'))
        assertEquals(device, Device.fromLine(line))
    }

    @Test
    fun device_fromMalformedLine_isNull() {
        assertNull(Device.fromLine(""))
        assertNull(Device.fromLine("aa:01|192.168.1.10|x|200|true||"))
        assertNull(Device.fromLine("aa:01|192.168.1.10|100|200|true"))
    }

    @Test
    fun isOnline_onlyForDevicesSeenAtLastScan() {
        val device = Device("aa:01", "192.168.1.10", firstSeen = 100L, lastSeen = 500L, trusted = true)

        assertTrue(device.isOnline(lastScanAt = 500L))
        assertFalse(device.isOnline(lastScanAt = 600L))
        assertFalse(device.copy(lastSeen = 0L).isOnline(lastScanAt = 0L))
    }

    @Test
    fun sortForDisplay_unknownFirst_thenOnline_thenByName() {
        val lastScanAt = 500L
        val unknown = Device("u", "192.168.1.5", 0L, lastScanAt, trusted = false, name = "zeta")
        val onlineB = Device("b", "192.168.1.6", 0L, lastScanAt, trusted = true, name = "beta")
        val onlineA = Device("a", "192.168.1.7", 0L, lastScanAt, trusted = true, name = "Alpha")
        val offline = Device("o", "192.168.1.8", 0L, 100L, trusted = true, name = "aaa")

        val sorted = sortForDisplay(listOf(offline, onlineB, unknown, onlineA), lastScanAt)

        assertEquals(listOf("u", "a", "b", "o"), sorted.map { it.id })
    }
}
