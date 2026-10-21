#!/bin/sh
set -eu

DATA="${DATA_DIR:-/data}"
PUID="${PUID:-99}"
PGID="${PGID:-100}"

log() {
  printf '{"t":"%s","level":"%s","msg":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" "$1" "$2"
}

is_number() {
  case "$1" in
    "" | *[!0-9]*) return 1 ;;
    *) return 0 ;;
  esac
}

has_setid_caps() {
  caps=$(sed -n 's/^CapEff:[[:space:]]*//p' /proc/self/status)
  [ $(((0x$caps >> 6) & 3)) -eq 3 ]
}

if [ "$(id -u)" != "0" ]; then
  exec "$@"
fi

if ! is_number "$PUID" || ! is_number "$PGID"; then
  log error "PUID and PGID must be numbers, got PUID=$PUID PGID=$PGID"
  exit 1
fi

if ! has_setid_caps; then
  log error "The container runs as root without the SETUID and SETGID capabilities (--cap-drop=ALL). Either remove --cap-drop=ALL and set PUID and PGID, or keep it and add --user $PUID:$PGID. See CHANGELOG.md, v2026.10.13."
  exit 1
fi

mkdir -p "$DATA"
if [ "$(stat -c %u:%g "$DATA")" != "$PUID:$PGID" ]; then
  if chown -R "$PUID:$PGID" "$DATA" 2>/dev/null; then
    log info "data folder $DATA given to $PUID:$PGID"
  else
    log warn "could not give $DATA to $PUID:$PGID; the app may not be able to write there"
  fi
fi

exec su-exec "$PUID:$PGID" "$@"
