# Sentinelle

Détecteur de poche pour smartphone : **radars routiers**, **caméras cachées**, **traceurs Bluetooth**, **réseaux Wi-Fi de caméras**, **champs magnétiques** et **ultrasons**. Sans compte, sans publicité, utilisable hors ligne.

Deux façons de l'utiliser :

- **Application Android (APK)**, recommandée sur Samsung Galaxy S25 Ultra et tout Android 8 ou plus récent : tous les capteurs du téléphone, sans réglage caché.
- **Application web (PWA)**, sur Android et iPhone : rien à installer, mais le navigateur limite l'accès à certains capteurs.

## Les quatre détecteurs

| Module | Ce qu'il détecte | Méthode |
| --- | --- | --- |
| **Radars** | Radars fixes, feux rouges, tronçons, radars mobiles signalés, caméras de vidéosurveillance | GPS + positions OpenStreetMap (Overpass) + vos signalements. Alerte vocale anticipée selon la vitesse, cône « devant moi », alerte de survitesse. |
| **Caméras** | Objectifs de caméras cachées, LED infrarouges de vision nocturne | Analyse d'image en direct (≈ 20 im/s) : points petits, compacts et très contrastés, suivis image par image. *Contrôle flash* : la lampe est coupée un instant, un reflet d'objectif disparaît, une LED reste. |
| **Champs** | Électronique alimentée, aimants, transformateurs | Magnétomètre, écart au champ terrestre en µT, calibrage, jauge logarithmique, crépitement façon compteur Geiger. |
| **Ondes** | Appareils Bluetooth, traceurs AirTag / SmartTag / Tile / Google Localiser, caméras BLE, points d'accès Wi-Fi de caméras, ultrasons 15–24 kHz | Annonces BLE (identifiants constructeurs et services), RSSI filtré (Kalman) et mode pistage « chaud / froid » ; réseaux Wi-Fi classés par nom typique de caméra et fabricant du matériel (Hikvision, Dahua, puces Espressif…) ; spectrogramme du micro et tonalités persistantes. |

L'accueil propose aussi un **protocole d'inspection de chambre** en 8 étapes et un tableau de ce qu'un téléphone peut, ou ne peut pas, détecter.

## Ce qu'un téléphone ne peut pas faire

- **Capter les ondes radar** : les cinémomètres émettent en bande K / Ka (24 à 35 GHz), qu'aucune antenne de smartphone ne reçoit. Sentinelle se fonde donc sur la position connue des radars.
- **Scanner le Wi-Fi depuis une page web** : les navigateurs ne l'autorisent pas, d'où l'application Android. Même avec elle, seules les caméras qui diffusent leur propre réseau apparaissent ; une caméra branchée sur la box de l'hôte reste invisible.
- **Repérer un micro GSM / 4G** : il faut un détecteur RF dédié.

## Cadre légal

En France (décret n° 2012-3 du 3 janvier 2012) et dans plusieurs pays, les détecteurs de radars sont interdits ; les aides à la conduite doivent annoncer des **zones de danger** sans localiser précisément les radars. Le réglage *Mode zones de danger* masque les positions exactes et annonce des zones d'au moins 2 km. Vérifiez la loi du pays où vous conduisez.

## Compatibilité

| Fonction | Application Android | Chrome Android | Safari iPhone |
| --- | --- | --- | --- |
| Radars (GPS, voix) | Oui, voix du téléphone en mode guidage | Oui | Oui |
| Cap au repos | Capteur de rotation fusionné | Boussole du navigateur | Boussole du navigateur |
| Caméra, reflet et infrarouge | Oui | Oui, flash piloté | Oui, sans pilotage du flash |
| Magnétomètre | Oui, avec alerte d'étalonnage | Après activation de `chrome://flags/#enable-generic-sensor-extra-classes` | Non |
| Scan Bluetooth complet | Oui | Après activation de `chrome://flags/#enable-experimental-web-platform-features` | Non |
| Analyse Wi-Fi | Oui | Non | Non |
| Ultrasons | Oui | Oui | Oui |

Les capteurs exigent une page servie en **HTTPS**. Un **mode démonstration** (Réglages) remplace tous les capteurs par des données simulées, clairement signalées.

## Application Android (Samsung Galaxy S25 Ultra)

### Installer l'APK

1. Sur le téléphone, ouvrez <https://github.com/bandao100/als12/releases/download/android/sentinelle.apk> (ou la page *Releases* du dépôt, version « Sentinelle pour Android »).
2. Ouvrez le fichier téléchargé. One UI demande d'autoriser l'installation depuis cette source (*Internet* ou *Mes fichiers*) : acceptez, revenez, puis touchez **Installer**.
3. Si Play Protect affiche un avertissement (application hors Play Store), choisissez *Plus de détails › Installer quand même*.
4. Au premier usage de chaque détecteur, Android demande l'autorisation correspondante.

