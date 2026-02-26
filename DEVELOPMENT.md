# Development Notes

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

## macOS File Association Notes

- `RunEvent::Opened` fires **before** `setup()` runs, so you cannot store the path in Tauri-managed state at that point — it won't be initialised yet.
- Use a `std::sync::OnceLock<Mutex<Option<String>>>` global static to capture the path early, then poll it from the frontend via an `invoke` command once the webview is ready.
- The frontend polls at 0ms, 300ms, and 1000ms after `DOMContentLoaded` to catch late-arriving events.
- `tao` (Tauri's windowing library) only implements `application:openURLs:`, not the older `application:openFile:` delegate method. On modern macOS this still receives `file://` URLs for document opens, which is what `RunEvent::Opened` surfaces.
