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
BUILD="${BUILD:-1}"   # BUILD=0 لاستخدام صورة مبنية مسبقاً (للاختبار)

say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }
setenv() { # setenv KEY VALUE : يضيف أو يحدّث متغيراً في .env
  if grep -q "^$1=" "$ENV_FILE"; then sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"; else echo "$1=$2" >> "$ENV_FILE"; fi
}

[ "$(id -u)" -eq 0 ] || die "Run as root: sudo bash deploy/install.sh"

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
  echo "Intimaa found in $INTIMAA_DIR (https://$INTIMAA_DOMAIN): the platform will run behind its Caddy."
elif ss -ltn 2>/dev/null | grep -qE '[:.](80|443)\s'; then
  MODE=behind-proxy
  echo "Ports 80/443 are used by another web server: the platform will run behind it."
fi

say "2/5 Settings ($ENV_FILE)"
NEW_INSTALL=0
if [ ! -f "$ENV_FILE" ]; then
  NEW_INSTALL=1
  umask 077
  cp .env.example "$ENV_FILE"
  if [ "$MODE" = "shared" ]; then
    read -rp "Domain for the attendance platform [attendance.$INTIMAA_DOMAIN]: " DOMAIN
    DOMAIN="${DOMAIN:-attendance.$INTIMAA_DOMAIN}"
  else
    read -rp "Domain for the attendance platform (e.g. attendance.example.com): " DOMAIN
  fi
  [ -n "$DOMAIN" ] || die "A domain is required."
  read -rp "School time zone [Asia/Muscat]: " TZV
  read -rp "Country code for guardian phone numbers [968]: " CC
  setenv DOMAIN "$DOMAIN"
  setenv SCHOOL_TZ "${TZV:-Asia/Muscat}"
  setenv DEFAULT_COUNTRY_CODE "${CC:-968}"
  chmod 600 "$ENV_FILE"
else
  echo "Keeping the existing settings."
fi
# Settings added by later versions (asked once).
if ! grep -q '^SUPPORT_WHATSAPP=' "$ENV_FILE"; then
  read -rp "Your WhatsApp number for schools to contact you (e.g. 96890000000), or Enter to skip: " SW
  setenv SUPPORT_WHATSAPP "$SW"
fi
grep -q '^SUPPORT_EMAIL=' "$ENV_FILE" || setenv SUPPORT_EMAIL ""
grep -q '^REGISTRATION_MODE=' "$ENV_FILE" || setenv REGISTRATION_MODE request
case "$MODE" in
  shared)       setenv COMPOSE_FILE docker-compose.shared.yml ;;
  behind-proxy) setenv COMPOSE_FILE docker-compose.app-only.yml ;;
  standalone)   setenv COMPOSE_FILE docker-compose.yml ;;
esac
DOMAIN="$(grep -m1 '^DOMAIN=' "$ENV_FILE" | cut -d= -f2-)"
APP_PORT="$(grep -m1 '^APP_PORT=' "$ENV_FILE" | cut -d= -f2- || true)"; APP_PORT="${APP_PORT:-3100}"

say "3/5 Building and starting"
[ "$MODE" = "shared" ] && { docker network inspect edge >/dev/null 2>&1 || docker network create edge >/dev/null; }
if [ "$BUILD" = "1" ]; then docker compose build; fi
docker compose up -d --no-build
printf 'Waiting for the app'
for _ in $(seq 1 40); do
  if docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then echo ' ready.'; break; fi
  printf '.'; sleep 3
done
docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
  || die "The app did not become healthy. See: docker compose logs app"

# Platform owner account (you): approves schools and manages subscriptions at /owner.
if [ "$(docker compose exec -T app node src/cli.js owner:count 2>/dev/null | tr -d '[:space:]')" = "0" ]; then
  say "Platform owner account"
  read -rp "Your email (platform owner): " OWNER_EMAIL
  read -rp "Your name: " OWNER_NAME
  docker compose exec -T app node src/cli.js owner:create "$OWNER_EMAIL" "${OWNER_NAME:-Owner}" || echo "Create it later: docker compose exec app node src/cli.js owner:create you@example.com"
  echo "Log in at https://$DOMAIN/owner with the temporary password above, change it, then scan the QR code with Google/Microsoft Authenticator (two-step verification is required)."
