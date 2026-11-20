# Référence de l'API publique

API JSON utilisée par le widget, utilisable par tout développeur pour construire sa propre interface (site, application mobile…).

- Adresse de base : `https://VOTRE-PLATEFORME/api/public/v1`
- Format : JSON (UTF-8). Dates en UTC au format ISO 8601 (`2026-12-20T20:00:00Z`) ; un libellé déjà formaté en heure locale est fourni à côté (`starts_label`).
- Montants : entiers, dans la devise de la plateforme (`XOF` = franc CFA, sans décimales).
- Aucun cookie, aucune clé d'API pour la lecture.
- Réponses d'erreur : `{"ok": false, "error": "code", "message": "texte lisible"}` avec un code HTTP 4xx ou 5xx.

## Lecture (ouverte à tous les sites)

### `GET /config`

Paramètres de la plateforme : nom, devise, genres, moyens de paiement actifs, nombre maximal de billets par commande.

```json
{"ok": true, "platform": "Ticket Secure Pro", "currency": "XOF", "max_per_order": 10,
 "genres": [{"code": "concert", "label": "Concerts"}, {"code": "festival", "label": "Festivals"}],
 "providers": [{"code": "wave", "label": "Wave", "description": "Paiement mobile Wave"}],
 "simulation": false}
```

Codes de genre : `concert`, `festival`, `soiree`, `theatre`, `humour`, `sport`, `cinema`, `conference`, `formation`, `religion`, `famille`, `autre`.

### `GET /evenements`

Événements publiés à venir, triés par date.

| Paramètre | Rôle |
|---|---|
| `q` | Recherche dans le nom, le lieu, la ville, l'organisateur |
| `genre` | Code de genre |
| `ville` | Ville exacte (sans tenir compte des majuscules) |
| `organisateur` | Identifiant de l'organisateur |
| `a_la_une=1` | Seulement les événements mis à la une par la plateforme |
| `page`, `par_page` | Pagination (12 par défaut, 48 au plus) |

```json
{"ok": true, "total": 4, "page": 1, "pages": 1, "events": [{
  "id": 1, "slug": "nuit-des-masques", "name": "Nuit des Masques",
  "genre": "festival", "genre_label": "Festivals",
  "venue": "Maison du Peuple", "city": "Ouagadougou",
  "starts_at": "2026-12-20T20:00:00Z", "starts_label": "20/12/2026 à 20:00",
  "poster_url": "https://VOTRE-PLATEFORME/media/affiches/3f9c….webp",
  "featured": true, "min_price": 5000, "min_price_label": "5 000 F CFA", "currency": "XOF",
  "on_sale": true, "sold_out": false,
  "organizer": {"name": "Festival des Masques", "slug": "festival-des-masques-b237"},
  "url": "https://VOTRE-PLATEFORME/o/festival-des-masques-b237/nuit-des-masques"}]}
```

### `GET /villes`

Villes ayant au moins un événement à venir (`?organisateur=` pour filtrer).

```json
{"ok": true, "cities": ["Bobo-Dioulasso", "Koudougou", "Ouagadougou"]}
```

### `GET /evenements/{organisateur}/{evenement}`

Fiche complète : mêmes champs que la liste, plus la description, les catégories de billets en vente avec les places restantes (`null` = illimité), le nombre de places de l'événement, les moyens de paiement.

```json
{"ok": true, "event": {"id": 1, "name": "Nuit des Masques", "description": "…",
  "categories": [
    {"id": 1, "name": "Standard", "price": 5000, "price_label": "5 000 F CFA", "available": 797},
    {"id": 2, "name": "VIP", "price": 15000, "price_label": "15 000 F CFA", "available": 49}],
  "remaining": 797, "max_per_order": 10, "providers": [ … ]}}
```

## Commande

### `POST /commandes`

Crée une commande, réserve les places pendant le paiement (30 minutes par défaut) et démarre le paiement.

Appel depuis un navigateur : seulement à partir d'un site autorisé par l'organisateur (menu **Intégration**), ou par la plateforme (`EMBED_ORIGINS`). Appel depuis un serveur (sans en-tête `Origin`) : accepté, mais la page de retour doit tout de même appartenir à un site autorisé. Les créations de commande sont limitées à 20 par heure et par adresse IP (réglage `ORDERS_PER_IP_PER_HOUR`) : faites appeler l'API par le navigateur du client plutôt que par votre serveur.

```json
{
  "event_id": 1,
  "items": [{"category_id": 1, "quantity": 2}, {"category_id": 2, "quantity": 1}],
  "customer": {"name": "Ibrahim Sawadogo", "email": "ibrahim@exemple.com", "phone": "+226 70 11 22 33"},
  "provider": "wave",
  "accept_terms": true,
  "return_url": "https://www.monsite.com/billetterie"
}
```

- `provider` : un code de `/config` (`wave`, `orange_money`, `card`). Inutile si tous les billets sont gratuits.
- `return_url` : page de votre site où le client revient après le paiement. Elle doit appartenir à un site autorisé.

Réponse `201` :

```json
{"ok": true, "ref": "CC67AAB627E32", "key": "9b1f…", "status": "pending",
 "payment_url": "https://pay.wave.com/c/cos-…", "amount": 25000, "amount_label": "25 000 F CFA",
 "expires_at": "2026-11-19T10:05:00Z"}
```

Redirigez le client vers `payment_url`. **Conservez `ref` et `key`** : la clé est la seule façon d'afficher les billets ; ne la transmettez à personne d'autre que le client.

Après le paiement, le client revient sur `return_url?tsp_commande=CC67AAB627E32` (avec `&tsp_annule=1` s'il a annulé).

Erreurs possibles : `400` (données invalides, panier vide, page de retour non autorisée), `403` (site non autorisé), `404` (événement fermé), `409` (places insuffisantes), `502` (opérateur de paiement indisponible).

### `GET /commandes/{ref}?cle={key}`

État de la commande et, une fois payée, les billets.

```json
{"ok": true, "ref": "CC67AAB627E32", "status": "paid", "amount": 25000, "amount_label": "25 000 F CFA",
 "customer_email": "ibrahim@exemple.com",
 "event": {"name": "Nuit des Masques", "starts_label": "20/12/2026 à 20:00", "venue": "Maison du Peuple",
           "city": "Ouagadougou", "poster_url": "…"},
 "tickets": [{"number": "TS0001-000001", "category": "Standard", "holder": "Ibrahim Sawadogo",
              "status": "valid", "qr_url": "https://VOTRE-PLATEFORME/commande/…/billet/1.png"}],
 "pdf_url": "https://VOTRE-PLATEFORME/commande/…/billets.pdf",
 "order_url": "https://VOTRE-PLATEFORME/commande/…"}
```

Valeurs de `status` : `pending` (en attente de l'opérateur), `paid`, `failed`, `expired`, `cancelled`, `refunded`.

Tant que la commande est `pending`, interrogez cette adresse toutes les 3 secondes environ : si la notification de l'opérateur tarde, la plateforme vérifie elle-même le paiement auprès de lui (6 fois par minute au plus).

## Bonnes pratiques

- N'affichez jamais un billet sans l'avoir obtenu de `/commandes/{ref}` : seul le statut `paid` renvoyé par la plateforme fait foi.
- Les QR codes sont des images PNG : affichez-les tels quels, sans les redimensionner en dessous de 120 pixels.
- Les affiches (`poster_url`) sont des images WebP, mises en cache 30 jours.
