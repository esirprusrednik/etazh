#!/usr/bin/env bash
# Установка «Этажа» прямо на сервере (из веб-консоли хостинга):
#   curl -sLO raw.githubusercontent.com/esirprusrednik/etazh/main/go.sh
#   bash go.sh
# Файлы качаются по одному с raw.githubusercontent.com — это работает, даже когда github.com недоступен.
set -e
D=/opt/etazh
get() { curl -fsSL --retry 5 --retry-delay 2 --retry-all-errors --connect-timeout 20 "$1" -o "$2"; }
# raw.githubusercontent.com отдаёт ветку main из кэша до 5 минут после пуша — тогда ставится старая версия.
# Поэтому сначала узнаём номер последнего коммита и качаем файлы ровно этого коммита (такие ссылки не устаревают).
SHA=$(curl -fsSL --connect-timeout 10 -H 'Accept: application/vnd.github.sha' https://api.github.com/repos/esirprusrednik/etazh/commits/main 2>/dev/null || true)
if echo "$SHA" | grep -Eq '^[0-9a-f]{40}$'; then
  RAW=https://raw.githubusercontent.com/esirprusrednik/etazh/$SHA
  echo "==> Версия: ${SHA:0:7}"
else
  RAW=https://raw.githubusercontent.com/esirprusrednik/etazh/main
  echo "==> Не удалось узнать номер версии (api.github.com недоступен) — беру main; если только что был пуш, подожди 5 минут и повтори"
fi
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
echo "${SHA:-main}" > "$D/VERSION"
cd "$D"
ETAZH_DOMAIN=moietazh.ru ETAZH_ADMINS=yskasyan@mts.ru bash scripts/install.sh 2>&1 | tee /root/etazh-install.log
