#!/bin/sh
set -u
export MSYS_NO_PATHCONV=1

PLATFORM="${PLATFORM:-linux/amd64}"
IMAGE="${IMAGE:-cinema-watch:smoke}"
NAME="cinema-watch-smoke"
VOLUME="cinema-watch-smoke"
PORT="${SMOKE_PORT:-18790}"
BASE="http://127.0.0.1:$PORT"
MAX_SIZE_MB=200
MAX_RAM_MB=100
FAILED=0

pass() { echo "ok   $1"; }
fail() { echo "FAIL $1"; FAILED=1; }
check() { if [ "$2" = "0" ]; then pass "$1"; else fail "$1"; fi; }

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker volume rm -f "$VOLUME" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  docker build -q --platform "$PLATFORM" --build-arg VERSION=v0.0.0-smoke -t "$IMAGE" . >/dev/null
fi

size=$(docker run --rm --platform "$PLATFORM" --entrypoint du "$IMAGE" -sxm / 2>/dev/null | tail -1 | cut -f1)
[ "$size" -lt "$MAX_SIZE_MB" ]; check "immagine ${size} MB (limite $MAX_SIZE_MB)" $?

docker volume create "$VOLUME" >/dev/null
docker run --rm --platform "$PLATFORM" --entrypoint sh -u 0 -v "$VOLUME:/data" "$IMAGE" -c "chown 99:100 /data"

run_hardened() {
  docker run --platform "$PLATFORM" --read-only --cap-drop=ALL --security-opt=no-new-privileges --tmpfs /tmp -v "$VOLUME:/data" "$@"
}

run_hardened -d --name "$NAME" -p "$PORT:8790" "$IMAGE" >/dev/null
health=starting
for _ in $(seq 1 40); do
  health=$(docker inspect -f '{{.State.Health.Status}}' "$NAME")
  [ "$health" = "healthy" ] && break
  sleep 3
done
[ "$health" = "healthy" ]; check "healthy in sola lettura con cap-drop=ALL" $?

status=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")
[ "$status" = "200" ]; check "home 200" $?
curl -s "$BASE/api/status" | grep -q '"version":"v0.0.0-smoke"'; check "/api/status con la versione dell'immagine" $?

movie=$(curl -s "$BASE/api/movies?theatres=uci-cinemas-verona" | sed 's/},{/}\n{/g' | grep "\"firstDay\":\"$(date +%F)\"" | head -1 | sed -n 's/.*"slug":"\([a-z0-9-]*\)".*/\1/p')
[ -n "$movie" ]; check "film in programmazione a Verona: ${movie:-nessuno}" $?

created=$(curl -s -o /dev/null -w '%{http_code}' -H "Origin: $BASE" \
  --data-urlencode "name=Smoke" \
  --data-urlencode "theatre=uci-cinemas-verona" \
  --data-urlencode "movieKind=listed" \
  --data-urlencode "movieListed=$movie" \
  --data-urlencode "windowKind=next" \
  --data-urlencode "windowDays=14" \
  --data-urlencode "together=3" \
  --data-urlencode "threshold=10" \
  --data-urlencode "notify=newShowings" \
  --data-urlencode "enabled=1" \
  "$BASE/hunts")
[ "$created" = "303" ]; check "caccia aggiunta dal form" $?

perms=$(docker exec "$NAME" stat -c '%a %u:%g' /data/config.json)
[ "$perms" = "600 99:100" ]; check "config.json $perms" $?
owner=$(docker exec "$NAME" stat -c '%u:%g' /data)
[ "$owner" = "99:100" ]; check "/data $owner" $?

sleep 5
ram=$(docker stats --no-stream --format '{{.MemUsage}}' "$NAME" | sed 's/MiB.*//' | cut -d. -f1)
host=$(docker info --format '{{.Architecture}}' | sed 's/x86_64/amd64/; s/aarch64/arm64/')
if [ "linux/$host" = "$PLATFORM" ]; then
  [ "$ram" -lt "$MAX_RAM_MB" ]; check "RAM ${ram} MiB (limite $MAX_RAM_MB)" $?
else
  echo "--   RAM ${ram} MiB non misurata: $PLATFORM emulata su $host"
fi

docker stop -t 20 "$NAME" >/dev/null
docker logs "$NAME" 2>&1 | grep -q '"msg":"stopped"'; check "arresto pulito su SIGTERM" $?
errors=$(docker logs "$NAME" 2>&1 | grep -c '"level":"error"' || true)
[ "$errors" = "0" ]; check "log senza errori ($errors)" $?

started=$(date +%s)
run_hardened --rm "$IMAGE" node dist/server.js --dry-run >/dev/null 2>&1; dry=$?
check "giro completo a secco contro le API vere in $(( $(date +%s) - started )) s" $dry
pngs=$(docker run --rm --platform "$PLATFORM" --entrypoint sh -v "$VOLUME:/data" "$IMAGE" -c 'ls /data/dry-run/*.png 2>/dev/null | wc -l')
messages=$(docker run --rm --platform "$PLATFORM" --entrypoint sh -v "$VOLUME:/data" "$IMAGE" -c 'ls /data/dry-run/messages-*.json 2>/dev/null | wc -l')
[ "$messages" -ge 1 ] && [ "$pngs" -ge 1 ]; check "messaggi ($messages) e piante PNG ($pngs) del giro" $?

if [ "$FAILED" = "0" ]; then echo "smoke $PLATFORM: tutto ok"; else echo "smoke $PLATFORM: qualcosa non va"; fi
exit "$FAILED"
