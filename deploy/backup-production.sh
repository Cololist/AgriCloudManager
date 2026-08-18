#!/usr/bin/env bash
set -euo pipefail

backup_dir=/opt/agricloud/backups
database=/opt/agricloud/backend/data/agricloud.sqlite
uploads=/opt/agricloud/backend/public/uploads
backup_stamp="$(date '+%Y%m%d-%H%M%S')"

install -d -m 700 "$backup_dir"

if [[ -f "$database" ]]; then
  sqlite3 "$database" ".backup '$backup_dir/agricloud-$backup_stamp.sqlite'"
  gzip "$backup_dir/agricloud-$backup_stamp.sqlite"
fi

if [[ -d "$uploads" ]]; then
  tar -czf "$backup_dir/uploads-$backup_stamp.tar.gz" -C "$uploads" .
fi

find "$backup_dir" -type f -name 'agricloud-*.sqlite.gz' -mtime +7 -delete
find "$backup_dir" -type f -name 'uploads-*.tar.gz' -mtime +7 -delete
