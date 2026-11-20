# Ticket Secure Pro — V3.1

Plateforme de billetterie en ligne et de contrôle d'accès par QR code à usage unique, pour plusieurs sociétés organisatrices sur une même installation. La billetterie s'intègre en deux lignes à n'importe quel site ou application web.

## Documentation

| Document | Pour qui |
|---|---|
| [Guide de l'organisateur](docs/01-guide-organisateur.md) | Sociétés qui vendent des billets |
| [Guide du contrôleur](docs/02-guide-controleur.md) | Personnes qui contrôlent à l'entrée |
| [Intégrer la billetterie à votre site](docs/03-guide-integration-site-web.md) | Responsables de site ou d'application web |
| [Installation et mise en production](docs/04-guide-installation-production.md) | Responsable technique |
| [Référence de l'API publique](docs/05-reference-api.md) | Développeurs |

Les mêmes guides, illustrés, existent en PDF dans `docs/pdf/`. Des exemples d'intégration (HTML, React, Vue) sont dans `exemples/`.

## Nouveautés de la V3.1 : billetterie publique et intégration

| Fonction | Ce qui est livré |
|---|---|
| **Place de marché** | Page d'accueil de la plateforme avec les événements de tous les organisateurs : affiches, recherche, filtres par genre et par ville, événements « à la une » choisis par la plateforme. |
| **Affiches et genres** | Chaque événement a une affiche (ré-encodée et nettoyée à l'envoi) et un genre (concert, festival, sport, théâtre…). |
| **Widget intégrable** | `<tsp-billetterie>` : la billetterie complète dans votre propre page (catalogue, fiche, choix des billets, paiement, billets avec QR au retour), en deux lignes de code, isolée dans un Shadow DOM, sans cookie. |
| **Sites autorisés** | Chaque organisateur déclare les sites qui peuvent vendre ses billets (menu Intégration) ; le client n'est renvoyé après paiement que vers ces sites. |
| **API publique** | `/api/public/v1` : catalogue, fiche, commande, statut et billets, pour construire une interface sur mesure. |

## Fonctions de la V3

| Évolution | Ce qui est livré |
|---|---|
| **PostgreSQL** | Base de production PostgreSQL 16, migrations Alembic (`migrations/`), plusieurs événements par organisation, plusieurs contrôleurs par événement, verrouillage de ligne à la validation (testé avec 8 validations simultanées : une seule acceptée). |
| **Multi-organisateurs** | Chaque société s'inscrit et obtient un espace isolé : événements, billets, ventes, équipe, appareils et journal d'audit séparés. Console du super administrateur : suspension, commission par organisation, chiffre d'affaires global. |
| **Paiement en ligne** | Wave (API Checkout), Orange Money (API Web Payment) et cartes bancaires (Stripe Checkout). Notifications signées et vérifiées, contrôle du montant, traitement idempotent, vérification serveur à serveur. Mode « paiement simulé » pour les essais. |
| **Billetterie client** | Pages publiques par organisateur et par événement, catégories de billets (Standard, VIP…), quotas, réservation des places pendant le paiement, émission automatique des billets, e-mail avec PDF joint et page « Mes billets » sécurisée. |
| **Mode hors connexion** | Scanner web installable (PWA) qui valide sans réseau à partir d'un manifeste local, met les contrôles en file et les synchronise de façon sûre au retour du réseau, avec détection des conflits entre appareils. |
| **Application Android** | Application « Ticket Secure Scanner » (Kotlin) qui embarque ce scanner : fonctionne entièrement hors connexion, caméra arrière, écran toujours allumé, HTTPS obligatoire. APK compilé par GitHub Actions. |
| **Gestion des accès** | Rôles Administrateur, Superviseur et Contrôleur, affectation des contrôleurs à des événements et à des portes (catégories), désactivation, réinitialisation de mot de passe, mot de passe provisoire à changer. |
| **Sécurité renforcée** | HTTPS automatique (Caddy + Let's Encrypt), HSTS, protection CSRF, politique CSP stricte, limitation des tentatives de connexion, sauvegardes quotidiennes vérifiées avec script de restauration, journal d'audit chaîné et infalsifiable sans détection. |

## Rôles

| Action | Administrateur | Superviseur | Contrôleur |
|---|:-:|:-:|:-:|
| Créer, modifier, publier des événements et catégories | ✔ | ✔ | |
| Émettre, imprimer, annuler des billets | ✔ | ✔ | |
| Voir les ventes, renvoyer des billets, vérifier un paiement | ✔ | ✔ | |
| Créer et gérer les contrôleurs, les affecter aux événements | ✔ | ✔ | |
| Créer et gérer superviseurs et administrateurs | ✔ | | |
| Révoquer les appareils de contrôle | ✔ | ✔ | |
| Consulter le journal d'audit | ✔ | ✔ | |
| Paramètres de l'organisation | ✔ | | |
| Scanner les billets | tous les événements | tous les événements | **uniquement** ceux (et la porte) auxquels il est affecté |

Le **super administrateur** de la plateforme gère les organisations (suspension, commission) et consulte l'audit global ; il n'a pas accès aux opérations internes des organisateurs.

## Comment un billet est protégé

- Le QR contient `TSP3.<code>`, où le code est une signature HMAC-SHA256 calculée avec `TICKET_SECRET`. La base ne stocke que le « sel » et l'empreinte SHA-256 du code : une copie de la base seule ne permet ni de reconstituer ni de fabriquer un billet.
- À la validation, la ligne du billet est verrouillée (`SELECT … FOR UPDATE`) : deux contrôleurs simultanés ne peuvent pas faire entrer le même billet.
- Le client retrouve ses billets via un lien secret (envoyé par e-mail) ; connaître seulement le numéro de commande ne suffit pas.

## Le mode hors connexion : fonctionnement et garanties

1. **Préparation** (réseau disponible) : le téléphone télécharge le *manifeste* de l'événement : empreintes tronquées des billets, numéros, statuts. Ni les codes des QR, ni les noms des clients.
2. **Contrôle sans réseau** : le QR est haché sur le téléphone et comparé au manifeste. Billet connu et valide → entrée autorisée, billet marqué utilisé **sur ce téléphone**, contrôle mis en file.
3. **Synchronisation** (automatique toutes les 20 s dès que le réseau revient) : la file est envoyée au serveur, qui rejoue chaque contrôle sous verrou. Chaque contrôle a un identifiant unique : un renvoi est sans effet. Le téléphone récupère ensuite les billets utilisés sur les autres appareils.
4. **Conflits** : si un billet a été admis hors connexion alors qu'il avait déjà servi ailleurs, le contrôle est marqué « conflit », signalé sur la fiche de l'événement et dans le journal d'audit.

**Limite à connaître.** Deux téléphones *tous deux* hors connexion ne peuvent pas savoir instantanément ce que l'autre a validé : une copie d'un même QR présentée au même moment à deux portes déconnectées pourrait passer deux fois (le conflit sera détecté et tracé à la synchronisation). Pour l'empêcher totalement :

- **affectez chaque contrôleur à une catégorie (porte)** : le manifeste de son téléphone ne contient alors que les billets de sa porte, et un billet ne peut être admis hors ligne qu'à une seule porte ;
- ou désactivez le contrôle hors connexion pour un événement (case « Contrôle hors connexion autorisé ») : les téléphones valident alors uniquement en ligne.

## Installation

### Essai local sous Windows (SQLite, paiements simulés)

1. Installer Python 3.11 ou plus récent.
2. Double-cliquer `run_windows.bat`, puis ouvrir http://127.0.0.1:5000.
3. Cliquer sur « Espace organisateur » puis « Créer votre espace ».

Le scanner hors connexion est accessible depuis le menu Appareils, ou directement à http://127.0.0.1:5000/static/scanner/index.html (la caméra d'un téléphone exige HTTPS).

### Production (Docker, PostgreSQL, HTTPS)

Prérequis : un serveur Linux avec Docker, un nom de domaine dont l'enregistrement DNS pointe vers ce serveur, ports 80 et 443 ouverts.

```bash
cp .env.example .env
```

Remplir **toutes** les valeurs de `.env` (domaine, mots de passe et secrets aléatoires, clés de paiement, SMTP), puis :

```bash
docker compose up -d --build
```

Services lancés : `db` (PostgreSQL, non exposé), `web` (application), `caddy` (certificat HTTPS automatique, redirection HTTP→HTTPS), `worker` (expiration des réservations abandonnées, vérification de l'audit toutes les 10 min), `backup` (sauvegarde quotidienne).

En mode production, l'application **refuse de démarrer** si un secret manque, si la base n'est pas PostgreSQL, si HTTPS n'est pas configuré ou si le paiement simulé est actif.

Se connecter ensuite avec `PLATFORM_ADMIN_EMAIL` : le mot de passe devra être changé à la première connexion.

## Configurer les paiements

Les paiements sont encaissés sur les comptes marchands **de la plateforme**, qui reverse à chaque organisateur le net après commission (détail dans « Ventes » et dans l'export CSV). Un moyen de paiement n'apparaît aux clients que si ses clés sont renseignées.

| Moyen | Variables | URL de notification à déclarer chez l'opérateur |
|---|---|---|
| Wave | `WAVE_API_KEY`, `WAVE_WEBHOOK_SECRET` | `https://VOTRE-DOMAINE/webhooks/wave` |
| Orange Money | `ORANGE_CLIENT_ID`, `ORANGE_CLIENT_SECRET`, `ORANGE_MERCHANT_KEY`, `ORANGE_COUNTRY` | transmise automatiquement à chaque paiement |
| Carte bancaire (Stripe) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | `https://VOTRE-DOMAINE/webhooks/stripe` |

Règles appliquées à tous les moyens :

- le retour du client sur le site n'est **jamais** une preuve de paiement ;
- une commande ne devient « payée » qu'après une notification authentifiée (signature HMAC horodatée pour Wave et Stripe ; jeton secret **et** confirmation par l'API Orange pour Orange Money) ou une vérification directe auprès de l'opérateur ;
- le montant et la devise reçus doivent correspondre à la commande ;
- une même notification reçue deux fois n'émet pas de billets en double ;
- si une notification se perd, le bouton « Vérifier auprès du prestataire » (fiche commande) interroge l'opérateur.

**À vérifier avec chaque opérateur avant l'ouverture** : les intégrations suivent la documentation publique des API, et ont été testées ici avec des réponses simulées, pas avec de vrais comptes marchands. Faites un essai complet en bac à sable (`ORANGE_COUNTRY=dev`, clés de test Stripe, compte de test Wave) puis un premier vrai paiement de faible montant. Orange Money Web Payment n'est pas ouvert dans tous les pays et Stripe n'accepte pas les entreprises de tous les pays : vérifiez l'éligibilité de votre structure. Un autre agrégateur (CinetPay, PayDunya…) peut être ajouté sur le même modèle dans `ticketsecure/payments/`.

## Application Android

Le projet se trouve dans `android/`. L'interface est le scanner hors connexion (`ticketsecure/static/scanner/`), embarqué dans l'APK : une seule source pour le navigateur et l'application.

**Obtenir l'APK** : GitHub → onglet **Actions** → « Application Android (scanner) » → **Run workflow** (indiquer éventuellement l'adresse HTTPS du serveur, préremplie dans l'application) → télécharger l'artefact `ticket-secure-scanner-debug`. On peut aussi ouvrir le dossier `android/` dans Android Studio.

**Installer** : copier l'APK sur le téléphone (Android 8 ou plus récent), autoriser l'installation depuis cette source, ouvrir l'application, saisir l'adresse du serveur, l'e-mail et le mot de passe du contrôleur (le mot de passe provisoire doit avoir été changé sur le site), puis « Préparer hors connexion ».

Pour une diffusion large (Play Store ou MDM), signer l'APK de version : définir les secrets `ANDROID_KEYSTORE_FILE`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` et lancer `./gradlew assembleRelease`.

**Téléphone perdu** : menu Appareils → Révoquer. Désactiver un membre révoque aussi tous ses appareils.

## Sauvegardes et restauration

Le service `backup` crée chaque jour `backups/ticketsecure-AAAAMMJJ-HHMMSS.dump` (base de données) et `backups/media-AAAAMMJJ-HHMMSS.tar.gz` (affiches), vérifie la sauvegarde de la base, enregistre les empreintes SHA-256 et supprime les sauvegardes de plus de 14 jours. La restauration des affiches est décrite dans le guide d'installation. **Copiez régulièrement le dossier `backups/` hors du serveur** (autre machine, stockage externe) : une sauvegarde sur le même disque ne protège pas d'une panne de ce disque.

Restaurer (remplace les données actuelles) :

```bash
docker compose stop web worker
```

```bash
docker compose run --rm backup sh /scripts/restore.sh /backups/ticketsecure-AAAAMMJJ-HHMMSS.dump
```

```bash
docker compose start web worker
```

Faites un essai de restauration au moins une fois par trimestre.

## Journal d'audit

Connexions et échecs, création et modification d'événements, émissions et annulations de billets, exports, paiements confirmés ou rejetés, notifications à la signature invalide, appareils enregistrés et révoqués, conflits hors connexion, changements de rôle… Chaque entrée contient l'empreinte de la précédente : une modification ou suppression directe en base est détectée (console plateforme → Audit, ou `flask verify-audit`). Notez de temps en temps « l'empreinte de tête » affichée, hors de la plateforme, pour détecter aussi une suppression des toutes dernières entrées.

## Tests

```bash
pip install -r requirements-dev.txt
```

```bash
pytest -q
```

Avec PostgreSQL (active en plus le test de validation concurrente) :

```bash
TEST_DATABASE_URL=postgresql://utilisateur:motdepasse@localhost/ticketsecure_test pytest -q
```

Les tests couvrent : catalogue et API publique, commande depuis un site partenaire, origines refusées, affiches, rôles et isolation entre organisateurs, CSRF, limitation des connexions, usage unique et concurrence, affectations par porte, achat complet, réservation de capacité, notifications Wave/Stripe/Orange Money (signature, rejeu, montant), API des appareils, synchronisation idempotente et conflits, révocation, audit chaîné, neutralisation des formules dans les exports CSV. Ils tournent automatiquement sur GitHub Actions (SQLite et PostgreSQL), avec une vérification que les migrations correspondent aux modèles.

## Structure

```
ticketsecure/            application Flask
  models.py              modèle de données
  security.py            sessions, permissions, limitation de débit, audit chaîné
  tickets.py             émission et validation à usage unique
  orders.py              commandes, réservations, confirmation de paiement
  delivery.py            PDF, QR, e-mails
  payments/              Wave, Orange Money, Stripe, simulation
  media.py               affiches des événements
  blueprints/            auth, espace organisateur, équipe, plateforme, billetterie, webhooks,
                         API des appareils, API publique
  static/scanner/        scanner hors connexion (PWA), aussi embarqué dans l'application Android
  static/embed/          widget de billetterie intégrable
migrations/              migrations Alembic
android/                 application Android
scripts/                 sauvegarde et restauration
docs/                    guides (Markdown et PDF) et captures d'écran
exemples/                intégration HTML, React et Vue
tests/                   tests automatisés
```

## Avant l'ouverture au public

- Essais réels de chaque moyen de paiement (bac à sable puis petit montant réel).
- Faire relire les conditions d'utilisation et de vente (`/conditions`, gabarit `templates/shop/terms.html`) et la politique de données personnelles.
- Test de charge sur l'infrastructure visée, et répétition générale du contrôle (téléphones, portes, coupure réseau volontaire).
- Revue de sécurité indépendante.
- Supervision : alerte si `/health` ne répond plus, si une sauvegarde échoue ou si `flask verify-audit` signale une anomalie.
- Procédure d'incident (téléphone perdu, fuite de secret : changer `SECRET_KEY` déconnecte tout le monde ; changer `TICKET_SECRET` invalide **tous** les billets émis).
