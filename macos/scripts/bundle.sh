#!/bin/bash
# Builds Airtime.app into macos/build/. Usage: macos/scripts/bundle.sh [--install]
# --install copies it to /Applications.
set -euo pipefail
cd "$(dirname "$0")/.."
swift build -c release --product Airtime
app=build/Airtime.app
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp .build/release/Airtime "$app/Contents/MacOS/Airtime"
scratch=$(mktemp -d)
swift scripts/make-icon.swift "$scratch/AppIcon.iconset"
iconutil -c icns "$scratch/AppIcon.iconset" -o "$app/Contents/Resources/AppIcon.icns"
rm -rf "$scratch"
version=$(git log -1 --format=%cd --date=format:%Y.%m.%d 2>/dev/null || echo 1.0)
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleName</key><string>Airtime</string>
	<key>CFBundleDisplayName</key><string>Airtime</string>
	<key>CFBundleIdentifier</key><string>app.airtime.desktop</string>
	<key>CFBundleExecutable</key><string>Airtime</string>
	<key>CFBundleIconFile</key><string>AppIcon</string>
	<key>CFBundlePackageType</key><string>APPL</string>
	<key>CFBundleShortVersionString</key><string>$version</string>
	<key>CFBundleVersion</key><string>$version</string>
	<key>LSMinimumSystemVersion</key><string>15.0</string>
	<key>LSApplicationCategoryType</key><string>public.app-category.sports</string>
	<key>NSHighResolutionCapable</key><true/>
	<key>CFBundleDocumentTypes</key>
	<array>
		<dict>
			<key>CFBundleTypeName</key><string>Video</string>
			<key>CFBundleTypeRole</key><string>Viewer</string>
			<key>LSHandlerRank</key><string>Alternate</string>
			<key>LSItemContentTypes</key>
			<array><string>public.movie</string><string>public.mpeg-4</string><string>com.apple.quicktime-movie</string></array>
		</dict>
	</array>
</dict>
</plist>
PLIST
# Ad-hoc signature so Gatekeeper and the hardened runtime treat it as one app.
codesign --force --sign - "$app" >/dev/null
echo "Built $(pwd)/$app"
if [[ "${1:-}" == "--install" ]]; then
	rm -rf /Applications/Airtime.app
	cp -R "$app" /Applications/
	echo "Installed /Applications/Airtime.app"
fi
