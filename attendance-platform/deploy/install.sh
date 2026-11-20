#!/usr/bin/env bash
# تثبيت منصة رصد الحضور على الخادم. شغّله من مجلد المنصة:
#   sudo bash deploy/install.sh
# آمن لإعادة التشغيل: الإعدادات والبيانات الموجودة تبقى.
#
# يختار طريقة التشغيل تلقائياً:
#   1) إنتماء موجود في /opt/athar (ومعه دفتر أو بدونه): Caddy إنتماء يخدم هذه المنصة أيضاً
#      عبر شبكة "edge" المشتركة — بنفس طريقة دفتر، دون تغيير كود إنتماء أو دفتر.
#   2) خادم ويب آخر يستخدم 80/443 (Nginx...): التطبيق على 127.0.0.1:APP_PORT خلفه.
#   3) خادم فارغ: التطبيق مع Caddy خاص به (HTTPS تلقائي).
set -euo pipefail

cd "$(dirname "$0")/.."
APP_DIR="$(pwd)"
ENV_FILE="$APP_DIR/.env"
INTIMAA_DIR="${INTIMAA_DIR:-/opt/athar}"
DAFTER_DIR="${DAFTER_DIR:-/opt/dafter}"
BUILD="${BUILD:-1}"   # BUILD=0 لاستخدام صورة مبنية مسبقاً (للاختبار)

say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mخطأ: %s\033[0m\n' "$*" >&2; exit 1; }
setenv() { # setenv KEY VALUE : يضيف أو يحدّث متغيراً في .env
  if grep -q "^$1=" "$ENV_FILE"; then sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"; else echo "$1=$2" >> "$ENV_FILE"; fi
}

[ "$(id -u)" -eq 0 ] || die "شغّله بصلاحية root: sudo bash deploy/install.sh"

say "1/5 Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
if [ ! -f /etc/docker/daemon.json ]; then
  echo '{"log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"5"}}' > /etc/docker/daemon.json
  systemctl restart docker
fi
systemctl enable --now docker >/dev/null 2>&1 || true

# ---- تحديد طريقة التشغيل ----
MODE=standalone
if [ -f "$INTIMAA_DIR/deploy/.env" ] && [ -f "$INTIMAA_DIR/deploy/docker-compose.yml" ]; then
  MODE=shared
  INTIMAA_DOMAIN="$(grep -m1 '^DOMAIN=' "$INTIMAA_DIR/deploy/.env" | cut -d= -f2-)"
  echo "وُجد إنتماء في $INTIMAA_DIR (https://$INTIMAA_DOMAIN): ستعمل المنصة خلف Caddy الخاص به."
elif ss -ltn 2>/dev/null | grep -qE '[:.](80|443)\s'; then
  MODE=behind-proxy
  echo "المنفذان 80/443 مستخدمان من خادم ويب آخر: ستعمل المنصة خلفه."
fi

say "2/5 الإعدادات ($ENV_FILE)"
NEW_INSTALL=0
if [ ! -f "$ENV_FILE" ]; then
  NEW_INSTALL=1
  umask 077
  cp .env.example "$ENV_FILE"
  if [ "$MODE" = "shared" ]; then
    read -rp "نطاق منصة الحضور [attendance.$INTIMAA_DOMAIN]: " DOMAIN
    DOMAIN="${DOMAIN:-attendance.$INTIMAA_DOMAIN}"
  else
    read -rp "نطاق منصة الحضور (مثل attendance.example.com): " DOMAIN
  fi
  [ -n "$DOMAIN" ] || die "النطاق مطلوب."
  read -rp "المنطقة الزمنية للمدارس [Asia/Muscat]: " TZV
  read -rp "رمز الدولة لأرقام أولياء الأمور [968]: " CC
  setenv DOMAIN "$DOMAIN"
  setenv SCHOOL_TZ "${TZV:-Asia/Muscat}"
  setenv DEFAULT_COUNTRY_CODE "${CC:-968}"
  chmod 600 "$ENV_FILE"
else
  echo "الإعدادات الموجودة محفوظة."
fi
case "$MODE" in
  shared)       setenv COMPOSE_FILE docker-compose.shared.yml ;;
  behind-proxy) setenv COMPOSE_FILE docker-compose.app-only.yml ;;
  standalone)   setenv COMPOSE_FILE docker-compose.yml ;;
esac
DOMAIN="$(grep -m1 '^DOMAIN=' "$ENV_FILE" | cut -d= -f2-)"
APP_PORT="$(grep -m1 '^APP_PORT=' "$ENV_FILE" | cut -d= -f2- || true)"; APP_PORT="${APP_PORT:-3100}"

say "3/5 البناء والتشغيل"
[ "$MODE" = "shared" ] && { docker network inspect edge >/dev/null 2>&1 || docker network create edge >/dev/null; }
if [ "$BUILD" = "1" ]; then docker compose build; fi
docker compose up -d --no-build
printf 'انتظار جاهزية المنصة'
for _ in $(seq 1 40); do
  if docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then echo ' جاهزة.'; break; fi
  printf '.'; sleep 3
done
docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
  || die "المنصة لم تعمل. راجع: docker compose logs app"

