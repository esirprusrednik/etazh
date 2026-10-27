#!/usr/bin/env bash
# Установка «Этажа» прямо на сервере (из веб-консоли хостинга):
#   curl -sLO raw.githubusercontent.com/esirprusrednik/etazh/main/go.sh
#   bash go.sh
# Файлы качаются по одному с raw.githubusercontent.com — это работает, даже когда github.com недоступен.
set -e
RAW=https://raw.githubusercontent.com/esirprusrednik/etazh/main
D=/opt/etazh
get() { curl -fsSL --retry 5 --retry-delay 2 --retry-all-errors --connect-timeout 20 "$1" -o "$2"; }
echo "==> Скачиваю проект"
get "$RAW/files.txt" /tmp/etazh-files.txt
n=0
while read -r f; do
  [ -z "$f" ] && continue
  mkdir -p "$D/$(dirname "$f")"
  get "$RAW/$f" "$D/$f"
  n=$((n+1))
done < /tmp/etazh-files.txt
echo "    скачано файлов: $n"
cd "$D"
ETAZH_DOMAIN=moietazh.ru ETAZH_ADMINS=yskasyan@mts.ru bash scripts/install.sh 2>&1 | tee /root/etazh-install.log
