# Installation et mise en production

## Essai sur un ordinateur Windows (sans Internet public)

1. Installez Python 3.11 ou plus récent (cochez « Add Python to PATH »).
2. Décompressez le dossier, puis double-cliquez `run_windows.bat`.
3. Ouvrez http://127.0.0.1:5000 et créez un espace organisateur.

Les paiements y sont **simulés** (aucun argent n'est débité) et la base est un simple fichier SQLite. Ne vous en servez pas pour de vraies ventes.

## Mise en production

### Ce qu'il faut

- Un serveur Linux (VPS) : 2 processeurs, 4 Go de mémoire et 40 Go de disque suffisent pour démarrer.
- Docker et Docker Compose installés sur ce serveur.
- Un nom de domaine (par exemple `billets.exemple.com`) dont l'enregistrement DNS **A** pointe vers l'adresse IP du serveur.
- Ports 80 et 443 ouverts (le certificat HTTPS est obtenu automatiquement).
- Pour les vraies ventes : comptes marchands Wave, Orange Money et/ou Stripe, et une boîte d'envoi d'e-mails (SMTP).

### Étapes

1. Copiez le dossier du projet sur le serveur, puis placez-vous dedans.
2. Créez le fichier de configuration :
   ```bash
   cp .env.example .env
   ```
3. Générez des secrets aléatoires (exécutez la commande trois fois, une par secret) :
   ```bash
   python3 -c "import secrets; print(secrets.token_urlsafe(48))"
   ```
   Collez-les dans `.env` pour `POSTGRES_PASSWORD`, `SECRET_KEY` et `TICKET_SECRET`. Renseignez aussi `DOMAIN`, `ACME_EMAIL`, `PLATFORM_ADMIN_EMAIL` et `PLATFORM_ADMIN_PASSWORD` (16 caractères au moins).
4. Démarrez :
   ```bash
   docker compose up -d --build
   ```
5. Ouvrez `https://VOTRE-DOMAINE`, connectez-vous avec `PLATFORM_ADMIN_EMAIL` et changez le mot de passe demandé.

Services démarrés : base PostgreSQL (non exposée sur Internet), application, Caddy (HTTPS automatique), tâches de maintenance (toutes les 10 minutes) et sauvegarde quotidienne.

En production, l'application **refuse de démarrer** si un secret manque ou est trop court, si la base n'est pas PostgreSQL, si HTTPS n'est pas configuré ou si le paiement simulé est actif.

> **Ne perdez jamais `TICKET_SECRET`** : il sert à calculer les QR codes. Le changer invalide **tous** les billets déjà vendus. Changer `SECRET_KEY` déconnecte seulement tout le monde.

## Paiements

Les paiements sont encaissés sur les comptes marchands **de la plateforme**, qui reverse à chaque organisateur le net après commission (réglable par organisation dans la console plateforme). Un moyen de paiement n'est proposé aux clients que si ses clés sont renseignées dans `.env`.

| Moyen | Variables | Adresse de notification à déclarer chez l'opérateur |
|---|---|---|
| Wave | `WAVE_API_KEY`, `WAVE_WEBHOOK_SECRET` | `https://VOTRE-DOMAINE/webhooks/wave` |
| Orange Money | `ORANGE_CLIENT_ID`, `ORANGE_CLIENT_SECRET`, `ORANGE_MERCHANT_KEY`, `ORANGE_COUNTRY` | transmise automatiquement à chaque paiement |
| Carte (Stripe) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | `https://VOTRE-DOMAINE/webhooks/stripe` |

Après modification de `.env` : `docker compose up -d`.

**Avant d'ouvrir les ventes** : faites un essai complet dans l'environnement de test de chaque opérateur (`ORANGE_COUNTRY=dev`, clés de test Stripe, compte de test Wave), puis un premier vrai paiement de faible montant. Les intégrations suivent la documentation publique des opérateurs mais n'ont été essayées qu'avec des réponses simulées. Orange Money Web Payment et Stripe ne sont pas ouverts dans tous les pays : vérifiez l'éligibilité de votre structure.

## E-mails

Les billets sont envoyés par e-mail (avec le PDF en pièce jointe). Renseignez `MAIL_SERVER`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM` (fournis par votre hébergeur de messagerie). Tant que `MAIL_SERVER` est vide, aucun e-mail n'est envoyé ; chaque tentative apparaît sur la fiche de la commande.

## Billetterie sur d'autres sites

Chaque organisateur autorise ses propres sites (menu **Intégration**). Pour autoriser un site à vendre les billets de **tous** les organisateurs (votre portail, par exemple), indiquez-le dans `EMBED_ORIGINS` (adresses séparées par des virgules).

## Sauvegardes

Chaque jour, le service `backup` enregistre dans le dossier `backups/` :

- `ticketsecure-AAAAMMJJ-HHMMSS.dump` : la base de données complète, vérifiée après écriture ;
- `media-AAAAMMJJ-HHMMSS.tar.gz` : les affiches des événements.

Chaque fichier est accompagné de son empreinte SHA-256. Les sauvegardes de plus de 14 jours sont supprimées (réglable : `BACKUP_KEEP_DAYS`).

**Copiez régulièrement `backups/` hors du serveur** (autre machine, disque externe, stockage en ligne) : une sauvegarde sur le même disque ne protège pas d'une panne de ce disque.

### Restaurer

Restaurer la base (cela remplace les données actuelles) :

```bash
docker compose stop web worker
```

```bash
docker compose run --rm backup sh /scripts/restore.sh /backups/ticketsecure-AAAAMMJJ-HHMMSS.dump
```

```bash
docker compose start web worker
```

Restaurer les affiches :

```bash
docker compose run --rm -v "$PWD/backups:/backups" web sh -c "tar -xzf /backups/media-AAAAMMJJ-HHMMSS.tar.gz -C /app/media"
```

Faites un essai de restauration au moins une fois par trimestre, sur une copie.

## Mettre à jour

1. Faites une sauvegarde (copiez `backups/` et lancez `docker compose run --rm backup sh /scripts/backup.sh`).
2. Remplacez les fichiers du projet par la nouvelle version (en gardant `.env` et `backups/`).
3. `docker compose up -d --build`

Les évolutions de la base (migrations) sont appliquées automatiquement au démarrage.

## Surveillance

- `https://VOTRE-DOMAINE/health` répond `{"status": "ok"}` quand l'application et la base fonctionnent : branchez-y un service de surveillance gratuit (alerte par e-mail ou SMS).
- Journaux : `docker compose logs -f web`.
- Intégrité du journal d'audit : console plateforme → Audit, ou `docker compose exec web flask verify-audit`.

## Application Android

L'APK se compile automatiquement sur GitHub (onglet **Actions** → « Application Android (scanner) » → **Run workflow**, en indiquant l'adresse de votre plateforme, puis télécharger l'artefact). On peut aussi ouvrir le dossier `android/` dans Android Studio. Pour une diffusion par le Play Store, signez la version finale (voir README).

## Liste de contrôle avant l'ouverture au public

- [ ] Essais réels de chaque moyen de paiement (test, puis petit montant réel).
- [ ] Envoi des e-mails vérifié (y compris arrivée hors courriers indésirables).
- [ ] Conditions de vente (`templates/shop/terms.html`) et politique de données personnelles relues par un juriste.
- [ ] Sauvegardes copiées hors du serveur et restauration essayée.
- [ ] Surveillance de `/health` en place.
- [ ] Répétition générale du contrôle : téléphones préparés, coupure volontaire du réseau, synchronisation.
- [ ] Test de charge adapté à vos plus gros événements et revue de sécurité indépendante.
