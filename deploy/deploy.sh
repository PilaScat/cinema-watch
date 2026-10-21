#!/bin/sh
set -eu

HOST="${UNRAID_HOST:-root@192.168.1.20}"
TEMPLATE_URL="https://raw.githubusercontent.com/PilaScat/unraid-templates/main/cinema-watch/cinema-watch.xml"
TEMPLATES_DIR="/boot/config/plugins/dockerMan/templates-user"
SERVICE="svc:cinema-watch"
PORT=8790

if grep -q "$(printf '\r')" "$0"; then
  echo "Fine riga CRLF in $0: convertirlo in LF prima di lanciarlo"
  exit 1
fi

if ssh "$HOST" "test -e '$TEMPLATES_DIR/my-cinema-watch.xml'"; then
  echo "Template già presente: lo lascio com'è, contiene i valori impostati in Unraid"
else
  ssh "$HOST" "curl -fsSL '$TEMPLATE_URL' -o '$TEMPLATES_DIR/my-cinema-watch.xml'"
  echo "Template scaricato in $TEMPLATES_DIR/my-cinema-watch.xml"
fi

if ssh "$HOST" "tailscale serve status 2>/dev/null | grep -q '($SERVICE)'"; then
  echo "$SERVICE già pubblicato"
else
  ssh "$HOST" "tailscale serve --service=$SERVICE --https=443 --bg http://localhost:$PORT"
  echo "$SERVICE pubblicato verso http://localhost:$PORT"
fi
