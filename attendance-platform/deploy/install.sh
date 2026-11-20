#!/usr/bin/env bash
# تثبيت منصة رصد الحضور على خادم Linux بأمر واحد.
# الاستخدام (من داخل مجلد attendance-platform):
#   sudo ./deploy/install.sh attendance.example.com
# - إن كان المنفذان 80/443 فارغين: تشغيل كامل مع HTTPS تلقائي (Caddy).
# - إن كان عليهما خادم ويب لمنصات أخرى: تشغيل التطبيق على 127.0.0.1 وإعداد Nginx له إن وُجد.
set -euo pipefail
DOMAIN="${1:-}"
[ -n "$DOMAIN" ] || { echo "الاستخدام: sudo $0 <النطاق>"; exit 1; }
cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null; then
  echo "تثبيت Docker…"
  curl -fsSL https://get.docker.com | sh
fi

APP_PORT="${APP_PORT:-3100}"
[ -f .env ] || cp .env.example .env
sed -i "s|^DOMAIN=.*|DOMAIN=$DOMAIN|" .env
grep -q '^APP_PORT=' .env || echo "APP_PORT=$APP_PORT" >> .env

if ss -ltn '( sport = :80 or sport = :443 )' | grep -q LISTEN; then
  echo "المنفذان 80/443 مستخدمان من خادم ويب آخر — تشغيل التطبيق خلفه على 127.0.0.1:$APP_PORT"
  docker compose -f docker-compose.app-only.yml up -d --build
  if command -v nginx >/dev/null; then
    sed -e "s/attendance.example.com/$DOMAIN/" -e "s/127.0.0.1:3100/127.0.0.1:$APP_PORT/" deploy/nginx.conf > /etc/nginx/sites-available/attendance
    ln -sf /etc/nginx/sites-available/attendance /etc/nginx/sites-enabled/attendance
    nginx -t && systemctl reload nginx
    if command -v certbot >/dev/null; then
      certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect || echo "شغّل certbot يدوياً لإصدار الشهادة"
    else
      echo "ثبّت certbot ثم: certbot --nginx -d $DOMAIN"
    fi
  else
    echo "لم يُعثر على Nginx. وجّه خادم الويب الموجود (Apache/Caddy/لوحة التحكم) إلى http://127.0.0.1:$APP_PORT للنطاق $DOMAIN"
  fi
else
  docker compose up -d --build
fi

for i in $(seq 1 30); do
  if curl -fs "http://127.0.0.1:$APP_PORT/healthz" >/dev/null 2>&1 || docker compose ps app 2>/dev/null | grep -q healthy; then break; fi
  sleep 2
done
echo "تم. افتح: https://$DOMAIN"
