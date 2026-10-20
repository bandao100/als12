package com.example.reseaumonitor

import java.io.IOException
import java.net.ConnectException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket

/**
 * Détection d'hôtes par connexion TCP.
 *
 * Android ne permet pas d'envoyer de ping ICMP sans droits root. Un hôte est considéré présent
 * si une connexion aboutit, ou si elle est refusée : il répond alors par un refus. Un hôte qui
 * ne répond sur aucun de ces ports (pare-feu strict, appareil en veille) n'est pas détecté.
 */
object LanScanner {
    private val PORTS = intArrayOf(80, 443, 22, 53, 8080)

    /** Bloquant : à appeler hors du thread principal. */
    fun isAlive(ip: String, timeoutMs: Int = 400): Boolean {
        for (port in PORTS) {
            try {
                Socket().use { it.connect(InetSocketAddress(ip, port), timeoutMs) }
                return true
            } catch (refused: ConnectException) {
                return true
            } catch (timeoutOrUnreachable: IOException) {
                continue
            }
        }
        return false
    }

    /** Nom court de l'hôte par résolution DNS inverse, ou vide. Bloquant. */
    fun hostnameOf(ip: String): String =
        shortHostname(runCatching { InetAddress.getByName(ip).canonicalHostName }.getOrNull(), ip)
}
