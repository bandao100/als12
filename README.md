# Site internet ASK'N CO

Site vitrine d'ASK'N CO, Multiple Service Company : traduction et interprétariat, bâtiment et travaux publics, fourniture de matériel, réseaux et télécommunications, assistance juridique et intermédiation financière.

Le site est publié par GitHub Pages, qui l'assemble automatiquement (Jekyll) à partir des textes rangés dans le dossier `_data`. Ces textes se modifient depuis un espace d'administration en ligne, **Pages CMS**, sans toucher au code.

## Modifier le site

### Première mise en place (une seule fois)

1. Fusionner ce travail dans la branche principale `master`.
2. Sur GitHub : **Settings → Pages → Build and deployment**, choisir **Deploy from a branch**, la branche `master` et le dossier `/ (root)`, puis **Save**. Le site est en ligne quelques minutes plus tard à l'adresse indiquée sur cette page.
3. Aller sur [app.pagescms.org](https://app.pagescms.org), choisir **Sign in with GitHub** et se connecter avec le compte propriétaire du dépôt.
4. Lorsque Pages CMS le demande, installer son application GitHub sur le dépôt `bandao100/als12` uniquement.

### Au quotidien

1. Se connecter sur [app.pagescms.org](https://app.pagescms.org) et ouvrir le dépôt `als12`, branche `master`.
2. Choisir une rubrique dans le menu de gauche :

   | Rubrique | Ce qu'elle contient |
   |---|---|
   | Coordonnées de l'entreprise | Nom, e-mail, téléphone, WhatsApp, adresse, horaires, réseaux sociaux, description pour Google |
   | Accueil | Titre, introduction, boutons, trois engagements |
   | Services | Les métiers : nom, famille (bleu ou vert), icône, description, prestations. On peut en ajouter, en retirer ou les réordonner |
   | Réalisations (photos) | Projets avec photo. La section apparaît sur le site dès le premier projet ajouté |
   | Méthode, Clients, À propos, Questions fréquentes | Les textes de chaque section |
   | Autres textes du site | Titres des sections, bandeau d'appel, contact, pied de page |

3. Modifier puis cliquer sur **Save**. Le site en ligne est mis à jour une à deux minutes plus tard.

Bon à savoir :
- Laisser un champ vide (téléphone, WhatsApp, horaires, réseaux sociaux) le masque sur le site.
- Renseigner un numéro WhatsApp ajoute automatiquement un bouton WhatsApp flottant, un bouton dans le bandeau d'appel et un envoi du formulaire par WhatsApp.
- Le schéma de l'accueil s'adapte de 3 à 8 services. Les accroches qui défilent dans le titre doivent rester courtes (18 caractères au plus).
- Chaque modification est enregistrée dans l'historique du dépôt : on peut revenir en arrière à tout moment depuis GitHub.

### Donner ou retirer des accès

- **Pour un collaborateur qui modifie le contenu** (pas besoin de compte GitHub) : dans Pages CMS, menu **Collaborators**, bouton **Invite**, saisir son adresse e-mail puis **Send invite**. La personne reçoit un lien de connexion par e-mail. Elle peut modifier les textes et les photos, mais pas la configuration ni les accès des autres. Pour retirer l'accès, la supprimer de la même liste.
- **Pour une personne technique** (accès complet au code) : sur GitHub, **Settings → Collaborators → Add people**.

## Contenu du dépôt

```
index.html            Gabarit de la page (structure et mise en forme des données)
_data/                Textes et coordonnées, modifiables avec Pages CMS
_includes/icone.html  Icônes du site
.pages.yml            Configuration de l'espace d'administration Pages CMS
_config.yml           Configuration de Jekyll
assets/css/style.css  Styles (couleurs de la marque définies en haut du fichier)
assets/js/main.js     Animations, menu mobile, filtre des services, formulaire
assets/img/           Logo (clair et sombre), favicon, image de partage
assets/uploads/       Photos ajoutées depuis Pages CMS
```

## À compléter avant la mise en ligne

Dans Pages CMS, rubrique **Coordonnées de l'entreprise** :

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

Une fois le domaine acheté (par exemple chez OVHcloud), l'ajouter dans **Settings → Pages → Custom domain** et créer chez le registraire quatre enregistrements **A** vers `185.199.108.153`, `185.199.109.153`, `185.199.110.153` et `185.199.111.153`, plus un **CNAME** `www` vers `bandao100.github.io`. Cocher ensuite **Enforce HTTPS**.
