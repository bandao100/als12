#!/bin/sh
# Sauvegarde périodique et rotation (conteneur « backup » de docker-compose).
set -u
interval_hours="${BACKUP_INTERVAL_HOURS:-24}"
keep_days="${BACKUP_KEEP_DAYS:-14}"
while true; do
  if sh /scripts/backup.sh; then
    find /backups -name 'ticketsecure-*.dump*' -mtime +"$keep_days" -print -delete
  else
    echo "$(date -u +%FT%TZ) ÉCHEC DE LA SAUVEGARDE" >&2
  fi
  sleep $((interval_hours * 3600))
done
