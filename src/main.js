import { Marked } from "./marked.esm.js";

const marked = new Marked();
const invoke = window.__TAURI__.core.invoke;
const listen = window.__TAURI__.event.listen;
const currentWindow = window.__TAURI__.window.getCurrentWindow();

const contentEl = () => document.getElementById("content");
const filenameEl = () => document.getElementById("filename");

let currentFilePath = null;
let currentRawText = null;

// Theme: follow system unless user has manually overridden
let userOverride = localStorage.getItem("themeOverride") === "true";
let themeMode = userOverride
  ? (localStorage.getItem("theme") || "light")
  : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

function applyTheme() {
  document.documentElement.setAttribute("data-theme", themeMode);
  const btn = document.getElementById("theme-toggle");
  if (btn) btn.textContent = themeMode === "dark" ? "\u{2600}\u{FE0F}" : "\u{1F319}";
}

function toggleTheme() {
  themeMode = themeMode === "dark" ? "light" : "dark";
  userOverride = true;
  localStorage.setItem("theme", themeMode);
  localStorage.setItem("themeOverride", "true");
  applyTheme();
}

// Follow system theme changes (clears manual override)
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
  themeMode = e.matches ? "dark" : "light";
  userOverride = false;
  localStorage.removeItem("themeOverride");
  localStorage.setItem("theme", themeMode);
  applyTheme();
});

// Apply theme immediately
applyTheme();

// Load and render a markdown file by path
async function openFile(path) {
  try {
    const data = await invoke("plugin:fs|read_text_file", {
      path: path,
      options: {},
    });
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    currentRawText = text;
    currentFilePath = path;
    contentEl().innerHTML = marked.parse(text);
    filenameEl().textContent = String(path).split("/").pop();
    await currentWindow.setTitle(path);
    updateSaveButton();
  } catch (e) {
    console.error("Error:", e);
    contentEl().innerHTML = `<p class="placeholder">Error: ${e}</p>`;
  }
}

function updateSaveButton() {
  const btn = document.getElementById("save-btn");
  if (btn) btn.disabled = !currentRawText;
}

// Open a file in a new window via Rust command
async function openFileInNewWindow(path) {
  await invoke("open_in_new_window", { path });
}

// Open file dialog
async function openFileDialog() {
  try {
    const selected = await invoke("plugin:dialog|open", {
      options: {
        filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
        multiple: false,
        directory: false,
      },
    });
    if (!selected) return;
    const path = typeof selected === "string" ? selected : selected.path || selected;
    if (currentFilePath) {
      await openFileInNewWindow(path);
    } else {
      await openFile(path);
    }
  } catch (e) {
    console.error("Error:", e);
  }
}

// Save As
async function saveFileAs() {
  if (!currentRawText) return;
  try {
    const path = await invoke("plugin:dialog|save", {
      options: {
        filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
        defaultPath: currentFilePath || undefined,
      },
    });
    if (!path) return;
    const savePath = typeof path === "string" ? path : path.path || path;
    await invoke("plugin:fs|write_text_file", {
      path: savePath,
      contents: currentRawText,
      options: {},
    });
    currentFilePath = savePath;
    filenameEl().textContent = String(savePath).split("/").pop();
    await currentWindow.setTitle(savePath);
  } catch (e) {
    console.error("Save error:", e);
  }
}

// Zoom support
let zoomLevel = 100;
function applyZoom() {
  document.body.style.fontSize = zoomLevel + "%";
  document.getElementById("zoom-level").textContent = zoomLevel + "%";
}
function zoomIn() { zoomLevel = Math.min(200, zoomLevel + 10); applyZoom(); }
function zoomOut() { zoomLevel = Math.max(50, zoomLevel - 10); applyZoom(); }
function zoomReset() { zoomLevel = 100; applyZoom(); }

// Keyboard shortcuts (as fallback, menu accelerators handle most)
window.addEventListener("keydown", (e) => {
  if (e.metaKey && e.key === "=") { e.preventDefault(); zoomIn(); }
  if (e.metaKey && e.key === "-") { e.preventDefault(); zoomOut(); }
  if (e.metaKey && e.key === "0") { e.preventDefault(); zoomReset(); }
});

// Listen for menu events from Rust
listen("menu-open-file", () => openFileDialog());
listen("menu-save-as", () => saveFileAs());
listen("menu-zoom", (event) => {
  if (event.payload === "in") zoomIn();
  else if (event.payload === "out") zoomOut();
  else if (event.payload === "reset") zoomReset();
});

// Listen for files opened from Finder (Open With / double-click)
listen("open-file-path", (event) => {
  if (event.payload) openFile(event.payload);
});

// Drag and drop support
listen("tauri://drag-drop", (event) => {
  document.body.classList.remove("drag-over");
  if (event.payload && event.payload.paths && event.payload.paths.length > 0) {
    const paths = event.payload.paths.filter(p => /\.(md|markdown|mdx|txt)$/i.test(p));
    if (paths.length === 0) return;
    if (currentFilePath) {
      // Current window already has a file, open all in new windows
      paths.forEach(p => openFileInNewWindow(p));
    } else {
      // Load first file here, rest in new windows
      openFile(paths[0]);
      paths.slice(1).forEach(p => openFileInNewWindow(p));
    }
  }
});

listen("tauri://drag-enter", () => {
  document.body.classList.add("drag-over");
});

listen("tauri://drag-leave", () => {
  document.body.classList.remove("drag-over");
});

// Check for a file that was used to launch the app
async function checkPendingFile() {
  try {
    const pendingFile = await invoke("get_opened_file", {});
    if (pendingFile) {
      await openFile(pendingFile);
      return true;
    }
  } catch (e) {
    console.error("Error checking opened file:", e);
  }
  return false;
}

// Listen for theme toggle from menu
listen("menu-toggle-theme", () => toggleTheme());

// Button click + check for file opened via Finder on launch
window.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("open-btn").addEventListener("click", openFileDialog);
  document.getElementById("save-btn").addEventListener("click", saveFileAs);
  document.getElementById("theme-toggle").addEventListener("click", toggleTheme);
  document.getElementById("zoom-in-btn").addEventListener("click", zoomIn);
  document.getElementById("zoom-out-btn").addEventListener("click", zoomOut);
  applyTheme();
  updateSaveButton();

  // Check immediately, then retry after delays to catch late-arriving Opened events
  if (!await checkPendingFile()) {
    setTimeout(() => checkPendingFile(), 300);
    setTimeout(() => checkPendingFile(), 1000);
  }
});
