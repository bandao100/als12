# Sentinelle

Détecteur de poche pour smartphone : **radars routiers**, **caméras cachées**, **traceurs Bluetooth**, **champs magnétiques** et **ultrasons**. Application web progressive (PWA) installable sur Android et iPhone, sans compte, sans publicité, utilisable hors ligne.

## Les quatre détecteurs

| Module | Ce qu'il détecte | Méthode |
| --- | --- | --- |
| **Radars** | Radars fixes, feux rouges, tronçons, radars mobiles signalés, caméras de vidéosurveillance | GPS + positions OpenStreetMap (Overpass) + vos signalements. Alerte vocale anticipée selon la vitesse, cône « devant moi », alerte de survitesse. |
| **Caméras** | Objectifs de caméras cachées, LED infrarouges de vision nocturne | Analyse d'image en direct (≈ 20 im/s) : points petits, compacts et très contrastés, suivis image par image. *Contrôle flash* : la lampe est coupée un instant, un reflet d'objectif disparaît, une LED reste. |
| **Champs** | Électronique alimentée, aimants, transformateurs | Magnétomètre, écart au champ terrestre en µT, calibrage, jauge logarithmique, crépitement façon compteur Geiger. |
| **Ondes** | Appareils Bluetooth, traceurs AirTag / SmartTag / Tile / Google Localiser, caméras BLE, ultrasons 15–24 kHz | Annonces BLE (identifiants constructeurs et services), RSSI filtré (Kalman) et mode pistage « chaud / froid » ; spectrogramme du micro et détection de tonalités persistantes. |

L'accueil propose aussi un **protocole d'inspection de chambre** en 8 étapes et un tableau de ce qu'un téléphone peut, ou ne peut pas, détecter.

## Ce qu'un téléphone ne peut pas faire

- **Capter les ondes radar** : les cinémomètres émettent en bande K / Ka (24 à 35 GHz), qu'aucune antenne de smartphone ne reçoit. Sentinelle se fonde donc sur la position connue des radars.
- **Scanner le Wi-Fi depuis une page web** : les navigateurs ne l'autorisent pas. La liste des réseaux reste consultable dans les réglages du téléphone (noms suspects : `IPC`, `CAM`, `HD-`, `YI`, `Tapo`, `EZVIZ`, `Hikvision`).
- **Repérer un micro GSM / 4G** : il faut un détecteur RF dédié.

## Cadre légal

En France (décret n° 2012-3 du 3 janvier 2012) et dans plusieurs pays, les détecteurs de radars sont interdits ; les aides à la conduite doivent annoncer des **zones de danger** sans localiser précisément les radars. Le réglage *Mode zones de danger* masque les positions exactes et annonce des zones d'au moins 2 km. Vérifiez la loi du pays où vous conduisez.

## Compatibilité

| Fonction | Chrome Android | Safari iPhone |
| --- | --- | --- |
| Radars (GPS, voix) | Oui | Oui |
| Caméra, reflet et infrarouge | Oui, flash piloté | Oui, sans pilotage du flash |
| Magnétomètre | Après activation de `chrome://flags/#enable-generic-sensor-extra-classes` | Non |
| Scan Bluetooth complet | Après activation de `chrome://flags/#enable-experimental-web-platform-features` | Non |
| Ultrasons | Oui | Oui |

Les capteurs exigent une page servie en **HTTPS**. Un **mode démonstration** (Réglages) remplace tous les capteurs par des données simulées, clairement signalées.

## Installation

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
js/sim/demo.js                           sources simulées du mode démo
tests/                                   tests node:test
```

## Confidentialité

Images, sons et mesures sont analysés sur l'appareil et ne sont jamais enregistrés ni transmis. Seule la position est envoyée au service Overpass d'OpenStreetMap pour télécharger les radars dans un rayon de 8 km ; les résultats sont mis en cache pour la conduite hors ligne. Données cartographiques © contributeurs OpenStreetMap, licence ODbL.

## Pistes d'évolution

- Version native (Capacitor) pour le scan Wi-Fi et un magnétomètre accessible sans réglage.
- Analyse RF réelle avec une clé RTL-SDR branchée en USB-C (WebUSB), pour repérer micros GSM et émetteurs.
- Partage communautaire des radars mobiles signalés.
