#!/usr/bin/env bash
# Установка «Этажа» одной командой прямо на сервере (из веб-консоли хостинга):
#   bash <(curl -sL https://raw.githubusercontent.com/esirprusrednik/etazh/main/go.sh)
set -e
apt-get update -q && apt-get install -yq git
if [ -d /opt/etazh/.git ]; then cd /opt/etazh && git pull; else rm -rf /opt/etazh && git clone https://github.com/esirprusrednik/etazh /opt/etazh; fi
cd /opt/etazh
ETAZH_DOMAIN=moietazh.ru ETAZH_ADMINS=yskasyan@mts.ru bash scripts/install.sh 2>&1 | tee /root/etazh-install.log
