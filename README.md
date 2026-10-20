# als12
Banque

## Banque de questions

Application web sans dépendance (HTML, CSS, JavaScript) pour créer, parcourir et utiliser en quiz une banque de questions à choix multiples.

### Lancer l'application

Ouvrez `index.html` dans un navigateur. Aucune installation n'est nécessaire.

- **Parcourir** : recherche par mot-clé et filtre par thème.
- **Ajouter** : création d'une question (thème, énoncé, choix un par ligne, numéro de la bonne réponse, explication).
- **Quiz** : tirage aléatoire de questions d'un thème, correction immédiate et bilan final.
- **Import / Export** : sauvegarde de la banque dans un fichier JSON, ou transfert vers un autre appareil.

Les questions sont enregistrées dans le navigateur (`localStorage`). Pensez à exporter régulièrement la banque, car vider les données du site les efface.

### Fichiers

- `index.html` : structure de la page
- `styles.css` : mise en forme
- `app.js` : logique (banque, quiz, import et export)
