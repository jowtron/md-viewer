#!/usr/bin/env bash
# Builds MdViewerQuickLook.appex for the requested architecture.
#
# Env:
#   ARCH               arm64 | x86_64        (default: host arch)
#   CODESIGN_IDENTITY  signing identity      (default: "-" ad-hoc)
#   OUT_DIR            output directory      (default: ./build)
set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"

ARCH="${ARCH:-$(uname -m)}"
case "$ARCH" in
  arm64)  TARGET="arm64-apple-macos12.0"  ;;
  x86_64) TARGET="x86_64-apple-macos12.0" ;;
  *) echo "Unsupported ARCH: $ARCH" >&2; exit 1 ;;
esac

OUT_DIR="${OUT_DIR:-$PWD/build}"
APPEX="$OUT_DIR/MdViewerQuickLook.appex"
rm -rf "$APPEX"
mkdir -p "$APPEX/Contents/MacOS" "$APPEX/Contents/Resources"

# Compile Swift directly into the .appex executable.
# -e _NSExtensionMain replaces the default Swift entry point with Foundation's
# NSExtensionMain, which sets up the PlugInKit XPC service runloop. Without
# this the binary launches, immediately exits, and the host sees the extension
# as "not found".
xcrun swiftc \
  -target "$TARGET" \
  -module-name MdViewerQuickLook \
  -framework Cocoa \
  -framework WebKit \
  -framework QuickLookUI \
  -emit-executable \
  -parse-as-library \
  -O \
  -Xlinker -e -Xlinker _NSExtensionMain \
  -o "$APPEX/Contents/MacOS/MdViewerQuickLook" \
  PreviewViewController.swift

cp Info.plist "$APPEX/Contents/Info.plist"

# Resources: marked + CSS pulled from the host app's src/ so there's a single
# source of truth. The HTML shell is built inline in PreviewViewController.swift.
cp "$ROOT/src/marked.esm.js" "$APPEX/Contents/Resources/marked.esm.js"
cp "$ROOT/src/styles.css"    "$APPEX/Contents/Resources/preview.css"

IDENTITY="${CODESIGN_IDENTITY:--}"
codesign --force --sign "$IDENTITY" \
  --entitlements MdViewerQuickLook.entitlements \
  --options runtime \
  --timestamp=none \
  "$APPEX"

echo "Built $APPEX (arch=$ARCH, identity=$IDENTITY)"
