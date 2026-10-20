# Surveillance réseau (Android)

Application Android qui surveille en continu le Wi-Fi domestique. Elle analyse le sous-réseau local à intervalles réguliers, garde la liste des appareils vus et envoie une notification dès qu'un appareil inconnu apparaît.

## Installer l'APK

L'APK est compilé par GitHub Actions à chaque modification du dossier `reseau-monitor/`.

1. Sur GitHub, ouvrez l'onglet **Actions** du dépôt, puis la dernière exécution réussie du workflow **APK Android**.
2. Dans la section **Artifacts**, téléchargez `surveillance-reseau-apk`. C'est un fichier zip qui contient `surveillance-reseau.apk`.
3. Sur le téléphone, ouvrez le zip, puis l'APK. Android demande d'autoriser l'installation d'applications depuis cette source : acceptez pour l'application qui ouvre le fichier (Fichiers, Chrome…).
4. Au premier lancement, touchez **Démarrer** et acceptez les notifications.

Toutes les compilations sont signées avec la même clé de débogage : une nouvelle version s'installe par-dessus l'ancienne sans perdre la liste des appareils.

## Fonctionnement

- **Scan périodique** dans un service de premier plan, avec une notification permanente qui affiche le résultat du dernier scan. L'intervalle se règle entre 2 et 30 minutes ; **Scanner maintenant** lance un scan immédiat.
- **Relance automatique** après un redémarrage du téléphone ou une mise à jour de l'application, si la surveillance était active.
- **Premier scan = référence** : les appareils présents sont enregistrés comme connus, sans alerte. Si un appareil indésirable était déjà connecté à ce moment-là, il faut le marquer à la main comme « À vérifier ».
- **Alertes** : chaque appareil inconnu déclenche une notification ; la toucher ouvre l'application.
- **Liste des appareils** : nom, adresse IP, adresse MAC si elle est lisible, état en ligne ou hors ligne. Les appareils à vérifier apparaissent en premier.
- **Actions** : touchez un appareil pour le renommer, le marquer comme connu ou à vérifier, ou l'oublier.
- **Noms automatiques** : le nom d'hôte est obtenu par résolution DNS inverse auprès de la box, quand elle le fournit.

## Limites connues

- **Détection par TCP.** Android n'autorise pas le ping ICMP sans droits root. Un hôte est détecté s'il accepte ou refuse une connexion sur l'un des ports 80, 443, 22, 53 ou 8080. Un appareil qui ne répond sur aucun de ces ports n'apparaît pas.
- **Identification.** L'adresse MAC est lue dans `/proc/net/arp`, ce qui peut être refusé selon la version d'Android. Sans MAC, l'appareil est identifié par son IP : un renouvellement DHCP peut alors provoquer une fausse alerte.
- **Mise en veille.** Android peut retarder les scans quand le téléphone est inactif. L'application propose d'ouvrir le réglage d'optimisation de la batterie pour l'en exempter.
- **Wi-Fi uniquement.** Sans connexion Wi-Fi active, aucun scan n'est effectué et l'écran l'indique.

## Compiler soi-même

Prérequis : JDK 17 ou plus récent, Android SDK avec la plateforme API 34.

```bash
./gradlew assembleDebug        # APK dans app/build/outputs/apk/debug/
./gradlew testDebugUnitTest    # tests unitaires
```

Vous pouvez aussi ouvrir le dossier `reseau-monitor` dans Android Studio.

## Structure

- `app/src/main/java/com/example/reseaumonitor/`
  - `NetworkMath.kt` : adresses du sous-réseau, table ARP, noms d'hôte
  - `Devices.kt` : modèle d'appareil, fusion des scans, tri d'affichage
  - `LanScanner.kt` : détection des hôtes par TCP et résolution DNS inverse
  - `DeviceStore.kt`, `MonitorPrefs.kt` : sauvegarde des appareils, des réglages et de l'état du scan
  - `MonitorService.kt` : service de premier plan, scans périodiques et alertes
  - `BootReceiver.kt` : relance après redémarrage
  - `MainActivity.kt`, `DeviceAdapter.kt` : interface
- `app/src/test/` : tests unitaires de la logique pure
- `app/debug.keystore` : clé de débogage partagée (mot de passe `android`), à ne pas utiliser pour une publication
