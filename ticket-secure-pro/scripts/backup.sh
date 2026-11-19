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

# Affiches des événements (fichiers hors base de données).
if [ -n "${MEDIA_DIR:-}" ] && [ -d "$MEDIA_DIR" ]; then
  media="$BACKUP_DIR/media-$stamp.tar.gz"
  tar -czf "$media.tmp" -C "$MEDIA_DIR" .
  mv "$media.tmp" "$media"
  sha256sum "$media" > "$media.sha256"
  echo "$(date -u +%FT%TZ) affiches OK : $media"
fi
