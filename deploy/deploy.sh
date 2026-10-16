#!/bin/sh
set -eu

HOST="${UNRAID_HOST:-root@192.168.1.20}"
APPDATA="/mnt/cache/appdata/cinema-watch"
TEMPLATE="$(dirname "$0")/cinema-watch.xml"
TEMPLATES_DIR="/boot/config/plugins/dockerMan/templates-user"
SERVICE="svc:cinema-watch"
PORT=8790

if grep -q "$(printf '\r')" "$TEMPLATE" "$0"; then
  echo "Fine riga CRLF in $TEMPLATE o in $0: convertirli in LF prima di copiarli"
  exit 1
fi

scp -q "$TEMPLATE" "$HOST:$TEMPLATES_DIR/my-cinema-watch.xml"
echo "Template copiato in $TEMPLATES_DIR/my-cinema-watch.xml"

ssh "$HOST" "mkdir -p '$APPDATA' && chown 99:100 '$APPDATA' && chmod 750 '$APPDATA' && stat -c '%a %u:%g %n' '$APPDATA'"

if ssh "$HOST" "tailscale serve status 2>/dev/null | grep -q '($SERVICE)'"; then
  echo "$SERVICE già pubblicato"
else
  ssh "$HOST" "tailscale serve --service=$SERVICE --https=443 --bg http://localhost:$PORT"
  echo "$SERVICE pubblicato verso http://localhost:$PORT"
fi
