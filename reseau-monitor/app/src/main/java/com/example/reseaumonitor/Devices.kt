package com.example.reseaumonitor

/**
 * Appareil du réseau local.
 *
 * [id] est l'adresse MAC lorsqu'elle est lisible, sinon l'adresse IP. Sans MAC, un appareil
 * qui change d'adresse après un renouvellement DHCP apparaît comme un nouvel appareil.
 * [trusted] vaut true lorsque l'utilisateur a confirmé que l'appareil est le sien.
 * [name] est le nom donné par l'utilisateur, [hostname] celui obtenu par DNS inverse.
 */
data class Device(
    val id: String,
    val ip: String,
    val firstSeen: Long,
    val lastSeen: Long,
    val trusted: Boolean,
    val name: String = "",
    val hostname: String = "",
) {
    val displayName: String
        get() = name.ifBlank { hostname.ifBlank { id } }

    fun toLine(): String =
        listOf(id, ip, firstSeen.toString(), lastSeen.toString(), trusted.toString(), name, hostname)
            .joinToString(SEPARATOR) { escape(it) }

    companion object {
        private const val SEPARATOR = "|"
        private const val FIELD_COUNT = 7

        fun fromLine(line: String): Device? {
            val parts = line.split(SEPARATOR).map { unescape(it) }
            if (parts.size != FIELD_COUNT) return null

            return Device(
                id = parts[0],
                ip = parts[1],
                firstSeen = parts[2].toLongOrNull() ?: return null,
                lastSeen = parts[3].toLongOrNull() ?: return null,
                trusted = parts[4].toBooleanStrictOrNull() ?: return null,
                name = parts[5],
                hostname = parts[6],
            )
        }

        // Une fois échappé, un champ ne contient plus ni « | » ni saut de ligne.
        private fun escape(value: String): String =
            value.replace("\\", "\\\\").replace("|", "\\p").replace("\n", "\\n")

        private fun unescape(value: String): String = buildString {
            var i = 0
            while (i < value.length) {
                val char = value[i]
                if (char == '\\' && i + 1 < value.length) {
                    when (val next = value[i + 1]) {
                        'p' -> append('|')
                        'n' -> append('\n')
                        else -> append(next)
                    }
                    i += 2
                } else {
                    append(char)
                    i += 1
                }
            }
        }
    }
}

/** Hôte qui a répondu lors d'un scan. [hostname] est vide si la résolution n'a rien donné. */
data class SeenHost(val ip: String, val hostname: String = "")

data class ScanResult(
    val devices: Map<String, Device>,
    val newDevices: List<Device>,
)

/**
 * Fusionne les hôtes vus lors d'un scan ([seen] : id -> hôte) avec les appareils déjà connus.
 *
 * Au premier scan, la banque est vide : les appareils présents forment la référence, sont
 * marqués comme connus et ne déclenchent aucune alerte. Un appareil présent à ce moment-là
 * n'est donc pas vérifié. Ensuite, tout appareil inconnu est signalé comme nouveau.
 */
fun mergeScan(known: Map<String, Device>, seen: Map<String, SeenHost>, now: Long): ScanResult {
    val isBaseline = known.isEmpty()
    val devices = known.toMutableMap()
    val newDevices = mutableListOf<Device>()

    for ((id, host) in seen) {
        val previous = known[id]
        if (previous != null) {
            devices[id] = previous.copy(
                ip = host.ip,
                lastSeen = now,
                hostname = host.hostname.ifBlank { previous.hostname },
            )
        } else {
            val device = Device(
                id = id,
                ip = host.ip,
                firstSeen = now,
                lastSeen = now,
                trusted = isBaseline,
                hostname = host.hostname,
            )
            devices[id] = device
            if (!isBaseline) newDevices += device
        }
    }

    return ScanResult(devices, newDevices)
}

/** Vrai si l'appareil a répondu au dernier scan, terminé à [lastScanAt]. */
fun Device.isOnline(lastScanAt: Long): Boolean = lastScanAt > 0 && lastSeen >= lastScanAt

/** Ordre d'affichage : appareils à vérifier d'abord, puis en ligne, puis par nom. */
fun sortForDisplay(devices: Collection<Device>, lastScanAt: Long): List<Device> =
    devices.sortedWith(
        compareBy<Device> { it.trusted }
            .thenBy { !it.isOnline(lastScanAt) }
            .thenBy(String.CASE_INSENSITIVE_ORDER) { it.displayName },
    )
