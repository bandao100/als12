# Site internet ASK'N CO

Site vitrine d'ASK'N CO, Multiple Service Company : traduction et interprétariat, bâtiment et travaux publics, fourniture de matériel, réseaux et télécommunications, assistance juridique et intermédiation financière.

Le site est publié par GitHub Pages, qui l'assemble automatiquement (Jekyll) à partir des textes rangés dans le dossier `_data`. Ces textes se modifient depuis un **espace d'administration en français**, à l'adresse du site suivie de `/admin/`, sans toucher au code.

## Mettre le site en ligne (une seule fois)

Sur GitHub : **Settings → Pages → Build and deployment**, choisir **Deploy from a branch**, la branche `master` et le dossier `/ (root)`, puis **Save**. Le site est en ligne quelques minutes plus tard à l'adresse `https://bandao100.github.io/als12/`.

## Modifier le site

### Première connexion

L'espace d'administration utilise votre compte GitHub. Les écrans de GitHub sont en anglais : les noms des boutons sont donc indiqués tels qu'ils apparaissent.

1. **Créer un jeton d'accès** (une sorte de mot de passe réservé à ce site) :
   - sur github.com, cliquez sur votre photo de profil, puis **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token** ;
   - **Token name** : `Administration ASK'N CO` ; **Expiration** : la durée de votre choix (par exemple un an) ;
   - **Repository access** : **Only select repositories**, puis choisissez `bandao100/als12` ;
   - **Permissions → Repository permissions → Contents** : **Read and write** ;
   - cliquez sur **Generate token** et copiez le jeton. Il ne s'affiche qu'une fois : conservez-le comme un mot de passe et ne le partagez pas.
2. Ouvrez **https://bandao100.github.io/als12/admin/**, cliquez sur **Se connecter avec un jeton d'accès** et collez le jeton.

L'interface s'affiche en français quand votre navigateur est réglé en français. Sinon, choisissez la langue dans les paramètres de l'administration.

### Au quotidien

1. Ouvrez `/admin/`, puis **Contenu du site**.
2. Choisissez une fiche :

   | Fiche | Ce qu'elle contient |
   |---|---|
   | Coordonnées de l'entreprise | Nom, e-mail, téléphone, WhatsApp, adresse, horaires, réseaux sociaux, description pour Google |
   | Accueil | Titre, introduction, boutons, trois engagements |
   | Services | Les métiers : nom, famille (bleu ou vert), icône, description, prestations. On peut en ajouter, en retirer ou les réordonner |
   | Réalisations (photos) | Projets avec photo. La section apparaît sur le site dès le premier projet ajouté |
   | Méthode, Clients, À propos, Questions fréquentes | Les textes de chaque section |
   | Autres textes du site | Titres des sections, bandeau d'appel, contact, pied de page |

3. Modifiez, puis enregistrez. Le site en ligne est mis à jour une à deux minutes plus tard.

Bon à savoir :
- Laisser un champ vide (téléphone, WhatsApp, horaires, réseaux sociaux) le masque sur le site.
- Renseigner un numéro WhatsApp ajoute automatiquement un bouton WhatsApp flottant, un bouton dans le bandeau d'appel et un envoi du formulaire par WhatsApp.
- Le schéma de l'accueil s'adapte de 3 à 8 services. Les accroches qui défilent dans le titre doivent rester courtes (18 caractères au plus).
- Chaque modification est enregistrée dans l'historique du dépôt : on peut revenir en arrière à tout moment depuis GitHub.

### Donner ou retirer des accès

- **Donner un accès** : la personne crée un compte GitHub gratuit. Sur la page du dépôt, allez dans **Settings → Collaborators → Add people** et saisissez son identifiant GitHub ou son e-mail. Elle accepte l'invitation reçue par e-mail, crée son propre jeton (étape 1 ci-dessus) et se connecte à `/admin/`.
- **Retirer un accès** : **Settings → Collaborators**, puis **Remove** à côté de son nom. Ses jetons cessent alors de fonctionner pour ce site.
- Un collaborateur peut techniquement modifier tout le dépôt : ne donnez l'accès qu'à des personnes de confiance.

## Contenu du dépôt

```
index.html            Gabarit de la page (structure et mise en forme des données)
_data/                Textes et coordonnées, modifiables depuis l'administration
_includes/icone.html  Icônes du site
admin/                Espace d'administration en français (Sveltia CMS) et sa configuration
_config.yml           Configuration de Jekyll
assets/css/style.css  Styles (couleurs de la marque définies en haut du fichier)
assets/js/main.js     Animations, menu mobile, filtre des services, formulaire
assets/img/           Logo (clair et sombre), favicon, image de partage
assets/uploads/       Photos ajoutées depuis l'administration
```

## À compléter avant la mise en ligne

Dans l'administration, fiche **Coordonnées de l'entreprise** :

- [ ] E-mail (`votre-email@exemple.com` pour l'instant ; le formulaire envoie les demandes à cette adresse)
- [ ] Téléphone (`+XXX XX XX XX XX` pour l'instant)
- [ ] Adresse (`Ville, Pays` pour l'instant)
- [ ] WhatsApp, horaires et réseaux sociaux si vous le souhaitez
- [ ] Vérifier les prestations de chaque service et ajouter vos autres métiers

## Voir le site en local (facultatif)

```bash
gem install github-pages
jekyll serve
# puis ouvrir http://localhost:4000
```

## Formulaire de contact

Le site n'a pas de serveur : le bouton « Préparer mon e-mail » ouvre la messagerie du visiteur avec un message prérempli adressé à l'adresse de contact, et le bouton WhatsApp (si un numéro est renseigné) ouvre WhatsApp avec le message. Pour recevoir les demandes sans passer par la messagerie du visiteur, on peut brancher le formulaire sur un service comme Formspree.

## Nom de domaine

Une fois le domaine acheté (par exemple chez OVHcloud), l'ajouter dans **Settings → Pages → Custom domain** et créer chez le registraire quatre enregistrements **A** vers `185.199.108.153`, `185.199.109.153`, `185.199.110.153` et `185.199.111.153`, plus un **CNAME** `www` vers `bandao100.github.io`. Cocher ensuite **Enforce HTTPS**, et remplacer l'adresse `site_url` dans `admin/config.yml` par la nouvelle adresse.
