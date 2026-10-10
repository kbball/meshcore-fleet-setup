#!/usr/bin/env bash
# Build a self-contained offline bundle: the app, the firmware and a tiny local server.
#
#   scripts/bundle.sh [firmware-dir]     (default: ./firmware, with manifest.json from build-firmware-manifest.mjs)
#
# Output: dist-bundle/fleet-setup-<VERSION>.zip. On the event laptop: unzip, run `python3 serve.py`.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(cat VERSION)
FW=${1:-firmware}
[ -f "$FW/manifest.json" ] || { echo "no $FW/manifest.json; build one with scripts/build-firmware-manifest.mjs" >&2; exit 1; }

(cd web && npm ci && npm run build)
STAGE=dist-bundle/fleet-setup-$VERSION
rm -rf dist-bundle && mkdir -p "$STAGE"
cp -R web/dist/. "$STAGE/"
rm -f "$STAGE/.gitkeep"
rm -rf "$STAGE/firmware" && cp -R "$FW" "$STAGE/firmware"
cp scripts/serve.py "$STAGE/serve.py"
cat > "$STAGE/README.txt" <<TXT
MeshCore Fleet Setup $VERSION (offline bundle)
1. Install Python 3 if the laptop does not have it.
2. Run:  python3 serve.py      (opens http://localhost:8080 in your browser)
3. Use Chrome or Edge. Load your profile file, plug in a node, run.
No internet is needed. Profiles contain channel keys: keep them off shared drives.
TXT
(cd dist-bundle && zip -qr "fleet-setup-$VERSION.zip" "fleet-setup-$VERSION")
echo "wrote dist-bundle/fleet-setup-$VERSION.zip"
