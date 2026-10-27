#!/bin/sh
# Резервная копия базы (без остановки сервиса). Запускать из cron на сервере:
#   15 3 * * * /opt/etazh/scripts/backup.sh
set -e
cd "$(dirname "$0")/.."
mkdir -p backups
STAMP=$(date +%Y%m%d-%H%M)
docker compose exec -T app node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('/data/etazh.sqlite');
db.exec(\"VACUUM INTO '/data/backup-tmp.sqlite'\");
"
docker compose cp app:/data/backup-tmp.sqlite "backups/etazh-$STAMP.sqlite"
docker compose exec -T app rm -f /data/backup-tmp.sqlite
gzip "backups/etazh-$STAMP.sqlite"
# Храним 14 последних копий
ls -1t backups/etazh-*.sqlite.gz | tail -n +15 | xargs -r rm
echo "OK: backups/etazh-$STAMP.sqlite.gz"
