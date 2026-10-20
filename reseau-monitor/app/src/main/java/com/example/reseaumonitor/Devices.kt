package com.example.reseaumonitor

/**
 * Appareil du réseau local.
 *
 * [id] est l'adresse MAC lorsqu'elle est lisible, sinon l'adresse IP. Sans MAC, un appareil
 * qui change d'adresse après un renouvellement DHCP apparaît comme un nouvel appareil.
 * [trusted] vaut true lorsque l'utilisateur a confirmé que l'appareil est le sien.
 */
data class Device(
    val id: String,
    val ip: String,
    val firstSeen: Long,
    val lastSeen: Long,
    val trusted: Boolean,
) {
    fun toLine(): String = listOf(id, ip, firstSeen, lastSeen, trusted).joinToString(SEPARATOR)

    companion object {
        private const val SEPARATOR = "|"

        fun fromLine(line: String): Device? {
            val parts = line.split(SEPARATOR)
            if (parts.size != 5) return null

            return Device(
                id = parts[0],
                ip = parts[1],
                firstSeen = parts[2].toLongOrNull() ?: return null,
                lastSeen = parts[3].toLongOrNull() ?: return null,
                trusted = parts[4].toBooleanStrictOrNull() ?: return null,
            )
        }
    }
}

data class ScanResult(
    val devices: Map<String, Device>,
    val newDevices: List<Device>,
)

/**
 * Fusionne les appareils vus lors d'un scan ([seen] : id -> ip) avec ceux déjà connus.
 *
 * Au premier scan, la banque est vide : les appareils présents forment la référence, sont
 * marqués comme connus et ne déclenchent aucune alerte. Un appareil présent à ce moment-là
 * n'est donc pas vérifié. Ensuite, tout appareil inconnu est signalé comme nouveau.
 */
fun mergeScan(known: Map<String, Device>, seen: Map<String, String>, now: Long): ScanResult {
    val isBaseline = known.isEmpty()
    val devices = known.toMutableMap()
    val newDevices = mutableListOf<Device>()

    for ((id, ip) in seen) {
        val previous = known[id]
        if (previous != null) {
            devices[id] = previous.copy(ip = ip, lastSeen = now)
        } else {
            val device = Device(id, ip, firstSeen = now, lastSeen = now, trusted = isBaseline)
            devices[id] = device
            if (!isBaseline) newDevices += device
        }
    }

    return ScanResult(devices, newDevices)
}
