#!/usr/bin/env bash
# Create drag-to-Applications DMG from assembled .app
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIST="${ROOT}/dist/macos"
APP="${DIST}/AutoDayTrader.app"
STAGE="${DIST}/dmg-stage"
DMG_RW="${DIST}/AutoDayTrader.rw.dmg"
DMG="${DIST}/AutoDayTrader.dmg"
VOL="AutoDayTrader"

if [[ ! -d "${APP}" ]]; then
  echo "Missing ${APP}; run assemble-app.sh first" >&2
  exit 1
fi

rm -rf "${STAGE}" "${DMG_RW}" "${DMG}"
mkdir -p "${STAGE}"
cp -R "${APP}" "${STAGE}/"
ln -s /Applications "${STAGE}/Applications"

# Prefer create-dmg if installed; else hdiutil
if command -v create-dmg >/dev/null 2>&1; then
  create-dmg \
    --volname "${VOL}" \
    --window-pos 200 120 \
    --window-size 600 400 \
    --icon-size 100 \
    --icon "AutoDayTrader.app" 150 200 \
    --app-drop-link 450 200 \
    "${DMG}" \
    "${STAGE}"
else
  hdiutil create -volname "${VOL}" -srcfolder "${STAGE}" -ov -format UDRW "${DMG_RW}"
  hdiutil convert "${DMG_RW}" -format ULMO -o "${DMG}"
  rm -f "${DMG_RW}"
fi

echo "==> DMG ready: ${DMG}"
