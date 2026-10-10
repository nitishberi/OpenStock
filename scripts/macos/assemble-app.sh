#!/usr/bin/env bash
# Assemble AutoDayTrader.app layout (arm64). Run on Mac mini.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DESKTOP="${ROOT}/apps/desktop"
DIST="${ROOT}/dist/macos"
APP_NAME="AutoDayTrader"
APP="${DIST}/${APP_NAME}.app"
CONTENTS="${APP}/Contents"
MACOS="${CONTENTS}/MacOS"
RES="${CONTENTS}/Resources"
VERSION="${APP_VERSION:-0.1.0}"
BUNDLE_ID="${APP_BUNDLE_ID:-com.autodaytrader.app}"

echo "==> Assembling ${APP}"
rm -rf "${APP}"
mkdir -p "${MACOS}" "${RES}/app" "${RES}/node" "${RES}/python" "${RES}/scrapling-worker"

# Prefer vendored Node (from vendor-runtimes.sh) so native addons match the
# bundled runtime — Homebrew Node 26+ breaks better-sqlite3 prebuilds.
VENDOR_NODE_BIN="${DIST}/vendor/node/bin"
if [[ -x "${VENDOR_NODE_BIN}/node" ]]; then
  export PATH="${VENDOR_NODE_BIN}:${PATH}"
  echo "    Using vendored Node $($VENDOR_NODE_BIN/node -v)"
fi

# Build desktop app
(
  cd "${DESKTOP}"
  npm ci
  npm run build:ui
  # Keep server as TS sources + tsx for path aliases to lib/forecast
  mkdir -p dist/server-src
  cp -R src/server/. dist/server-src/
  cp package.json tsconfig.json tsconfig.server.json vitest.config.ts dist/ 2>/dev/null || true
  # Ship lockfile so first-run / host packs can npm ci --omit=dev against Node 22
  cp package-lock.json dist/ 2>/dev/null || true
)

# Copy app payload
# Vite outDir is dist/client — Hono serves process.cwd()/dist/client (cwd=Resources/app).
# Keep a legacy `client/` copy so older servers still find index.html.
if [[ ! -f "${DESKTOP}/dist/client/index.html" ]]; then
  echo "ERROR: missing ${DESKTOP}/dist/client/index.html — run npm run build:ui first" >&2
  exit 1
fi
mkdir -p "${RES}/app/dist"
rsync -a --delete "${DESKTOP}/dist/client/" "${RES}/app/dist/client/"
rsync -a --delete "${DESKTOP}/dist/client/" "${RES}/app/client/"
rsync -a --delete "${DESKTOP}/src/server/" "${RES}/app/server/"
cp "${DESKTOP}/package.json" "${RES}/app/"
cp "${DESKTOP}/tsconfig.json" "${RES}/app/"
cp "${DESKTOP}/package-lock.json" "${RES}/app/" 2>/dev/null || true
# Shared OpenStock forecast libs (read-only slice)
mkdir -p "${RES}/app/lib" "${RES}/app/config"
rsync -a "${ROOT}/lib/forecast/" "${RES}/app/lib/forecast/"
rsync -a "${ROOT}/lib/pricing/" "${RES}/app/lib/pricing/"
rsync -a "${ROOT}/lib/news/" "${RES}/app/lib/news/" 2>/dev/null || true
cp "${ROOT}/config/forecast-universe-100.json" "${RES}/app/config/" 2>/dev/null || true

# Vendor Node + Python if present (populated by vendor-runtimes.sh)
if [[ -d "${DIST}/vendor/node" ]]; then
  rsync -a "${DIST}/vendor/node/" "${RES}/node/"
fi
if [[ -d "${DIST}/vendor/python" ]]; then
  rsync -a "${DIST}/vendor/python/" "${RES}/python/"
fi
if [[ -d "${ROOT}/services/scrapling-worker" ]]; then
  rsync -a \
    --exclude '__pycache__' --exclude '.venv' --exclude 'fixtures' \
    "${ROOT}/services/scrapling-worker/" "${RES}/scrapling-worker/"
fi

# Bake production node_modules so LaunchAgent (no Homebrew PATH) can start
# without a first-run npm install.
if [[ -x "${DIST}/vendor/node/bin/npm" ]]; then
  echo "==> Installing production node_modules into app Resources"
  (
    cd "${RES}/app"
    "${DIST}/vendor/node/bin/npm" ci --omit=dev
  )
elif [[ -d "${DESKTOP}/node_modules" ]]; then
  echo "==> Copying desktop node_modules (filter to runtime) via npm ci preferred next time"
  rsync -a "${DESKTOP}/node_modules/" "${RES}/app/node_modules/"
fi

# Info.plist
cat > "${CONTENTS}/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>${APP_NAME}</string>
  <key>CFBundleDisplayName</key><string>${APP_NAME}</string>
  <key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>AutoDayTrader</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSUserNotificationAlertStyle</key><string>alert</string>
</dict>
</plist>
PLIST

# Launcher
cat > "${MACOS}/AutoDayTrader" <<'LAUNCH'
#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RES="${ROOT}/Resources"
export AUTODAYTRADER_RESOURCES="${RES}"
export AUTODAYTRADER_SPAWN_WORKER="${AUTODAYTRADER_SPAWN_WORKER:-1}"
export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-8787}"
export TRADING_UI_ENABLED=false
export ALPACA_ALLOW_LIVE=false
export BIND_LOCALHOST_ONLY=true
export SCRAPLING_WORKER_TOKEN_REQUIRED=true
export NODE_PATH="${RES}/app/node_modules:${NODE_PATH:-}"

NODE_BIN="${RES}/node/bin/node"
NPM_BIN="${RES}/node/bin/npm"
if [[ ! -x "${NODE_BIN}" ]]; then
  NODE_BIN="$(command -v node)"
fi
if [[ ! -x "${NPM_BIN}" ]]; then
  NPM_BIN="$(command -v npm || true)"
fi
# Prefer bundled Node/npm on PATH for any child tools
if [[ -d "${RES}/node/bin" ]]; then
  export PATH="${RES}/node/bin:${PATH}"
fi

cd "${RES}/app"
export AUTODAYTRADER_LIB_ROOT="${RES}/app"
# Install production deps into Resources on first run if missing (use bundled npm)
if [[ ! -d node_modules ]]; then
  if [[ -n "${NPM_BIN}" && -x "${NPM_BIN}" ]]; then
    "${NPM_BIN}" ci --omit=dev 2>/dev/null || "${NPM_BIN}" install --omit=dev --legacy-peer-deps
  else
    echo "AutoDayTrader: node_modules missing and npm not found (bundle incomplete)" >&2
    exit 127
  fi
fi

# Prefer tsx so TypeScript server + forecast .ts libs load
if [[ -x node_modules/.bin/tsx ]]; then
  exec "${NODE_BIN}" node_modules/.bin/tsx server/index.ts
fi
exec "${NODE_BIN}" --import tsx server/index.ts
LAUNCH
chmod +x "${MACOS}/AutoDayTrader"

# Sparkle appcast placeholder
cp "${DESKTOP}/resources/appcast.xml.template" "${RES}/appcast.xml" 2>/dev/null || true
cp "${DESKTOP}/resources/LaunchAgent.plist.template" "${RES}/LaunchAgent.plist.template"
cp "${DESKTOP}/resources/PYTHON_VENDOR.md" "${RES}/PYTHON_VENDOR.md"

echo "==> Assembled ${APP}"
echo "    Next: scripts/macos/vendor-runtimes.sh (if needed), codesign-notarize.sh, create-dmg.sh"
