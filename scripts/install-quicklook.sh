#!/usr/bin/env bash
# Builds the QuickLook .appex and embeds it into a built md-viewer.app bundle.
# Patches the host Info.plist with UTI exports, then re-signs the whole bundle
# so the embedded extension has a valid signature relative to its host.
#
# Usage: scripts/install-quicklook.sh [path/to/md-viewer.app]
#
# Env:
#   ARCH               arm64 | x86_64           (default: host arch)
#   CODESIGN_IDENTITY  signing identity         (default: "-" ad-hoc)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_PATH="${1:-$ROOT/src-tauri/target/release/bundle/macos/md-viewer.app}"

if [[ ! -d "$APP_PATH" ]]; then
  echo "App bundle not found: $APP_PATH" >&2
  echo "Run 'npm run tauri build' first." >&2
  exit 1
fi

IDENTITY="${CODESIGN_IDENTITY:--}"
ARCH="${ARCH:-$(uname -m)}"

echo "==> Building MdViewerQuickLook.appex (arch=$ARCH)"
ARCH="$ARCH" CODESIGN_IDENTITY="$IDENTITY" "$ROOT/quicklook/build-appex.sh"

echo "==> Embedding extension into $APP_PATH"
PLUGIN_DIR="$APP_PATH/Contents/PlugIns"
mkdir -p "$PLUGIN_DIR"
rm -rf "$PLUGIN_DIR/MdViewerQuickLook.appex"
cp -R "$ROOT/quicklook/build/MdViewerQuickLook.appex" "$PLUGIN_DIR/"

echo "==> Patching host Info.plist (UTExportedTypeDeclarations for .mdx)"
PLIST="$APP_PATH/Contents/Info.plist"
PB=/usr/libexec/PlistBuddy

# Idempotent: delete existing UTExportedTypeDeclarations before re-adding.
"$PB" -c "Delete :UTExportedTypeDeclarations" "$PLIST" 2>/dev/null || true
"$PB" -c "Add :UTExportedTypeDeclarations array" "$PLIST"

# .mdx
"$PB" -c "Add :UTExportedTypeDeclarations:0 dict" "$PLIST"
"$PB" -c "Add :UTExportedTypeDeclarations:0:UTTypeIdentifier string com.joseph.md-viewer.mdx" "$PLIST"
"$PB" -c "Add :UTExportedTypeDeclarations:0:UTTypeDescription string MDX Document" "$PLIST"
"$PB" -c "Add :UTExportedTypeDeclarations:0:UTTypeConformsTo array" "$PLIST"
"$PB" -c "Add :UTExportedTypeDeclarations:0:UTTypeConformsTo:0 string public.plain-text" "$PLIST"
"$PB" -c "Add :UTExportedTypeDeclarations:0:UTTypeConformsTo:1 string public.text" "$PLIST"
"$PB" -c "Add :UTExportedTypeDeclarations:0:UTTypeTagSpecification dict" "$PLIST"
"$PB" -c "Add :UTExportedTypeDeclarations:0:UTTypeTagSpecification:public.filename-extension array" "$PLIST"
"$PB" -c "Add :UTExportedTypeDeclarations:0:UTTypeTagSpecification:public.filename-extension:0 string mdx" "$PLIST"

echo "==> Re-signing host bundle (identity=$IDENTITY)"
# Do NOT use --deep here: it re-signs nested code WITHOUT entitlements, which
# silently breaks the QuickLook extension (sandbox entitlement gets dropped).
# The .appex was already signed with its entitlements by build-appex.sh; signing
# the host non-deep preserves that nested signature in the sealed resources.
codesign --force --sign "$IDENTITY" \
  --options runtime \
  --timestamp=none \
  "$APP_PATH"

echo "==> Refreshing Launch Services + QuickLook"
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister \
  -f "$APP_PATH" 2>/dev/null || true

# Unregister stale copies of the extension at OTHER paths. pkd discovers
# .appex bundles via Launch Services and will silently pick a stale one if
# any duplicate exists, which manifests as "extension not found" or as
# rendering an old build of the code.
TARGET_APPEX="$APP_PATH/Contents/PlugIns/MdViewerQuickLook.appex"
TARGET_APPEX_REAL="$(/usr/bin/python3 -c "import os,sys; print(os.path.realpath(sys.argv[1]))" "$TARGET_APPEX" 2>/dev/null || echo "$TARGET_APPEX")"
while IFS= read -r stale; do
  [ -z "$stale" ] && continue
  STALE_REAL="$(/usr/bin/python3 -c "import os,sys; print(os.path.realpath(sys.argv[1]))" "$stale" 2>/dev/null || echo "$stale")"
  if [ "$STALE_REAL" != "$TARGET_APPEX_REAL" ]; then
    echo "  Unregistering stale extension at: $stale"
    pluginkit -r "$stale" 2>/dev/null || true
  fi
done < <(pluginkit -mAvvv 2>/dev/null \
  | awk '/com\.joseph\.md-viewer\.quicklook\(/{f=1;next} f && /Path = /{sub(/^[ \t]*Path = /,"");print;f=0}')

# Explicit pluginkit -a wins over any prior registration of the same bundle ID.
pluginkit -a "$TARGET_APPEX" 2>/dev/null || true
qlmanage -r 2>/dev/null || true
qlmanage -r cache 2>/dev/null || true

echo
echo "Done. Verify with:"
echo "  pluginkit -m -i com.joseph.md-viewer.quicklook"
echo "  qlmanage -p path/to/file.md"
