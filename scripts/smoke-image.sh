#!/usr/bin/env bash
# Run the built image and push real requests through it.
#   scripts/smoke-image.sh <image> <expected-version>
set -euo pipefail

IMAGE=${1:?usage: smoke-image.sh <image> <version>}
WANT=${2:?usage: smoke-image.sh <image> <version>}
NAME=fleetsetup-smoke-$$
TMP=$(mktemp -d)
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT

# a firmware directory with a manifest whose checksum is right
mkdir -p "$TMP/fw/v1"
printf 'PK-smoke' >"$TMP/fw/v1/e.zip"
SUM=$(printf 'PK-smoke' | (sha256sum 2>/dev/null || shasum -a 256) | cut -d' ' -f1)
cat >"$TMP/fw/manifest.json" <<JSON
{"entries":[{"board":"b","env":"e","kind":"tracker","version":"v1","file":"v1/e.zip","sha256":"$SUM"}]}
JSON
chmod -R a+rX "$TMP/fw"

docker run -d --name "$NAME" -p 127.0.0.1::8080 -v "$TMP/fw:/firmware:ro" "$IMAGE" >/dev/null
PORT=$(docker port "$NAME" 8080/tcp | head -1 | sed 's/.*://')
BASE=http://127.0.0.1:$PORT

for _ in $(seq 1 30); do
  curl -fsS "$BASE/healthz" >/dev/null 2>&1 && break
  sleep 1
done

fail() { echo "SMOKE FAIL: $*" >&2; docker logs "$NAME" >&2 || true; exit 1; }

curl -fsS "$BASE/healthz" | grep -q "\"version\":\"$WANT\"" || fail "healthz does not report version $WANT"
curl -fsS "$BASE/" | grep -qi '<div id="root">' || fail "index.html is not the app"
HEADERS=$(curl -fsSI "$BASE/")
echo "$HEADERS" | grep -qi '^content-security-policy:' || fail "no CSP header"
curl -fsS "$BASE/firmware/manifest.json" | grep -q "$SUM" || fail "manifest not served"
GOT=$(curl -fsS "$BASE/firmware/v1/e.zip")
[ "$GOT" = "PK-smoke" ] || fail "firmware zip not served intact"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/firmware/v1/")" = 404 ] || fail "directory listing is exposed"
LOGS=$(docker logs "$NAME" 2>&1)
grep -q '"status":"ok"' <<<"$LOGS" || fail "server did not report the firmware as ok"
[ "$(docker inspect -f '{{.Config.User}}' "$IMAGE")" != "root" ] || fail "image runs as root"
echo "smoke ok: $IMAGE"
