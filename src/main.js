import { Marked } from "./marked.esm.js";

const marked = new Marked();
const invoke = window.__TAURI__.core.invoke;
const listen = window.__TAURI__.event.listen;

const contentEl = () => document.getElementById("content");
const filenameEl = () => document.getElementById("filename");

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
    contentEl().innerHTML = marked.parse(text);
    filenameEl().textContent = String(path).split("/").pop();
  } catch (e) {
    console.error("Error:", e);
    contentEl().innerHTML = `<p class="placeholder">Error: ${e}</p>`;
  }
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
    await openFile(path);
  } catch (e) {
    console.error("Error:", e);
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
    const path = event.payload.paths[0];
    if (/\.(md|markdown|mdx|txt)$/i.test(path)) {
      openFile(path);
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
  document.getElementById("theme-toggle").addEventListener("click", toggleTheme);
  document.getElementById("zoom-in-btn").addEventListener("click", zoomIn);
  document.getElementById("zoom-out-btn").addEventListener("click", zoomOut);
  applyTheme();

  // Check immediately, then retry after delays to catch late-arriving Opened events
  if (!await checkPendingFile()) {
    setTimeout(() => checkPendingFile(), 300);
    setTimeout(() => checkPendingFile(), 1000);
  }
});
