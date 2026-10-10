#!/usr/bin/env bash
# Install LaunchAgent KeepAlive for 24/7 after login.
set -euo pipefail

APP_SUPPORT="${HOME}/Library/Application Support/AutoDayTrader"
LAUNCH_AGENTS="${HOME}/Library/LaunchAgents"
LABEL="com.autodaytrader.agent"
PLIST="${LAUNCH_AGENTS}/${LABEL}.plist"
APP_BIN="${1:-/Applications/AutoDayTrader.app/Contents/MacOS/AutoDayTrader}"

mkdir -p "${APP_SUPPORT}/logs" "${LAUNCH_AGENTS}"
chmod 700 "${APP_SUPPORT}" || true

cat > "${PLIST}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${APP_BIN}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>WorkingDirectory</key><string>${APP_SUPPORT}</string>
  <key>StandardOutPath</key><string>${APP_SUPPORT}/logs/launchd.out.log</string>
  <key>StandardErrorPath</key><string>${APP_SUPPORT}/logs/launchd.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOST</key><string>127.0.0.1</string>
    <key>PORT</key><string>8787</string>
    <key>TRADING_UI_ENABLED</key><string>false</string>
    <key>ALPACA_ALLOW_LIVE</key><string>false</string>
    <key>AUTODAYTRADER_SPAWN_WORKER</key><string>1</string>
  </dict>
</dict>
</plist>
PLIST

launchctl unload "${PLIST}" 2>/dev/null || true
launchctl load "${PLIST}"
echo "Installed ${PLIST}"
echo "Open http://127.0.0.1:8787 after the agent starts."
echo "Grant Notification Center permission when prompted (osascript / node-notifier)."