say "4/5 HTTPS"
if [ "$MODE" = "shared" ]; then
  # Caddy إنتماء يقرأ docker-compose.override.yml تلقائياً. دفتر يكتب هذا الملف ليضيف نفسه؛
  # نضيف هذه المنصة إليه مع الحفاظ على دفتر، ونحتفظ بنسخة من الملف السابق للتراجع.
  OVERRIDE="$INTIMAA_DIR/deploy/docker-compose.override.yml"
  DAFTER_DOMAIN=""
  if [ -f "$OVERRIDE" ]; then
    grep -qE "Written by Dafter|Written by attendance-platform" "$OVERRIDE" \
      || die "$OVERRIDE موجود ولم يكتبه دفتر أو هذه المنصة. ادمجه يدوياً (انظر deploy/shared/)."
    DAFTER_DOMAIN="$(grep -m1 'DAFTER_DOMAIN:' "$OVERRIDE" | awk '{print $2}' || true)"
    cp "$OVERRIDE" "$OVERRIDE.bak-$(date +%Y%m%d%H%M%S)"
  fi
  mkdir -p "$APP_DIR/deploy/shared"
  SITE="$APP_DIR/deploy/shared/Caddyfile"
  {
    echo "# مولّد بواسطة deploy/install.sh — لا تعدّله يدوياً"
    if [ -n "$DAFTER_DOMAIN" ] && [ -f "$DAFTER_DIR/deploy/shared/Caddyfile" ]; then
      echo "# مواقع إنتماء ودفتر كما هي (ملف دفتر يستورد ملف إنتماء)"
      echo "import /etc/caddy/dafter.Caddyfile"
    else
      echo "# مواقع إنتماء كما هي"
      echo "import /etc/caddy/intimaa.Caddyfile"
    fi
    cat <<'CADDY'

{$ATTENDANCE_DOMAIN} {
	encode zstd gzip
	reverse_proxy attendance-app:3000
	request_body {
		max_size 6MB
	}
}
CADDY
  } > "$SITE"

  {
    echo "# Written by Dafter's deploy/install.sh and extended by attendance-platform's deploy/install.sh:"
    echo "# this Caddy also serves the other platforms on this server. Written by attendance-platform."
    echo "# بعد إعادة تشغيل سكربت تثبيت دفتر أعد تشغيل: sudo bash $APP_DIR/deploy/install.sh"
    echo "services:"
    echo "  caddy:"
    echo "    environment:"
    [ -n "$DAFTER_DOMAIN" ] && echo "      DAFTER_DOMAIN: $DAFTER_DOMAIN"
    echo "      ATTENDANCE_DOMAIN: $DOMAIN"
    echo "    volumes:"
    echo "      - ./Caddyfile:/etc/caddy/intimaa.Caddyfile:ro"
    [ -n "$DAFTER_DOMAIN" ] && echo "      - $DAFTER_DIR/deploy/shared/Caddyfile:/etc/caddy/dafter.Caddyfile:ro"
    echo "      - $SITE:/etc/caddy/Caddyfile:ro"
    echo "    networks: [default, edge]"
    echo ""
    echo "networks:"
    echo "  edge:"
    echo "    external: true"
    echo "    name: edge"
  } > "$OVERRIDE"

  restart_caddy() { (cd "$INTIMAA_DIR/deploy" && env -i PATH="$PATH" HOME="$HOME" docker compose up -d caddy); }
  rollback() {
    echo "التراجع إلى إعداد Caddy السابق…"
    LAST="$(ls -t "$OVERRIDE".bak-* 2>/dev/null | head -1 || true)"
    if [ -n "$LAST" ]; then cp "$LAST" "$OVERRIDE"; else rm -f "$OVERRIDE"; fi
    restart_caddy || true
    die "$1"
  }
  restart_caddy || rollback "تعذر إعادة تشغيل Caddy إنتماء."
  sleep 3
  (cd "$INTIMAA_DIR/deploy" && env -i PATH="$PATH" HOME="$HOME" docker compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1) \
    || rollback "إعداد Caddy غير صالح. راجع: cd $INTIMAA_DIR/deploy && docker compose logs caddy"
  echo "Caddy إنتماء يخدم الآن https://$DOMAIN أيضاً${DAFTER_DOMAIN:+ (ودفتر https://$DAFTER_DOMAIN كما هو)}."

elif [ "$MODE" = "behind-proxy" ]; then
  if command -v nginx >/dev/null; then
    sed -e "s/attendance.example.com/$DOMAIN/" -e "s/127.0.0.1:3100/127.0.0.1:$APP_PORT/" deploy/nginx.conf > /etc/nginx/sites-available/attendance
    ln -sf /etc/nginx/sites-available/attendance /etc/nginx/sites-enabled/attendance
    nginx -t && systemctl reload nginx
    if command -v certbot >/dev/null; then
      certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect || echo "شغّل certbot يدوياً: certbot --nginx -d $DOMAIN"
    else
      echo "ثبّت certbot ثم: certbot --nginx -d $DOMAIN"
    fi
  else
    echo "وجّه خادم الويب الموجود إلى http://127.0.0.1:$APP_PORT للنطاق $DOMAIN"
  fi
else
  if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q active; then
    ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
  fi
  echo "Caddy الخاص بالمنصة يصدر الشهادة عند أول زيارة."
fi

say "5/5 تم"
cat <<MSG
  افتح:          https://$DOMAIN   (سجّل حساب المدرسة الأولى من الصفحة الرئيسية)
  فحص الصحة:     https://$DOMAIN/healthz
  السجلات:       cd $APP_DIR && docker compose logs -f app
  التحديث:       cd $APP_DIR && sudo bash deploy/update.sh
  نسخة احتياطية: cd $APP_DIR && docker compose exec app node src/backup.js
MSG
[ "$NEW_INSTALL" = "1" ] && echo "  تأكد أن سجل DNS من نوع A للنطاق $DOMAIN يشير إلى عنوان هذا الخادم."
exit 0
