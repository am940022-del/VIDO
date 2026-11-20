#!/usr/bin/env sh
# استعادة نسخة احتياطية: ./deploy/restore.sh backups/attendance-XXXX.db
set -e
[ -f "$1" ] || { echo "حدد ملف النسخة الاحتياطية"; exit 1; }
cd "$(dirname "$0")/.."
docker compose stop app
docker compose run --rm -v "$(pwd)/$1:/restore.db:ro" --entrypoint sh app -c \
  'cp /restore.db /data/attendance.db && rm -f /data/attendance.db-wal /data/attendance.db-shm'
docker compose start app
echo "تمت الاستعادة"
