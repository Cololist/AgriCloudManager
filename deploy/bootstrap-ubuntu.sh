#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y ca-certificates curl xz-utils nginx certbot python3-certbot-nginx

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]]; then
  node_install_dir="$(mktemp -d)"
  trap 'rm -rf "$node_install_dir"' EXIT
  cd "$node_install_dir"

  curl --fail --silent --show-error --location --remote-name \
    https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt
  node_archive="$(awk '/node-v24.*-linux-x64\.tar\.xz$/ { print $2 }' SHASUMS256.txt | tail -n 1)"
  if [[ -z "$node_archive" ]]; then
    printf 'Unable to determine the latest Node.js 24 Linux x64 archive.\n' >&2
    exit 1
  fi

  curl --fail --silent --show-error --location --remote-name \
    "https://nodejs.org/dist/latest-v24.x/$node_archive"
  grep " $node_archive\$" SHASUMS256.txt | sha256sum --check --strict

  install -d /opt/nodejs
  tar -xJf "$node_archive" -C /opt/nodejs
  node_folder="${node_archive%.tar.xz}"
  ln -sfn "/opt/nodejs/$node_folder" /opt/nodejs/current
  ln -sfn /opt/nodejs/current/bin/node /usr/local/bin/node
  ln -sfn /opt/nodejs/current/bin/npm /usr/local/bin/npm
  ln -sfn /opt/nodejs/current/bin/npx /usr/local/bin/npx
  ln -sfn /opt/nodejs/current/bin/corepack /usr/local/bin/corepack
fi

npm install --global pm2
ln -sfn /opt/nodejs/current/bin/pm2 /usr/local/bin/pm2
ln -sfn /opt/nodejs/current/bin/pm2-runtime /usr/local/bin/pm2-runtime
pm2 startup systemd --user root --hp /root

systemctl enable nginx
systemctl restart nginx

install -d \
  /opt/agricloud/frontend \
  /opt/agricloud/backend/data \
  /opt/agricloud/backend/public/uploads \
  /opt/agricloud/backend/deploy

printf 'Node: %s\n' "$(node --version)"
printf 'npm: %s\n' "$(npm --version)"
printf 'Nginx: %s\n' "$(nginx -v 2>&1)"
printf 'PM2: %s\n' "$(pm2 --version)"
