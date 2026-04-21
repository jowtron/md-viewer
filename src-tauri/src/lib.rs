use std::collections::HashMap;
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
#[cfg(target_os = "macos")]
use tauri::RunEvent;
use tauri::{Emitter, WebviewWindowBuilder};

// Global static to capture file path from Opened event (fires before setup)
static OPENED_FILE: std::sync::OnceLock<Mutex<Option<String>>> = std::sync::OnceLock::new();
// Per-window pending files for new windows
static PENDING_FILES: std::sync::OnceLock<Mutex<HashMap<String, String>>> = std::sync::OnceLock::new();
// Tracks whether the main window has finished initial load
static MAIN_WINDOW_READY: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
// Counter for unique window labels
static WINDOW_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn get_opened_mutex() -> &'static Mutex<Option<String>> {
    OPENED_FILE.get_or_init(|| Mutex::new(None))
}

fn get_pending_mutex() -> &'static Mutex<HashMap<String, String>> {
    PENDING_FILES.get_or_init(|| Mutex::new(HashMap::new()))
}

#[tauri::command]
fn get_opened_file(window: tauri::Window) -> Option<String> {
    let label = window.label().to_string();
    if label == "main" {
        MAIN_WINDOW_READY.store(true, std::sync::atomic::Ordering::SeqCst);
        get_opened_mutex().lock().unwrap().take()
    } else {
        get_pending_mutex().lock().unwrap().remove(&label)
    }
}

fn create_file_window(app: &tauri::AppHandle, path: &str) -> Result<(), String> {
    let id = WINDOW_COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let label = format!("md-{}", id);

    get_pending_mutex()
        .lock()
        .unwrap()
        .insert(label.clone(), path.to_string());

    let offset = (id % 20) as f64 * 26.0;
    WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::App("/index.html".into()))
        .title(path)
        .inner_size(900.0, 700.0)
        .position(100.0 + offset, 100.0 + offset)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn open_in_new_window(app: tauri::AppHandle, path: String) -> Result<(), String> {
    create_file_window(&app, &path)
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read {}: {}", path, e))
}

#[tauri::command]
fn write_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, &contents).map_err(|e| format!("Failed to write {}: {}", path, e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize the globals before anything else
    let _ = get_opened_mutex();
    let _ = get_pending_mutex();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_opened_file, open_in_new_window, read_file, write_file])
        .setup(|app| {
            // macOS: first submenu becomes the app menu
            let app_menu = SubmenuBuilder::new(app, "md-viewer")
                .about(None)
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;

            let open_item = MenuItemBuilder::with_id("open-file", "Open…")
                .accelerator("CmdOrCtrl+O")
                .build(app)?;

            let save_item = MenuItemBuilder::with_id("save", "Save")
                .accelerator("CmdOrCtrl+S")
                .build(app)?;

            let save_as_item = MenuItemBuilder::with_id("save-as", "Save As…")
                .accelerator("CmdOrCtrl+Shift+S")
                .build(app)?;

            let print_item = MenuItemBuilder::with_id("print", "Print…")
                .accelerator("CmdOrCtrl+P")
                .build(app)?;

            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&open_item)
                .item(&save_item)
                .item(&save_as_item)
                .separator()
                .item(&print_item)
                .separator()
                .close_window()
                .build()?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            let zoom_in_item = MenuItemBuilder::with_id("zoom-in", "Zoom In")
                .accelerator("CmdOrCtrl+=")
                .build(app)?;
            let zoom_out_item = MenuItemBuilder::with_id("zoom-out", "Zoom Out")
                .accelerator("CmdOrCtrl+-")
                .build(app)?;
            let zoom_reset_item = MenuItemBuilder::with_id("zoom-reset", "Actual Size")
                .accelerator("CmdOrCtrl+0")
                .build(app)?;

            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&zoom_in_item)
                .item(&zoom_out_item)
                .item(&zoom_reset_item)
                .build()?;

            let menu = MenuBuilder::new(app)
                .items(&[&app_menu, &file_menu, &edit_menu, &view_menu])
                .build()?;

            app.set_menu(menu)?;

            app.on_menu_event(move |app_handle, event| {
                match event.id().0.as_str() {
                    "open-file" => {
                        let _ = app_handle.emit("menu-open-file", ());
                    }
                    "save" => {
                        let _ = app_handle.emit("menu-save", ());
                    }
                    "save-as" => {
                        let _ = app_handle.emit("menu-save-as", ());
                    }
                    "print" => {
                        let _ = app_handle.emit("menu-print", ());
                    }
                    "zoom-in" => {
                        let _ = app_handle.emit("menu-zoom", "in");
                    }
                    "zoom-out" => {
                        let _ = app_handle.emit("menu-zoom", "out");
                    }
                    "zoom-reset" => {
                        let _ = app_handle.emit("menu-zoom", "reset");
                    }
                    _ => {}
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    #[cfg(target_os = "macos")]
    app.run(|app_handle, event| {
        if let RunEvent::Opened { urls } = event {
            for url in urls {
                let path_string: Option<String> = if url.scheme() == "file" {
                    url.to_file_path()
                        .ok()
                        .and_then(|p: std::path::PathBuf| p.to_str().map(|s: &str| s.to_string()))
                } else {
                    Some(url.to_string())
                };
                if let Some(path) = path_string {
                    if MAIN_WINDOW_READY.load(std::sync::atomic::Ordering::SeqCst) {
                        // App is running, open in a new window
                        let _ = create_file_window(app_handle, &path);
                    } else {
                        // App is starting up, store for main window
                        *get_opened_mutex().lock().unwrap() = Some(path);
                    }
                }
            }
        }
    });

    #[cfg(not(target_os = "macos"))]
    app.run(|_app_handle, _event| {});
}
