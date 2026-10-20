# Aurore — suivi budgétaire de chantier (application Android)

**Aurore** est une application Android hors ligne qui remplace le classeur Excel
« Colombe3_Suivi_Design » pour le suivi budgétaire du chantier Colombe 3 : budget par poste et
par lot, paiements, restes à payer.

## Fonctionnalités

- **Tableau de bord** : reste à décaisser, avancement financier, budget vs payé par lot,
  postes prioritaires à régler, derniers paiements.
- **Postes de travaux** : recherche, filtres (à payer / soldés / par lot), détail de chaque poste
  avec ses paiements ; statut calculé automatiquement (En attente, En cours, Soldé).
- **Saisie rapide** (bouton « + ») :
  - paiement sur un poste existant (acompte, solde en un geste, mode de paiement, notes) ;
  - nouvelle dépense payée comptant (crée le poste et le paiement en une fois) ;
  - nouveau poste budgété (devis à payer plus tard).
  Un dépassement de budget est signalé et peut ajuster le budget du poste.
- **Historique** des paiements par jour, filtres par mois et par lot, totaux.
- **Prestataires** : montants versés et restes à payer par prestataire.
- **Partage du point budgétaire** (WhatsApp, SMS, e-mail…).
- **Export Excel (.xlsx)** : tableau de bord, suivi détaillé et historique, avec formules.
- **Sauvegarde / restauration** (.json) ; annulation des suppressions ; mode sombre.

Les données sont enregistrées uniquement sur le téléphone (aucune connexion Internet nécessaire).

## Installer l'APK

1. Copier `Aurore.apk` sur le téléphone (WhatsApp, Drive, câble USB…).
2. L'ouvrir et autoriser l'installation d'applications provenant de cette source si Android le demande.
3. Android 7.0 ou plus récent.

**Sauvegardes** : exporter régulièrement une sauvegarde (Plus → Exporter une sauvegarde).
Une désinstallation efface les données du téléphone ; la sauvegarde permet de tout restaurer.

**Mises à jour** : une nouvelle version s'installe par-dessus l'ancienne, sans perte de données,
à condition d'être signée avec la même clé (`colombe3.keystore`, conservée hors de ce dépôt) et de
garder l'identifiant `com.colombe3.suivi`.

## Recompiler l'APK

Aucun Android Studio ni SDK Android n'est nécessaire : il faut Linux x86-64, Java 17+, Python 3 (avec
`openpyxl` et `Pillow`), `curl` et `unzip`.

```bash
# Placer la clé de signature dans android/colombe3.keystore (sinon une nouvelle clé est créée)
scripts/construire_apk.sh chemin/vers/Colombe3_Suivi_Design.xlsx
# -> build/Aurore.apk
```

Le script convertit le classeur en données initiales (`web/donnees-initiales.js`), télécharge
une fois les outils de compilation (aapt2, d8, apksigner, bibliothèque Android 15, vérifiés par
empreinte SHA-256), puis compile, aligne et signe l'APK. Variables utiles : `VERSION_NOM`,
`VERSION_CODE` (à augmenter à chaque mise à jour), `KEYSTORE`, `KEYSTORE_MDP`.

Les données du chantier et la clé de signature ne sont jamais versionnées (voir `.gitignore`).

## Organisation du projet

| Dossier / fichier | Rôle |
| --- | --- |
| `web/` | L'application (HTML, CSS, JavaScript), utilisable aussi dans un navigateur |
| `web/vendor/xlsx.mini.min.js` | SheetJS 0.18.5 (licence Apache 2.0) pour l'export Excel |
| `android/` | Coquille Android : WebView, stockage des données, partage et enregistrement de fichiers |
| `scripts/excel_vers_donnees.py` | Conversion du classeur Excel (postes + historique des paiements) |
| `scripts/construire_apk.sh` | Compilation et signature de l'APK |
| `scripts/aligner_apk.py` | Alignement des fichiers de l'APK (équivalent de `zipalign`) |
| `scripts/icones.py` | Génération des icônes |
