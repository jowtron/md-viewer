use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
#[cfg(target_os = "macos")]
use tauri::RunEvent;
use tauri::Emitter;

// Global static to capture file path from Opened event (fires before setup)
static OPENED_FILE: std::sync::OnceLock<Mutex<Option<String>>> = std::sync::OnceLock::new();

fn get_opened_mutex() -> &'static Mutex<Option<String>> {
    OPENED_FILE.get_or_init(|| Mutex::new(None))
}

#[tauri::command]
fn get_opened_file() -> Option<String> {
    get_opened_mutex().lock().unwrap().take()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize the global before anything else
    let _ = get_opened_mutex();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_opened_file])
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

            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&open_item)
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

            let toggle_theme_item = MenuItemBuilder::with_id("toggle-theme", "Toggle Dark Mode")
                .accelerator("CmdOrCtrl+Shift+T")
                .build(app)?;

            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&zoom_in_item)
                .item(&zoom_out_item)
                .item(&zoom_reset_item)
                .separator()
                .item(&toggle_theme_item)
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
                    "zoom-in" => {
                        let _ = app_handle.emit("menu-zoom", "in");
                    }
                    "zoom-out" => {
                        let _ = app_handle.emit("menu-zoom", "out");
                    }
                    "zoom-reset" => {
                        let _ = app_handle.emit("menu-zoom", "reset");
                    }
                    "toggle-theme" => {
                        let _ = app_handle.emit("menu-toggle-theme", ());
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
                    *get_opened_mutex().lock().unwrap() = Some(path.clone());
                    let _ = app_handle.emit("open-file-path", &path);
                }
            }
        }
    });

    #[cfg(not(target_os = "macos"))]
    app.run(|_app_handle, _event| {});
}
