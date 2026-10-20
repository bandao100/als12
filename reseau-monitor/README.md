# Surveillance réseau (Android)

Application Android qui surveille en continu le Wi-Fi domestique : elle analyse le sous-réseau local à intervalles réguliers, garde la liste des appareils vus et envoie une notification dès qu'un appareil inconnu apparaît.

## Fonctionnement

- Au premier scan, les appareils présents sont enregistrés comme connus. Ils ne déclenchent pas d'alerte, et l'écran ne les marque donc pas comme à vérifier. Si un appareil indésirable était déjà connecté à ce moment-là, il faut le marquer à la main.
- Ensuite, chaque appareil inconnu déclenche une notification « nouvel appareil détecté ».
- Touchez un appareil dans la liste pour basculer entre « Connu » et « À vérifier ».
- Le scan tourne dans un service de premier plan, avec une notification permanente. Il s'arrête lorsque vous appuyez sur « Arrêter la surveillance ».

## Limites connues

- **Détection par TCP.** Android n'autorise pas le ping ICMP sans droits root. Un hôte est détecté s'il accepte une connexion ou la refuse sur l'un des ports 80, 443, 22, 53 ou 8080. Un appareil qui ne répond sur aucun de ces ports n'apparaît pas.
- **Identification.** L'adresse MAC est lue dans `/proc/net/arp`, ce qui peut être refusé selon la version d'Android. Sans MAC, l'appareil est identifié par son IP : un renouvellement DHCP peut alors provoquer une fausse alerte.
- **Mise en veille.** Android peut retarder les scans lorsque le téléphone est inactif. Désactivez l'optimisation de batterie pour cette application si les scans doivent être réguliers.
- **Wi-Fi uniquement.** Sans connexion Wi-Fi active, aucun scan n'est effectué.
- **Non testé sur appareil.** Le code de la logique (calcul du sous-réseau, fusion des scans, lecture de la table ARP) est couvert par des tests unitaires. L'interface et le service n'ont pas encore été exécutés sur un téléphone.

## Compiler l'application

Prérequis : JDK 17 ou plus récent, Android SDK avec la plateforme API 34.

```bash
./gradlew assembleDebug
```

L'APK est généré dans `app/build/outputs/apk/debug/app-debug.apk`. Vous pouvez aussi ouvrir le dossier `reseau-monitor` dans Android Studio.

Tests unitaires :

```bash
./gradlew testDebugUnitTest
```

## Structure

- `app/src/main/java/com/example/reseaumonitor/`
  - `NetworkMath.kt` : calcul des adresses du sous-réseau et lecture de la table ARP
  - `Devices.kt` : modèle d'appareil et fusion des scans
  - `LanScanner.kt` : détection des hôtes par connexion TCP
  - `DeviceStore.kt` : sauvegarde dans SharedPreferences
  - `MonitorService.kt` : service de premier plan, scans périodiques et alertes
  - `MainActivity.kt`, `DeviceAdapter.kt` : interface
- `app/src/test/` : tests unitaires de la logique pure
