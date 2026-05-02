# Development Notes

## CodeMirror bundle

The editor uses CodeMirror 6, bundled into a single vendored file at
`src/codemirror.bundle.js` (loaded as a static module like `marked.esm.js`).

The project ships `src/` as-is — there's no runtime bundler — so the bundle
must be rebuilt whenever `cm-entry.js` or its CodeMirror deps change:

```sh
npm install        # once
npm run build:cm   # after editing cm-entry.js
```

The bundle exposes CodeMirror APIs on `window.CM`, consumed by `src/main.js`.

## CI / Cross-Platform Build Issues

### Problem 1: `RunEvent::Opened` is macOS-only

`tauri::RunEvent::Opened` — used to receive files opened via Finder (Open With / double-click) — is only available on macOS. On Linux and Windows, the enum variant doesn't exist and the code fails to compile.

**Fix:** Gate the entire handler with `#[cfg(target_os = "macos")]`:

```rust
#[cfg(target_os = "macos")]
app.run(|app_handle, event| {
    if let RunEvent::Opened { urls } = event { ... }
});

#[cfg(not(target_os = "macos"))]
app.run(|_app_handle, _event| {});
```

Also gate the import:
```rust
#[cfg(target_os = "macos")]
use tauri::RunEvent;
```

---

### Problem 2: Cross-compiled macOS output path

When building for a specific target (e.g. `--target aarch64-apple-darwin`), Tauri puts bundle output in:
```
src-tauri/target/<target-triple>/release/bundle/
```
**not** the default:
```
src-tauri/target/release/bundle/
```

The CI workflow was trying to upload from the wrong path. The fix is to use the matrix target variable in the path:

```yaml
files: src-tauri/target/${{ matrix.target }}/release/bundle/dmg/*.dmg
```

---

### Problem 3: Rust type inference differences across platforms

The line:
```rust
url.to_file_path().ok().and_then(|p| p.to_str().map(|s| s.to_string()))
```
compiled fine on macOS but failed on Linux/Windows with `E0282: type annotations needed`. Different Rust versions/targets can be stricter about type inference in closure chains.

**Fix:** Add explicit types:
```rust
url.to_file_path()
    .ok()
    .and_then(|p: std::path::PathBuf| p.to_str().map(|s: &str| s.to_string()))
```

---

## macOS QuickLook Extension

The `quicklook/` directory contains a sandboxed Quick Look preview extension
that renders `.md` / `.markdown` files when the user hits spacebar in Finder.

### Architecture

It is one Swift file (`PreviewViewController.swift`) compiled directly with
`swiftc` into a `.appex` bundle — there is no Xcode project. The `.appex`
embeds into `md-viewer.app/Contents/PlugIns/` and is discovered by macOS's
PlugInKit because the host app declares the relevant UTI in `Info.plist`.

Render path on each preview:

1. macOS spawns the `.appex` as a sandboxed XPC service when Finder needs
   a preview. The binary's entry point is Foundation's `NSExtensionMain`,
   which sets up the PlugInKit runloop and waits for requests.
2. Quick Look invokes `PreviewViewController.preparePreviewOfFile(at:)`
   with the file URL.
