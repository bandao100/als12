package com.example.reseaumonitor

/** Adresse IPv4 sous forme de nombre sur 32 bits, ou null si la chaîne n'est pas valide. */
fun parseIpv4(address: String): Long? {
    val parts = address.split('.')
    if (parts.size != 4) return null

    var value = 0L
    for (part in parts) {
        val octet = part.toIntOrNull()?.takeIf { it in 0..255 } ?: return null
        value = (value shl 8) or octet.toLong()
    }
    return value
}

fun formatIpv4(value: Long): String =
    listOf(24, 16, 8, 0).joinToString(".") { shift -> ((value shr shift) and 0xFF).toString() }

/**
 * Adresses candidates du sous-réseau contenant [address], hors adresse réseau et de diffusion.
 *
 * Le préfixe est borné entre /24 et /30 : un réseau plus large n'est pas scanné en entier,
 * seul le /24 qui contient l'adresse locale l'est.
 */
fun hostsInSubnet(address: String, prefixLength: Int): List<String> {
    val ip = parseIpv4(address) ?: return emptyList()
    val prefix = prefixLength.coerceIn(24, 30)
    val mask = (0xFFFFFFFFL shl (32 - prefix)) and 0xFFFFFFFFL
    val network = ip and mask
    val broadcast = network or (mask.inv() and 0xFFFFFFFFL)

    return (network + 1 until broadcast).map(::formatIpv4)
}

/**
 * Table ARP (`/proc/net/arp`) : associe chaque adresse IP à son adresse MAC.
 * Seules les entrées complètes sont retenues.
 */
fun parseArpTable(lines: List<String>): Map<String, String> {
    val incompleteMac = "00:00:00:00:00:00"
    val completeFlag = 0x2

    return lines
        .drop(1) // ligne d'en-tête
        .mapNotNull { line ->
            val columns = line.trim().split(Regex("\\s+"))
            if (columns.size < 4) return@mapNotNull null

            val flags = columns[2].removePrefix("0x").toIntOrNull(16) ?: return@mapNotNull null
            val mac = columns[3].lowercase()
            if (flags and completeFlag == 0 || mac == incompleteMac) return@mapNotNull null

            columns[0] to mac
        }
        .toMap()
}
