#!/usr/bin/env bash
# نشر آخر نسخة من الكود: نسخة احتياطية أولاً، ثم سحب الكود وإعادة البناء والتشغيل.
#   sudo bash deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== Backup before updating"
docker compose exec -T app node src/backup.js || echo "Backup failed (is the app running?)"

echo "== Fetching the latest code"
git pull --ff-only

echo "== Building and restarting"
docker compose build
docker compose up -d

for _ in $(seq 1 40); do
  if docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "== Updated and healthy"
    exit 0
  fi
  sleep 3
done
echo "The app is not healthy after the update. See: docker compose logs app" >&2
exit 1
