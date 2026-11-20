#!/usr/bin/env sh
# نسخة احتياطية فورية ونسخها إلى مجلد backups بجانب هذا الملف
set -e
cd "$(dirname "$0")/.."
FILE=$(docker compose exec -T app node src/backup.js | tail -1)
mkdir -p backups
docker compose cp "app:$FILE" "backups/$(basename "$FILE")"
echo "تم: backups/$(basename "$FILE")"