fi

say "4/5 HTTPS"
if [ "$MODE" = "shared" ]; then
  # Intimaa's Caddy reads docker-compose.override.yml automatically. Other platforms (Dafter, PILL...)
  # add themselves there; we keep everything they added: whatever file is currently Caddy's main
  # config is re-mounted as attendance-prev.Caddyfile and our file imports it, then adds our site.
  OVERRIDE="$INTIMAA_DIR/deploy/docker-compose.override.yml"
  [ -f "$OVERRIDE" ] && cp "$OVERRIDE" "$OVERRIDE.bak-$(date +%Y%m%d%H%M%S)"
  mkdir -p "$APP_DIR/deploy/shared"
  SITE="$APP_DIR/deploy/shared/Caddyfile"
  cat > "$SITE" <<'CADDY'
# Generated by deploy/install.sh - do not edit by hand.
# The sites of the other platforms on this server, unchanged:
import /etc/caddy/attendance-prev.Caddyfile

{$ATTENDANCE_DOMAIN} {
	encode zstd gzip
	reverse_proxy attendance-app:3000
	request_body {
		max_size 6MB
	}
}
CADDY
  command -v python3 >/dev/null || apt-get install -y -qq python3 >/dev/null
  python3 "$APP_DIR/deploy/merge_override.py" "$OVERRIDE" "$SITE" "$DOMAIN" || die "Could not update $OVERRIDE (nothing was changed). Send its contents: cat $OVERRIDE"
  echo "Updated $OVERRIDE (backup kept next to it)."

  restart_caddy() { (cd "$INTIMAA_DIR/deploy" && env -i PATH="$PATH" HOME="$HOME" docker compose up -d caddy); }
  rollback() {
    echo "Rolling back to the previous Caddy settings..."
    LAST="$(ls -t "$OVERRIDE".bak-* 2>/dev/null | head -1 || true)"
    if [ -n "$LAST" ]; then cp "$LAST" "$OVERRIDE"; else rm -f "$OVERRIDE"; fi
    restart_caddy || true
    die "$1"
  }
  restart_caddy || rollback "Could not restart Intimaa's Caddy."
  sleep 3
  (cd "$INTIMAA_DIR/deploy" && env -i PATH="$PATH" HOME="$HOME" docker compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1) \
    || rollback "Invalid Caddy settings. See: cd $INTIMAA_DIR/deploy && docker compose logs caddy"
  echo "Intimaa's Caddy now serves https://$DOMAIN too; the other sites are unchanged."

elif [ "$MODE" = "behind-proxy" ]; then
  if command -v nginx >/dev/null; then
    sed -e "s/attendance.example.com/$DOMAIN/" -e "s/127.0.0.1:3100/127.0.0.1:$APP_PORT/" deploy/nginx.conf > /etc/nginx/sites-available/attendance
    ln -sf /etc/nginx/sites-available/attendance /etc/nginx/sites-enabled/attendance
    nginx -t && systemctl reload nginx
    if command -v certbot >/dev/null; then
      certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect || echo "Run certbot manually: certbot --nginx -d $DOMAIN"
    else
      echo "Install certbot, then: certbot --nginx -d $DOMAIN"
    fi
  else
    echo "Point your existing web server to http://127.0.0.1:$APP_PORT for $DOMAIN"
  fi
else
  if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q active; then
    ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
  fi
  echo "The platform's own Caddy issues the HTTPS certificate on the first visit."
fi

say "5/5 Done"
cat <<MSG
  Schools:     https://$DOMAIN          (schools send a subscription request here)
  Owner:       https://$DOMAIN/owner    (approve schools, manage subscriptions)
  Health:      https://$DOMAIN/healthz
  Logs:        cd $APP_DIR && docker compose logs -f app
  Update:      cd $APP_DIR && sudo bash deploy/update.sh
  Backup now:  cd $APP_DIR && docker compose exec app node src/backup.js
  Owner reset: cd $APP_DIR && docker compose exec app node src/cli.js owner:create you@example.com
  Lost phone:  cd $APP_DIR && docker compose exec app node src/cli.js owner:reset-2fa you@example.com
MSG
[ "$NEW_INSTALL" = "1" ] && echo "  Make sure the DNS A record of $DOMAIN points to this server."
exit 0
