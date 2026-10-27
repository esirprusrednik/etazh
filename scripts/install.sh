#!/usr/bin/env bash
# Установка «Этажа» на чистый сервер Ubuntu 22.04 / 24.04 (запускать от root из папки проекта):
#   sudo bash scripts/install.sh
# Повторный запуск безопасен: уже сделанные шаги пропускаются, .env не перезаписывается.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"
say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mОшибка: %s\033[0m\n' "$*"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "запустите через sudo"
grep -qiE 'ubuntu|debian' /etc/os-release || die "скрипт рассчитан на Ubuntu/Debian"

say "1/7 Обновление системы и базовые пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -yq ca-certificates curl ufw fail2ban unattended-upgrades dnsutils
dpkg-reconfigure -f noninteractive unattended-upgrades || true

say "2/7 Docker"
if ! command -v docker >/dev/null; then
  # Сначала из репозиториев Ubuntu (доступны из РФ стабильнее), иначе — официальный скрипт Docker
  apt-get install -yq docker.io docker-compose-v2 || curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi
docker compose version >/dev/null || die "docker compose не установился"
# Запасное зеркало Docker Hub на случай ограничений загрузки образов
if [ ! -f /etc/docker/daemon.json ]; then
  mkdir -p /etc/docker
  echo '{ "registry-mirrors": ["https://mirror.gcr.io"] }' > /etc/docker/daemon.json
  systemctl restart docker
fi
docker pull -q node:22-alpine >/dev/null && docker pull -q caddy:2-alpine >/dev/null || die "не удалось скачать образы Docker — пришлите этот лог"

say "3/7 Файрвол: открыты только SSH, 80, 443"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
systemctl enable --now fail2ban >/dev/null

say "4/7 Вход по SSH только по ключу"
if [ -s /root/.ssh/authorized_keys ] || ls /home/*/.ssh/authorized_keys >/dev/null 2>&1; then
  mkdir -p /etc/ssh/sshd_config.d
  printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\n' > /etc/ssh/sshd_config.d/90-etazh.conf
  systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
  echo "Вход по паролю отключён."
else
  echo "SSH-ключей не найдено — вход по паролю оставлен, чтобы не потерять доступ. Добавьте ключ и запустите скрипт ещё раз."
fi

say "5/7 Настройки приложения (.env)"
if [ ! -f .env ]; then
  # Без терминала (запуск из скрипта) значения берутся из переменных ETAZH_DOMAIN, ETAZH_ADMINS
  if [ -n "${ETAZH_DOMAIN:-}" ]; then
    DOMAIN="$ETAZH_DOMAIN"; ADMINS="${ETAZH_ADMINS:-}"; SMTP_HOST=""
  else
    read -rp "Домен приложения (например etazh.example.ru): " DOMAIN
    read -rp "Почта модератора (через запятую, можно пусто): " ADMINS
    read -rp "SMTP-сервер (пусто = пока без почты, ссылки входа будут в логе): " SMTP_HOST
  fi
  MAIL_MODE=console; SMTP_PORT=465; SMTP_SECURE=ssl; SMTP_USER=""; SMTP_PASS=""; SMTP_FROM="Этаж <no-reply@${DOMAIN}>"
  if [ -n "$SMTP_HOST" ]; then
    MAIL_MODE=smtp
    read -rp "SMTP-порт [465]: " p; SMTP_PORT=${p:-465}
    [ "$SMTP_PORT" = "587" ] && SMTP_SECURE=starttls
    read -rp "SMTP-логин: " SMTP_USER
    read -rsp "SMTP-пароль (не отображается): " SMTP_PASS; echo
    read -rp "Отправитель [$SMTP_FROM]: " f; SMTP_FROM=${f:-$SMTP_FROM}
  fi
  SECRETS=$(docker run --rm -v "$APP_DIR":/app -w /app node:22-alpine node --no-warnings scripts/gen-secrets.js 2>/dev/null)
  umask 077
  cat > .env <<EOF
DOMAIN=$DOMAIN
BASE_URL=https://$DOMAIN
$SECRETS
VAPID_SUBJECT=mailto:${ADMINS%%,*}
ALLOWED_DOMAINS=mts.ru
ADMIN_EMAILS=$ADMINS
MAIL_MODE=$MAIL_MODE
SMTP_HOST=$SMTP_HOST
SMTP_PORT=$SMTP_PORT
SMTP_SECURE=$SMTP_SECURE
SMTP_USER=$SMTP_USER
SMTP_PASS=$SMTP_PASS
SMTP_FROM=$SMTP_FROM
SECURE_COOKIES=true
WELCOME_BEANS=50
EOF
  echo ".env создан (права 600)."
  echo "ВАЖНО: сохраните EMAIL_PEPPER из /opt/etazh/.env в менеджер паролей (команда: grep EMAIL_PEPPER /opt/etazh/.env)."
else
  echo ".env уже есть — не трогаю."
fi
DOMAIN=$(grep '^DOMAIN=' .env | cut -d= -f2)

say "6/7 Проверка DNS"
MYIP=$(curl -fsS4 https://ifconfig.me || true)
DNSIP=$(dig +short A "$DOMAIN" | tail -1)
echo "IP сервера: ${MYIP:-?}  ·  $DOMAIN указывает на: ${DNSIP:-(нет записи)}"
[ -n "$MYIP" ] && [ "$MYIP" != "$DNSIP" ] && echo "⚠️  A-запись домена ещё не указывает на сервер — HTTPS-сертификат не выпустится, пока она не обновится."

say "7/7 Запуск и бэкапы"
docker compose up -d --build
chmod +x scripts/backup.sh
CRON="15 3 * * * $APP_DIR/scripts/backup.sh >> /var/log/etazh-backup.log 2>&1"
( crontab -l 2>/dev/null | grep -v 'etazh/scripts/backup.sh'; echo "$CRON" ) | crontab -

for i in $(seq 1 30); do
  docker compose exec -T app wget -qO- http://127.0.0.1:3000/healthz >/dev/null 2>&1 && break
  sleep 2
done
docker compose exec -T app wget -qO- http://127.0.0.1:3000/healthz >/dev/null 2>&1 && echo "Приложение отвечает." || die "приложение не поднялось: docker compose logs app"
docker compose logs app | tail -3

say "Готово"
echo "Откройте https://$DOMAIN (сертификат появится в течение пары минут после того, как DNS укажет на сервер)."
echo "Логи: docker compose logs -f app · Обновление: git pull && docker compose up -d --build"
