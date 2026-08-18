#!/usr/bin/env bash
set -euo pipefail

frontend_dir=/opt/agricloud/frontend
backend_dir=/opt/agricloud/backend
nginx_site=/etc/nginx/sites-available/agricloud.conf
nginx_enabled=/etc/nginx/sites-enabled/agricloud.conf

install -d "$frontend_dir" "$backend_dir/data" "$backend_dir/public/uploads"
# H5 assets use content hashes. Remove the previous release before extracting
# so a cached old index cannot keep loading obsolete bundles left on disk.
find "$frontend_dir" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
tar -xzf /root/frontend.tar.gz -C "$frontend_dir"
tar -xzf /root/backend.tar.gz -C "$backend_dir"

if [[ ! -f "$backend_dir/data/agricloud.sqlite" ]]; then
  install -m 600 /root/agricloud.sqlite "$backend_dir/data/agricloud.sqlite"
fi

if [[ ! -f "$backend_dir/.env" ]]; then
  install -m 600 /root/backend.env.production.example "$backend_dir/.env"
fi

if grep -q '^JWT_SECRET=$' "$backend_dir/.env"; then
  agricloud_jwt_secret="$(openssl rand -hex 48)"
  sed -i "s/^JWT_SECRET=$/JWT_SECRET=$agricloud_jwt_secret/" "$backend_dir/.env"
fi
chmod 600 "$backend_dir/.env"

cd "$backend_dir"
npm ci --omit=dev

install -m 644 /root/nginx.conf "$nginx_site"
ln -sfn "$nginx_site" "$nginx_enabled"
if [[ -L /etc/nginx/sites-enabled/default ]]; then
  unlink /etc/nginx/sites-enabled/default
fi
nginx -t
systemctl reload nginx

if pm2 describe agricloud-api >/dev/null 2>&1; then
  pm2 restart agricloud-api --update-env
else
  pm2 start server.js --name agricloud-api --update-env
fi
pm2 save

for attempt in $(seq 1 20); do
  if curl --fail --silent http://127.0.0.1:3000/api/health >/dev/null; then
    printf 'AgriCloud API is healthy.\n'
    exit 0
  fi
  sleep 1
done

pm2 logs agricloud-api --lines 80 --nostream
exit 1
