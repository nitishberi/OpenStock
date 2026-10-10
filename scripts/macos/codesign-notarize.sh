#!/usr/bin/env bash
# Developer ID sign + notarize + staple.
# Required env:
#   APPLE_TEAM_ID
#   And either:
#     APPLE_ID + APP_SPECIFIC_PASSWORD
#   or:
#     NOTARYTOOL_KEYCHAIN_PROFILE (notarytool store-credentials profile name)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIST="${ROOT}/dist/macos"
APP="${DIST}/AutoDayTrader.app"
DMG="${DIST}/AutoDayTrader.dmg"
IDENTITY="${CODESIGN_IDENTITY:-Developer ID Application}"
BUNDLE_ID="${APP_BUNDLE_ID:-com.autodaytrader.app}"

if [[ -z "${APPLE_TEAM_ID:-}" ]]; then
  echo "APPLE_TEAM_ID is required" >&2
  exit 1
fi

if [[ ! -d "${APP}" ]]; then
  echo "Missing ${APP}" >&2
  exit 1
fi

echo "==> Codesign nested binaries (deep)"
# Sign frameworks/helpers first if present, then the app
find "${APP}" -type f \( -name "*.dylib" -o -name "*.so" -o -perm -111 \) 2>/dev/null | while read -r bin; do
  codesign --force --options runtime --timestamp --sign "${IDENTITY}" "${bin}" 2>/dev/null || true
done

codesign --force --deep --options runtime --timestamp \
  --sign "${IDENTITY}" \
  --entitlements "${ROOT}/scripts/macos/entitlements.plist" \
  "${APP}"

codesign --verify --deep --strict --verbose=2 "${APP}"
spctl --assess --type execute --verbose "${APP}" || true

if [[ -f "${DMG}" ]]; then
  codesign --force --timestamp --sign "${IDENTITY}" "${DMG}"
fi

echo "==> Notarize"
NOTARY_ARGS=()
if [[ -n "${NOTARYTOOL_KEYCHAIN_PROFILE:-}" ]]; then
  NOTARY_ARGS+=(--keychain-profile "${NOTARYTOOL_KEYCHAIN_PROFILE}")
else
  if [[ -z "${APPLE_ID:-}" || -z "${APP_SPECIFIC_PASSWORD:-}" ]]; then
    echo "Set APPLE_ID + APP_SPECIFIC_PASSWORD or NOTARYTOOL_KEYCHAIN_PROFILE" >&2
    exit 1
  fi
  NOTARY_ARGS+=(--apple-id "${APPLE_ID}" --password "${APP_SPECIFIC_PASSWORD}" --team-id "${APPLE_TEAM_ID}")
fi

TARGET="${DMG}"
if [[ ! -f "${TARGET}" ]]; then
  TARGET="${APP}"
fi

xcrun notarytool submit "${TARGET}" --wait "${NOTARY_ARGS[@]}"
xcrun stapler staple "${TARGET}"
if [[ "${TARGET}" != "${APP}" && -d "${APP}" ]]; then
  xcrun stapler staple "${APP}" || true
fi

echo "==> Signed + notarized: ${TARGET}"
