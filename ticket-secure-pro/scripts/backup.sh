#!/bin/sh
# Sauvegarde PostgreSQL au format personnalisé (pg_dump -Fc), vérifiée par pg_restore --list.
# Variables : PGHOST, PGUSER, PGPASSWORD, PGDATABASE, BACKUP_DIR (défaut /backups).
set -eu
BACKUP_DIR="${BACKUP_DIR:-/backups}"
mkdir -p "$BACKUP_DIR"
stamp=$(date -u +%Y%m%d-%H%M%S)
target="$BACKUP_DIR/ticketsecure-$stamp.dump"
pg_dump --format=custom --compress=6 --file="$target.tmp"
pg_restore --list "$target.tmp" > /dev/null   # échoue si le fichier est illisible
mv "$target.tmp" "$target"
sha256sum "$target" > "$target.sha256"
echo "$(date -u +%FT%TZ) sauvegarde OK : $target ($(du -h "$target" | cut -f1))"
