package com.example.reseaumonitor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NetworkMathTest {

    @Test
    fun parseIpv4_acceptsValidAddress() {
        assertEquals(0xC0A8012AL, parseIpv4("192.168.1.42"))
    }

    @Test
    fun parseIpv4_rejectsMalformedAddress() {
        assertNull(parseIpv4("192.168.1"))
        assertNull(parseIpv4("256.1.1.1"))
        assertNull(parseIpv4("a.b.c.d"))
    }

    @Test
    fun formatIpv4_isInverseOfParse() {
        assertEquals("10.0.0.255", formatIpv4(parseIpv4("10.0.0.255")!!))
    }

    @Test
    fun hostsInSubnet_slash24_excludesNetworkAndBroadcast() {
        val hosts = hostsInSubnet("192.168.1.42", 24)

        assertEquals(254, hosts.size)
        assertEquals("192.168.1.1", hosts.first())
        assertEquals("192.168.1.254", hosts.last())
        assertTrue("192.168.1.0" !in hosts)
        assertTrue("192.168.1.255" !in hosts)
    }

    @Test
    fun hostsInSubnet_widerPrefix_scansOnlyTheSlash24ContainingTheAddress() {
        assertEquals(hostsInSubnet("192.168.1.42", 24), hostsInSubnet("192.168.1.42", 16))
    }

    @Test
    fun hostsInSubnet_slash30_returnsTheTwoUsableHosts() {
        assertEquals(listOf("10.0.0.5", "10.0.0.6"), hostsInSubnet("10.0.0.5", 30))
    }

    @Test
    fun hostsInSubnet_invalidAddress_returnsEmpty() {
        assertTrue(hostsInSubnet("pas une adresse", 24).isEmpty())
    }

    @Test
    fun parseArpTable_keepsOnlyCompleteEntries() {
        val lines = listOf(
            "IP address       HW type     Flags       HW address            Mask     Device",
            "192.168.1.1      0x1         0x2         AA:BB:CC:DD:EE:01     *        wlan0",
            "192.168.1.20     0x1         0x0         00:00:00:00:00:00     *        wlan0",
            "192.168.1.33     0x1         0x2         00:11:22:33:44:55     *        wlan0",
        )

        assertEquals(
            mapOf(
                "192.168.1.1" to "aa:bb:cc:dd:ee:01",
                "192.168.1.33" to "00:11:22:33:44:55",
            ),
            parseArpTable(lines),
        )
    }
}