3. The controller reads the markdown, JSON-encodes it, splices it into an
   inline HTML string that also inlines `marked` and `styles.css` (both
   read from the `.appex`'s Resources at preview time), and loads the
   string into a `WKWebView`.
4. When `didFinish` fires, the completion handler is called and the preview
   window swaps from spinner to rendered content.

`marked` and the CSS are physically copied from `src/` into the `.appex`
Resources by `quicklook/build-appex.sh` at build time, so the renderer is
the same one the host app uses — there is no second markdown engine to
keep in sync.

### Build & install

```sh
CODESIGN_IDENTITY="Apple Development: you@example.com (TEAMID)" \
  ./scripts/install-quicklook.sh /Applications/md-viewer.app
```

`install-quicklook.sh` runs `quicklook/build-appex.sh` (which compiles +
ad-hoc signs), copies the `.appex` into `Contents/PlugIns/`, patches the
host `Info.plist` to add a `UTExportedTypeDeclarations` entry for `.mdx`,
re-signs the host bundle, and refreshes Launch Services. CI does the
equivalent steps in `.github/workflows/release.yml`, then re-packages the
DMG with `hdiutil` so the released DMG ships with the extension embedded.

### Hard-won gotchas

These were not obvious from Apple's docs and each one cost real time to
diagnose, so they are recorded here.

#### `swiftc -emit-executable` produces a binary that immediately exits

A normal Swift executable's `main()` runs top-level code and exits. An
extension binary needs to call into PlugInKit's runloop or the OS will
spawn the process, see it exit in milliseconds, and report
"Extension … not found".

**Fix:** pass `-Xlinker -e -Xlinker _NSExtensionMain` to `swiftc` so the
binary's entry symbol resolves to Foundation's `NSExtensionMain`. Also
pass `-parse-as-library` so the file is treated as a library (no implicit
top-level main).

#### `WKWebView` web process won't launch in a sandboxed extension

Without the right entitlement, WebKit's WebContent XPC service crashes at
launch with `Invalid connection identifier (web process failed to launch)`.

**Fix:** the entitlement is `com.apple.security.network.client`. WebKit
needs it to bootstrap its content process even when only loading local
HTML.

#### ES modules don't execute under `loadHTMLString` with a `file://` baseURL

WKWebView treats `file://` content loaded via `loadHTMLString` as having
an opaque origin, and ES modules silently refuse to run from opaque
origins. Symptoms: HTML and CSS render, but `<script type="module">`
never executes — no errors, no console messages.

**Fix:** don't use `<script type="module">`. The `marked.esm.js` distribution
ends with an `export { ... g as marked, ... }` line. The Swift
controller strips that final `export` statement at preview time and
appends `window.marked = g;`, then loads the result inside a plain
`<script>`. Plain scripts execute fine under any origin.

#### `codesign --deep` strips entitlements from nested code

Re-signing the host app with `--deep` re-signs the embedded `.appex`
WITHOUT entitlements, dropping the sandbox declaration. The extension
then loads but is rejected silently at activation.

**Fix:** sign the `.appex` first (with its entitlements file), then sign
the host bundle WITHOUT `--deep`. The host's `_CodeSignature/CodeResources`
seals the nested signature in place.

#### Multiple copies of `md-viewer.app` confuse PlugInKit

If you have `md-viewer.app` in `/Applications/`, `~/Applications/`, AND
`src-tauri/target/release/bundle/macos/`, all three of their embedded
`.appex` bundles get registered with the same bundle identifier. PlugInKit
picks one by an internal tie-breaker (often the oldest), which may not
have the latest build of the code. Symptoms: install succeeds, fix doesn't
appear to take effect, or "extension not found" / "failed during preview"
even when pluginkit shows the extension as registered.

**Fix:** `install-quicklook.sh` calls `pluginkit -mAvvv`, parses out every
registered path for our bundle ID, and runs `pluginkit -r` on any that
aren't the install target. If you see the symptom return, run
`pluginkit -mAvvv | grep mdviewer` to inspect what's registered.

#### Modern QuickLook needs a real signing identity

Ad-hoc signed extensions (`codesign --sign -`) install fine and pluginkit
reports them as registered, but macOS refuses to spawn them as Quick Look
extensions. The host bundle is rejected by `spctl` and the system error
is "Extension … not found" with no log entry mentioning code-signing.

**Fix:** any real cert works — even the free "Apple Development" cert
generated by Xcode (Settings → Accounts → Manage Certificates → +). Set
`CODESIGN_IDENTITY="Apple Development: …"` before running the install
script. The same cert is used for both the `.appex` and the host bundle
re-sign, so they have matching team IDs.

#### `qlmanage -p` is useless for testing PreviewExtensions

`qlmanage -p path/to/file.md` only invokes legacy `.qlgenerator` plugins,
not modern `NSExtension`-based PreviewExtensions. It will always say "did
not produce any preview" even when the extension is correctly installed
and would work via Finder spacebar. Test with Finder spacebar instead.

---

## macOS File Association Notes

- `RunEvent::Opened` fires **before** `setup()` runs, so you cannot store the path in Tauri-managed state at that point — it won't be initialised yet.
- Use a `std::sync::OnceLock<Mutex<Option<String>>>` global static to capture the path early, then poll it from the frontend via an `invoke` command once the webview is ready.
- The frontend polls at 0ms, 300ms, and 1000ms after `DOMContentLoaded` to catch late-arriving events.
- `tao` (Tauri's windowing library) only implements `application:openURLs:`, not the older `application:openFile:` delegate method. On modern macOS this still receives `file://` URLs for document opens, which is what `RunEvent::Opened` surfaces.
