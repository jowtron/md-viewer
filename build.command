#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "Building md-viewer app bundle..."
npm run tauri build

APP_PATH="src-tauri/target/release/bundle/macos/md-viewer.app"

if [ -d "$APP_PATH" ]; then
    echo ""
    echo "Build complete: $APP_PATH"
    echo "To open: open $APP_PATH"
else
    echo "Build finished but .app not found at expected path."
    echo "Check src-tauri/target/release/bundle/ for output."
fi
