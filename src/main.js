import { Marked } from "./marked.esm.js";

const marked = new Marked({ gfm: true, breaks: true });
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
    const text = await invoke("read_file", { path: path });
    currentRawText = text;
    currentFilePath = path;
    contentEl().innerHTML = marked.parse(text);
    // Make bare URLs clickable even inside <code> spans
    linkifyTextNodes(contentEl());
    filenameEl().textContent = String(path).split("/").pop();
    await currentWindow.setTitle(path);
    updateSaveButton();
    await autoResizeWidth();
  } catch (e) {
    console.error("Error:", e);
    contentEl().innerHTML = `<p class="placeholder">Error: ${e}</p>`;
  }
}

// Auto-resize window width to fit content, keeping it on screen
async function autoResizeWidth() {
  const content = contentEl();
  const needed = content.scrollWidth + (window.innerWidth - content.clientWidth) + 2;
  const screenW = window.screen.availWidth;
  const screenLeft = window.screen.availLeft || 0;
  const maxWidth = Math.min(screenW - 50, 1800);
  const newWidth = Math.max(900, Math.min(needed, maxWidth));
  const currentWidth = window.innerWidth;
  if (newWidth > currentWidth) {
    const scale = window.devicePixelRatio || 1;
    const outerSize = await currentWindow.outerSize();
    const outerPos = await currentWindow.outerPosition();
    const outerHeight = Math.round(outerSize.height / scale);
    const extraWidth = Math.round(outerSize.width / scale) - currentWidth;
    const totalWidth = newWidth + extraWidth;
    const LogicalSize = window.__TAURI__.dpi.LogicalSize;
    const LogicalPosition = window.__TAURI__.dpi.LogicalPosition;
    await currentWindow.setSize(new LogicalSize(totalWidth, outerHeight));
    // Shift left if the window would go off the right edge
    const posX = Math.round(outerPos.x / scale);
    const posY = Math.round(outerPos.y / scale);
    const rightEdge = posX + totalWidth;
    const screenRight = screenLeft + screenW;
    if (rightEdge > screenRight) {
      const newX = Math.max(screenLeft, screenRight - totalWidth);
      await currentWindow.setPosition(new LogicalPosition(newX, posY));
    }
  }
}

// Walk DOM text nodes and wrap bare URLs in <a> tags
const urlRe = /(https?:\/\/[^\s<>"'`)\]]+)/g;
function linkifyTextNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (node.parentElement && node.parentElement.tagName === "A") continue;
    if (!urlRe.test(node.textContent)) continue;
    urlRe.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    let match;
    while ((match = urlRe.exec(node.textContent)) !== null) {
      if (match.index > last) frag.appendChild(document.createTextNode(node.textContent.slice(last, match.index)));
      const a = document.createElement("a");
      a.href = match[1];
      a.textContent = match[1];
      frag.appendChild(a);
      last = match.index + match[0].length;
    }
    if (last < node.textContent.length) frag.appendChild(document.createTextNode(node.textContent.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }
}

// Open links in external browser
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[href]");
  if (!a) return;
  const href = a.getAttribute("href");
  if (href && /^https?:\/\//.test(href)) {
    e.preventDefault();
    invoke("plugin:opener|open_url", { url: href });
  }
});

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
    await invoke("write_file", { path: savePath, contents: currentRawText });
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
