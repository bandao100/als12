# Site internet ASK'N CO

Site vitrine d'ASK'N CO, Multiple Service Company : formation, ingénierie pédagogique, santé communautaire, études épidémiologiques et suivi-évaluation.

Site statique (HTML, CSS, JavaScript), sans dépendance ni étape de compilation. Il s'adapte aux téléphones et suit le thème clair ou sombre de l'appareil du visiteur.

## Contenu

```
index.html              Page unique : accueil, services, approche, publics, à propos, contact
assets/css/style.css    Styles (couleurs de la marque définies en haut du fichier)
assets/js/main.js       Menu mobile, filtre des services, formulaire de contact
assets/img/             Logo (clair et sombre), favicon, image de partage
```

## Voir le site en local

Ouvrir `index.html` dans un navigateur, ou lancer un petit serveur :

```bash
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

## À compléter avant la mise en ligne

Les coordonnées sont des exemples à remplacer dans `index.html` (section `Contact`) :

- [ ] E-mail : `votre-email@exemple.com` (le formulaire envoie les demandes à cette adresse)
- [ ] Téléphone / WhatsApp : `+XXX XX XX XX XX`
- [ ] Adresse : `Ville, Pays`
- [ ] Vérifier la liste des services, des publics et des outils pour qu'elle corresponde exactement à vos activités
- [ ] Après la mise en ligne, remplacer `assets/img/og-image.jpg` dans la balise `og:image` par l'adresse complète (`https://…/assets/img/og-image.jpg`) pour un bel aperçu lors des partages sur les réseaux sociaux

## Formulaire de contact

Le site n'a pas de serveur : le bouton « Préparer mon message » ouvre la messagerie du visiteur avec un e-mail prérempli adressé à l'adresse de contact. Pour recevoir les demandes sans passer par la messagerie du visiteur, on peut brancher le formulaire sur un service comme Formspree ou Netlify Forms.

## Mise en ligne avec GitHub Pages

1. Fusionner ce travail dans la branche principale.
2. Sur GitHub : **Settings → Pages → Build and deployment**, choisir **Deploy from a branch**, la branche principale et le dossier `/ (root)`.
3. Le site sera publié à l'adresse indiquée par GitHub quelques minutes plus tard. Un nom de domaine personnalisé (par exemple `asknco.com`) peut être ajouté dans la même page.
