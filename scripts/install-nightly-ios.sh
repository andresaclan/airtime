#!/bin/bash
# Installs (or with --uninstall removes) the nightly native iOS frame check on this Mac.
# See scripts/nightly-ios.sh. It needs Xcode with an iOS Simulator runtime, bun and
# gh, and SafariDriver enabled once with: sudo safaridriver --enable
set -euo pipefail

ROOT="${AIRTIME_NIGHTLY_ROOT:-$HOME/Library/Application Support/airtime-nightly-ios}"
LOGS="$HOME/Library/Logs/airtime-nightly-ios"
LABEL="com.$(id -un).airtime-nightly-ios"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
HERE="$(cd "$(dirname "$0")/.." && pwd)"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
if [[ "${1:-}" == "--uninstall" ]]; then
	rm -f "$PLIST"
	echo "Removed $LABEL. The clone and logs stay in $ROOT and $LOGS."
	exit 0
fi

mkdir -p "$ROOT" "$LOGS" "$(dirname "$PLIST")"
if [[ ! -d "$ROOT/repo/.git" ]]; then
	git clone -q "$(git -C "$HERE" remote get-url origin)" "$ROOT/repo"
fi
cp "$HERE/scripts/nightly-ios.sh" "$ROOT/nightly-ios.sh"

# A few slots a night: a slot is skipped while the Mac is in use, and a run
# that SafariDriver couldn't start is retried at the next one.
slots=""
for hour in 2 3 4 5; do
	slots+="<dict><key>Hour</key><integer>$hour</integer><key>Minute</key><integer>30</integer></dict>"
done
cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>$LABEL</string>
	<key>ProgramArguments</key>
	<array>
		<string>/bin/bash</string>
		<string>$ROOT/nightly-ios.sh</string>
	</array>
	<key>StartCalendarInterval</key>
	<array>$slots</array>
	<key>StandardOutPath</key>
	<string>$LOGS/launchd.log</string>
	<key>StandardErrorPath</key>
	<string>$LOGS/launchd.log</string>
</dict>
</plist>
EOF
plutil -lint "$PLIST" >/dev/null
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed $LABEL: tries at 2:30, 3:30, 4:30 and 5:30 when main has new commits."
echo "Run it now with: /bin/bash \"$ROOT/nightly-ios.sh\" --force"