L'APK est recompilé et republié à chaque fusion sur `master` (workflow `.github/workflows/android.yml`) ; chaque demande de fusion produit aussi un APK de test dans les *artefacts* du workflow.

### Capteurs utilisés

| Détecteur | Capteur du téléphone | Autorisation Android |
| --- | --- | --- |
| Radars | GNSS (GPS, Galileo, GLONASS, BeiDou), capteur de rotation pour le cap à l'arrêt, synthèse vocale | Position |
| Caméras | Caméra arrière et flash, caméra avant pour l'infrarouge | Appareil photo |
| Champs | Magnétomètre (µT), état d'étalonnage | Aucune |
| Bluetooth | Bluetooth 5 basse consommation, annonces étendues comprises | Appareils à proximité, position précise |
| Wi-Fi | Analyse Wi-Fi 2,4 / 5 / 6 GHz | Appareils à proximité, position précise (la localisation doit être activée) |
| Ultrasons | Micro, 48 kHz | Micro |

L'écran reste allumé pendant la surveillance radar et les alertes vocales baissent le volume de la musique. Les capteurs sont coupés dès que l'application passe en arrière-plan.

### Signature des mises à jour

Sans clé fournie, l'APK est signé avec une clé de débogage propre à chaque compilation : pour installer une nouvelle version, désinstallez d'abord l'ancienne (les réglages et signalements sont alors perdus). Pour des mises à jour directes, créez une clé une fois pour toutes :

```bash
keytool -genkeypair -v -keystore sentinelle.keystore -alias sentinelle -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 sentinelle.keystore
```

puis ajoutez dans *Settings › Secrets and variables › Actions* : `ANDROID_KEYSTORE_BASE64` (la sortie de `base64`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`sentinelle`) et `ANDROID_KEY_PASSWORD`. Gardez le fichier `sentinelle.keystore` en lieu sûr, hors du dépôt.

### Compiler soi-même

```bash
cd android
./gradlew assembleRelease   # nécessite le SDK Android (ANDROID_HOME) et Java 17
```

L'application web est copiée automatiquement dans l'APK ; elle y est servie sous `https://appassets.androidplatform.net/` pour que caméra, micro et position restent accessibles.

## Application web

### En ligne, avec GitHub Pages

1. Dans le dépôt GitHub : *Settings › Pages › Build and deployment › Source* : **GitHub Actions**.
2. Chaque fusion sur `master` publie l'application (workflow `.github/workflows/pages.yml`).
3. Ouvrez l'adresse obtenue sur le téléphone, puis *Ajouter à l'écran d'accueil*.

N'importe quel hébergement statique en HTTPS convient aussi : il n'y a aucune étape de compilation.

### En local

```bash
npm start      # serveur sur http://localhost:8080
npm test       # tests unitaires des algorithmes
npm run check  # syntaxe des modules et liste du cache hors ligne
```

Aucune dépendance n'est requise (Node 20 ou plus). `npm run icons` régénère les icônes PNG à partir de `assets/icon.svg` (nécessite Playwright).

## Organisation du code

```
index.html, manifest.webmanifest, sw.js   coquille de l'application, installation, hors ligne
css/app.css                              thème « planche de bord », sombre et clair
js/app.js                                navigation, thème, mode démo
js/core/                                 algorithmes purs, testés sous Node
  geo.js          distances, caps, projection locale
  radar-logic.js  requête Overpass, normalisation OSM, cône d'alerte, suivi des annonces
  glint.js        détection des reflets, suivi temporel, regroupement, contrôle flash
  ble.js          identification des appareils BLE, distance estimée, filtre RSSI
  spectrum.js     tonalités ultrasonores dans un spectre FFT
  emf.js          magnétomètre : référence, écart, niveaux
js/services/radar-service.js             GPS, cache des radars, alertes vocales
js/screens/                              un module par écran
  wifi.js         réseaux Wi-Fi : noms de caméras, fabricants, bande et canal
  native.js       pont vers l'application Android
js/sim/demo.js                           sources simulées du mode démo
tests/                                   tests node:test
android/                                 application Android (Java, sans dépendance)
  app/src/main/java/…/MainActivity.java  WebView, autorisations, barres système
  NativeBridge.java                      pont JavaScript ↔ capteurs
  SensorHub.java, BleScanner.java,       magnétomètre et boussole, Bluetooth,
  WifiScanner.java, Speaker.java         Wi-Fi, voix
```

## Confidentialité

Images, sons et mesures sont analysés sur l'appareil et ne sont jamais enregistrés ni transmis. Seule la position est envoyée au service Overpass d'OpenStreetMap pour télécharger les radars dans un rayon de 8 km ; les résultats sont mis en cache pour la conduite hors ligne. Données cartographiques © contributeurs OpenStreetMap, licence ODbL.

## Pistes d'évolution

- Surveillance radar écran éteint (service de premier plan Android).
- Analyse RF réelle avec une clé RTL-SDR branchée en USB-C (WebUSB), pour repérer micros GSM et émetteurs.
- Partage communautaire des radars mobiles signalés.
