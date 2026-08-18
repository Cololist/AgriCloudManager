#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y sqlite3
timedatectl set-timezone Asia/Shanghai

if [[ ! -f /swapfile ]]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
fi

if ! swapon --show=NAME --noheadings | grep -qx '/swapfile'; then
  swapon /swapfile
fi

if ! grep -q '^/swapfile none swap sw 0 0$' /etc/fstab; then
  printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
fi

install -m 755 /root/backup-production.sh /usr/local/sbin/agricloud-backup
printf '17 3 * * * root /usr/local/sbin/agricloud-backup\n' > /etc/cron.d/agricloud-backup
chmod 644 /etc/cron.d/agricloud-backup

/usr/local/sbin/agricloud-backup

printf 'Timezone: %s\n' "$(timedatectl show --property=Timezone --value)"
printf 'Swap:\n'
swapon --show
printf 'Backups:\n'
find /opt/agricloud/backups -maxdepth 1 -type f -printf '%f %s bytes\n'
