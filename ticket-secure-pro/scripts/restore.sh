#!/bin/sh
# Restaure une sauvegarde dans la base (ATTENTION : remplace les données actuelles).
# Usage depuis l'hôte :
#   docker compose stop web worker
#   docker compose run --rm backup sh /scripts/restore.sh /backups/ticketsecure-AAAAMMJJ-HHMMSS.dump
#   docker compose start web worker
set -eu
file="${1:?Indiquez le fichier .dump à restaurer}"
if [ -f "$file.sha256" ]; then sha256sum -c "$file.sha256"; fi
pg_restore --list "$file" > /dev/null
echo "Restauration de $file dans $PGDATABASE sur $PGHOST..."
pg_restore --clean --if-exists --no-owner --single-transaction --dbname="$PGDATABASE" "$file"
echo "Restauration terminée."
