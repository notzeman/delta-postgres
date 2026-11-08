#!/bin/sh
set -eu

APP_UID="${APP_UID:-1000}"
APP_GID="${APP_GID:-1000}"
DOCKER_GID="${DOCKER_GID:-988}"

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

exec setpriv --reuid="$APP_UID" --regid="$APP_GID" --init-groups "$@"
