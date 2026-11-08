#!/bin/sh
set -eu

# Optional overrides. If not provided, detect the host-side owner of the
# bind-mounted data directories and the GID of the mounted Docker socket.
DETECTED_UID=""
DETECTED_GID=""
for candidate in /data /backups; do
  if [ -d "$candidate" ]; then
    candidate_uid="$(stat -c '%u' "$candidate" 2>/dev/null || echo '')"
    candidate_gid="$(stat -c '%g' "$candidate" 2>/dev/null || echo '')"
    if [ -n "$candidate_uid" ] && [ "$candidate_uid" != "0" ]; then
      DETECTED_UID="$candidate_uid"
      DETECTED_GID="$candidate_gid"
      break
    fi
  fi
done
if [ -z "$DETECTED_UID" ]; then
  DETECTED_UID=1000
  DETECTED_GID=1000
fi

APP_UID="${APP_UID:-$DETECTED_UID}"
APP_GID="${APP_GID:-$DETECTED_GID}"
DOCKER_GID="${DOCKER_GID:-$(stat -c '%g' /var/run/docker.sock 2>/dev/null || echo 988)}"

echo "Runtime identity: uid=${APP_UID} gid=${APP_GID} docker_gid=${DOCKER_GID}"

# Ensure the runtime GID exists.
if ! getent group "$APP_GID" >/dev/null 2>&1; then
  groupadd -g "$APP_GID" app
fi
APP_GROUP="$(getent group "$APP_GID" | cut -d: -f1)"

# Ensure the runtime UID has a passwd entry (Borg uses getpwuid).
if ! getent passwd "$APP_UID" >/dev/null 2>&1; then
  useradd -u "$APP_UID" -g "$APP_GROUP" -M -s /usr/sbin/nologin app
fi
APP_USER="$(getent passwd "$APP_UID" | cut -d: -f1)"

# Make sure the runtime user can reach the mounted Docker socket.
if ! getent group "$DOCKER_GID" >/dev/null 2>&1; then
  groupadd -g "$DOCKER_GID" dockersock
fi
DOCKER_GROUP="$(getent group "$DOCKER_GID" | cut -d: -f1)"
usermod -aG "$DOCKER_GROUP" "$APP_USER" >/dev/null 2>&1 || true

mkdir -p /data /backups
chown "$APP_UID:$APP_GID" /data /backups 2>/dev/null || true
umask 0022

# Apply the dashboard-managed timezone to the container environment on restart.
if [ -n "${DATABASE_URL:-}" ] && command -v psql >/dev/null 2>&1; then
  DB_TIMEZONE="$(psql "$DATABASE_URL" -Atc "SELECT value #>> '{}' FROM settings WHERE key = 'timezone'" 2>/dev/null || true)"
  if [ -n "$DB_TIMEZONE" ]; then
    export TZ="$DB_TIMEZONE"
    if [ -f "/usr/share/zoneinfo/$DB_TIMEZONE" ]; then
      ln -snf "/usr/share/zoneinfo/$DB_TIMEZONE" /etc/localtime
      printf '%s\n' "$DB_TIMEZONE" > /etc/timezone
    fi
  fi
fi

exec setpriv --reuid="$APP_UID" --regid="$APP_GID" --init-groups "$@"
