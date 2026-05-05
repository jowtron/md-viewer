import { Marked } from "./marked.esm.js";

const marked = new Marked({ gfm: true, breaks: true });
const invoke = window.__TAURI__.core.invoke;
const listen = window.__TAURI__.event.listen;
const currentWindow = window.__TAURI__.window.getCurrentWindow();

const contentEl = () => document.getElementById("content");
const filenameEl = () => document.getElementById("filename");

let currentFilePath = null;
let currentRawText = null;
let savedText = null;
let isDirty = false;

// View mode: "preview" | "split" | "editor"
let viewMode = localStorage.getItem("viewMode") || "preview";
let editorView = null; // CodeMirror EditorView instance (created lazily)
let suppressEditorChange = false; // prevents re-render loops when programmatically updating editor

// Follow system theme automatically
function applySystemTheme() {
  const mode = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", mode);
}
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applySystemTheme);
applySystemTheme();

// Render markdown text into the preview pane.
// Each top-level block is wrapped in <section data-source-line="N"> so mode
// switches can find "where am I" in terms of the markdown source line.
function renderPreview(text) {
  const content = contentEl();
  if (!text) {
    content.innerHTML = "";
    return;
  }
  const tokens = marked.lexer(text);
  let cursor = 0;
  const parts = [];
  for (const tok of tokens) {
    const idx = text.indexOf(tok.raw, cursor);
    const line = idx >= 0 ? text.slice(0, idx).split("\n").length : 1;
    if (idx >= 0) cursor = idx + tok.raw.length;
    if (tok.type === "space") continue;
    const newlines = (tok.raw.match(/\n/g) || []).length;
    const endLine = line + newlines - (tok.raw.endsWith("\n") ? 1 : 0);
    const inner = marked.parser([tok]);
    parts.push(`<section data-source-line="${line}" data-source-end-line="${endLine}">${inner}</section>`);
  }
  content.innerHTML = parts.join("");
  linkifyTextNodes(content);
  if (searchState.query && !document.getElementById("search-bar").hidden) {
    runSearch();
  }
}

// Load and render a markdown file by path
async function openFile(path) {
  try {
    const text = await invoke("read_file", { path: path });
    currentRawText = text;
    savedText = text;
    isDirty = false;
    currentFilePath = path;
    renderPreview(text);
    if (editorView) {
      suppressEditorChange = true;
      editorView.dispatch({
        changes: { from: 0, to: editorView.state.doc.length, insert: text },
      });
      suppressEditorChange = false;
    }
    filenameEl().textContent = String(path).split("/").pop();
    await currentWindow.setTitle(path);
    updateSaveButton();
    await autoResizeWidth();
  } catch (e) {
    console.error("Error:", e);
    contentEl().innerHTML = `<p class="placeholder">Error: ${e}</p>`;
  }
}

// Called from editor onChange — updates buffer + dirty flag, debounce-renders preview
let renderTimer = null;
function setBufferText(text) {
  currentRawText = text;
  isDirty = savedText !== null && text !== savedText;
  updateSaveButton();
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => renderPreview(text), 150);
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
  if (btn) {
    btn.disabled = !currentRawText;
    btn.textContent = isDirty ? "Save •" : "Save";
  }
  const saveAsBtn = document.getElementById("save-as-btn");
  if (saveAsBtn) saveAsBtn.disabled = !currentRawText;
  const printBtn = document.getElementById("print-btn");
  if (printBtn) printBtn.disabled = !currentRawText;
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

// Save in place (Cmd+S). Falls back to Save As if no file path yet.
async function saveFile() {
  if (!currentRawText) return;
  if (!currentFilePath) return saveFileAs();
  try {
    await invoke("write_file", { path: currentFilePath, contents: currentRawText });
    savedText = currentRawText;
    isDirty = false;
    updateSaveButton();
  } catch (e) {
    console.error("Save error:", e);
  }
}

// Save As (Cmd+Shift+S) — always prompts for path
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
    savedText = currentRawText;
    isDirty = false;
    filenameEl().textContent = String(savePath).split("/").pop();
    await currentWindow.setTitle(savePath);
    updateSaveButton();
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
  if (e.metaKey && e.key === "p") { e.preventDefault(); printDocument(); }
  if (e.metaKey && e.key === "e") { e.preventDefault(); cycleViewMode(); }
  if (e.metaKey && e.key === "f") { e.preventDefault(); openSearchBar(); }
});

async function printDocument() {
  if (!currentRawText) return;
  clearTimeout(renderTimer);
  renderPreview(currentRawText);
  // Apply print layout via class — WKWebView's printOperation honors the
  // current DOM/CSS state but doesn't reliably re-flow layout from @media
  // print rules alone, so we make the layout changes for real, then revert.
  document.body.classList.add("printing");
  // Two rAFs so layout AND paint settle before the print snapshot is taken.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    await invoke("print_page");
  } catch (e) {
    console.error("Print error:", e);
    window.print();
  } finally {
    document.body.classList.remove("printing");
  }
}

// Listen for menu events from Rust
listen("menu-open-file", () => openFileDialog());
listen("menu-save", () => saveFile());
listen("menu-save-as", () => saveFileAs());
listen("menu-print", () => printDocument());
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

// === CodeMirror editor ===
function ensureEditor() {
  if (editorView) return editorView;
  const CM = window.CM;
  if (!CM) { console.error("CodeMirror bundle not loaded"); return null; }

  const updateListener = CM.EditorView.updateListener.of((update) => {
    if (suppressEditorChange) return;
    if (update.docChanged) {
      setBufferText(update.state.doc.toString());
    }
  });

  const state = CM.EditorState.create({
    doc: currentRawText || "",
    extensions: [
      CM.lineNumbers(),
      CM.history(),
      CM.drawSelection(),
      CM.indentOnInput(),
      CM.bracketMatching(),
      CM.syntaxHighlighting(CM.defaultHighlightStyle, { fallback: true }),
      CM.markdown(),
      CM.search({ top: true }),
      CM.highlightActiveLine(),
      CM.keymap.of([
        ...CM.defaultKeymap,
        ...CM.historyKeymap,
        ...CM.searchKeymap,
        CM.indentWithTab,
      ]),
      CM.EditorView.lineWrapping,
      updateListener,
    ],
  });

  editorView = new CM.EditorView({
    state,
    parent: document.getElementById("editor-pane"),
  });

  setupSyncedScroll();
  return editorView;
}

// Fractional source-line position at the top of the editor viewport.
// Returns e.g. 47.3 meaning "30% of the way through line 47".
function fractionalLineAtEditorTop() {
  if (!editorView) return 1;
  const top = editorView.scrollDOM.scrollTop;
  try {
    const block = editorView.lineBlockAtHeight(top);
    const lineNum = editorView.state.doc.lineAt(block.from).number;
    const frac = block.height > 0 ? (top - block.top) / block.height : 0;
    return lineNum + Math.max(0, Math.min(1, frac));
  } catch { return 1; }
}

// Build piecewise-linear (sourceLine ↔ previewPixel) anchor list.
// Each section contributes two anchors — its top (startLine) and its bottom (endLine + 1).
// Blank lines between sections get their own interpolation slope across the CSS gap.
function buildPreviewAnchors() {
  const preview = contentEl();
  const sections = preview.querySelectorAll("[data-source-line]");
  if (sections.length === 0) return [];
  const prevTop = preview.getBoundingClientRect().top;
  const scrollTop = preview.scrollTop;
  const anchors = [];
  for (const sec of sections) {
    const r = sec.getBoundingClientRect();
    const secTop = r.top - prevTop + scrollTop;
    const secBottom = secTop + r.height;
    const start = parseInt(sec.dataset.sourceLine, 10);
    const end = parseInt(sec.dataset.sourceEndLine, 10);
    anchors.push({ line: start, y: secTop });
    anchors.push({ line: end + 1, y: secBottom });
  }
  return anchors;
}

function anchorsLineToY(anchors, L) {
  if (anchors.length === 0) return 0;
  if (L <= anchors[0].line) return anchors[0].y;
  const last = anchors[anchors.length - 1];
  if (L >= last.line) return last.y;
  // Find first j where anchors[j].line > L (strict). Bracket is [j-1, j].
  let j = 0;
  while (j < anchors.length && anchors[j].line <= L) j++;
  if (j === 0) return anchors[0].y;
  if (j >= anchors.length) return last.y;
  const a = anchors[j - 1], b = anchors[j];
  if (b.line === a.line) return b.y;
  const t = (L - a.line) / (b.line - a.line);
  return a.y + t * (b.y - a.y);
}

function anchorsYToLine(anchors, y) {
  if (anchors.length === 0) return 1;
  if (y <= anchors[0].y) return anchors[0].line;
  const last = anchors[anchors.length - 1];
  if (y >= last.y) return last.line;
  let j = 0;
  while (j < anchors.length && anchors[j].y <= y) j++;
  if (j === 0) return anchors[0].line;
  if (j >= anchors.length) return last.line;
  const a = anchors[j - 1], b = anchors[j];
  if (b.y === a.y) return b.line;
  const t = (y - a.y) / (b.y - a.y);
  return a.line + t * (b.line - a.line);
}

// Fractional source-line position at the top of the preview viewport.
function fractionalLineAtPreviewTop() {
  return anchorsYToLine(buildPreviewAnchors(), contentEl().scrollTop);
}

function scrollEditorToFractionalLine(lineFloat) {
  if (!editorView) return;
  const doc = editorView.state.doc;
  const line = Math.max(1, Math.min(Math.floor(lineFloat), doc.lines));
  try {
    const block = editorView.lineBlockAt(doc.line(line).from);
    const frac = Math.max(0, Math.min(1, lineFloat - line));
    editorView.scrollDOM.scrollTop = block.top + frac * block.height;
  } catch {}
}

function scrollPreviewToFractionalLine(lineFloat) {
  const preview = contentEl();
  const anchors = buildPreviewAnchors();
  if (anchors.length === 0) return;
  preview.scrollTop = anchorsLineToY(anchors, lineFloat);
}

function captureSourceLine() {
  if (editorView && (viewMode === "editor" || viewMode === "split")) return fractionalLineAtEditorTop();
  return fractionalLineAtPreviewTop();
}

function restoreSourceLine(lineFloat) {
  const apply = () => {
    if (editorView && (viewMode === "editor" || viewMode === "split")) scrollEditorToFractionalLine(lineFloat);
    if (viewMode !== "editor") scrollPreviewToFractionalLine(lineFloat);
  };
  requestAnimationFrame(() => requestAnimationFrame(apply));
}

function applyViewMode(mode) {
  const prevLine = captureSourceLine();
  viewMode = mode;
  localStorage.setItem("viewMode", mode);
  document.getElementById("workspace").setAttribute("data-mode", mode);
  const btn = document.getElementById("mode-btn");
  if (btn) btn.textContent = mode === "preview" ? "Preview" : mode === "split" ? "Split" : "Editor";
  if (mode !== "preview") {
    ensureEditor();
    setTimeout(() => editorView && editorView.requestMeasure(), 0);
  }
  const editToolbar = document.getElementById("edit-toolbar");
  if (editToolbar) editToolbar.hidden = mode === "preview";
  restoreSourceLine(prevLine);
}

function cycleViewMode() {
  const next = viewMode === "preview" ? "split" : viewMode === "split" ? "editor" : "preview";
  applyViewMode(next);
}

// === Splitter drag ===
function setupSplitter() {
  const splitter = document.getElementById("splitter");
  const workspace = document.getElementById("workspace");
  if (!splitter || !workspace) return;
  let dragging = false;
  splitter.addEventListener("pointerdown", (e) => {
    dragging = true;
    splitter.classList.add("dragging");
    splitter.setPointerCapture(e.pointerId);
  });
  splitter.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const rect = workspace.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    const clamped = Math.max(15, Math.min(85, pct));
    workspace.style.setProperty("--editor-width", clamped + "%");
  });
  splitter.addEventListener("pointerup", (e) => {
    dragging = false;
    splitter.classList.remove("dragging");
    splitter.releasePointerCapture(e.pointerId);
  });
}

// === Synced scroll between editor and preview ===
// Track which pane the user is actively driving. Only the driver's scroll events
// propagate to the other pane; programmatic scrolls on the follower don't echo back.
let scrollDriver = null; // 'editor' | 'preview' | null
let syncingScroll = false; // used by restoreScrollRatio for one-shot programmatic moves

// Build paired editor/preview pixel bounds per section. Within a section, editor-pixel
// fraction maps directly to preview-pixel fraction — so a long wrapped source line in
// the editor no longer stalls the preview before snapping ahead at the next line boundary.
function buildSectionPairs() {
  const preview = contentEl();
  const sections = preview.querySelectorAll("[data-source-line]");
  if (sections.length === 0 || !editorView) return [];
  const prevRect = preview.getBoundingClientRect();
  const prevScroll = preview.scrollTop;
  const doc = editorView.state.doc;
  const pairs = [];
  for (const sec of sections) {
    const start = Math.max(1, Math.min(parseInt(sec.dataset.sourceLine, 10), doc.lines));
    const end = Math.max(start, Math.min(parseInt(sec.dataset.sourceEndLine, 10), doc.lines));
    const r = sec.getBoundingClientRect();
    const pTop = r.top - prevRect.top + prevScroll;
    const pBottom = pTop + r.height;
    let eTop = 0, eBottom = 0;
    try {
      const startBlock = editorView.lineBlockAt(doc.line(start).from);
      const endBlock = editorView.lineBlockAt(doc.line(end).from);
      eTop = startBlock.top;
      eBottom = endBlock.bottom;
    } catch { continue; }
    pairs.push({ eTop, eBottom, pTop, pBottom });
  }
  return pairs;
}

// Map editor scrollTop → preview scrollTop using section pairs.
// Inside a section: linear pixel-fraction. Between sections: linear over the gap.
function mapY(pairs, y, srcKey, srcEndKey, dstKey, dstEndKey) {
  if (pairs.length === 0) return 0;
  if (y <= pairs[0][srcKey]) return pairs[0][dstKey];
  const last = pairs[pairs.length - 1];
  if (y >= last[srcEndKey]) return last[dstEndKey];
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    if (y >= p[srcKey] && y <= p[srcEndKey]) {
      const span = Math.max(1, p[srcEndKey] - p[srcKey]);
      const t = (y - p[srcKey]) / span;
      return p[dstKey] + t * (p[dstEndKey] - p[dstKey]);
    }
    if (i + 1 < pairs.length) {
      const n = pairs[i + 1];
      if (y > p[srcEndKey] && y < n[srcKey]) {
        const span = Math.max(1, n[srcKey] - p[srcEndKey]);
        const t = (y - p[srcEndKey]) / span;
        return p[dstEndKey] + t * (n[dstKey] - p[dstEndKey]);
      }
    }
  }
  return last[dstEndKey];
}

function setupSyncedScroll() {
  if (!editorView) return;
  const scroller = editorView.scrollDOM;
  const preview = contentEl();

  const claim = (who) => () => { scrollDriver = who; };
  const claimEditor = claim("editor");
  const claimPreview = claim("preview");

  for (const ev of ["wheel", "pointerdown", "keydown", "touchstart"]) {
    scroller.addEventListener(ev, claimEditor, { passive: true });
    preview.addEventListener(ev, claimPreview, { passive: true });
  }
  scroller.addEventListener("focusin", claimEditor);
  preview.addEventListener("focusin", claimPreview);

  scroller.addEventListener("scroll", () => {
    if (syncingScroll || viewMode !== "split" || scrollDriver !== "editor") return;
    const pairs = buildSectionPairs();
    preview.scrollTop = mapY(pairs, scroller.scrollTop, "eTop", "eBottom", "pTop", "pBottom");
  });
  preview.addEventListener("scroll", () => {
    if (syncingScroll || viewMode !== "split" || scrollDriver !== "preview") return;
    const pairs = buildSectionPairs();
    scroller.scrollTop = mapY(pairs, preview.scrollTop, "pTop", "pBottom", "eTop", "eBottom");
  });
}

// Prompt before closing window with unsaved changes
currentWindow.onCloseRequested(async (event) => {
  if (!isDirty) return;
  event.preventDefault();
  const choice = await invoke("plugin:dialog|ask", {
    message: "You have unsaved changes. Save before closing?",
    title: "Unsaved Changes",
    kind: "warning",
    yesButtonLabel: "Save",
    noButtonLabel: "Discard",
  });
  if (choice) {
    await saveFile();
    if (isDirty) return; // save failed or was cancelled
  }
  isDirty = false;
  await currentWindow.destroy();
});

// === Preview-pane search ===
const searchState = { query: "", caseSensitive: false, regex: false, matches: [], current: -1 };

function clearSearchHighlights() {
  const marks = contentEl().querySelectorAll("mark.search-hl");
  marks.forEach((m) => {
    const parent = m.parentNode;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
    parent.normalize();
  });
  searchState.matches = [];
  searchState.current = -1;
}

function buildSearchRegex() {
  if (!searchState.query) return null;
  const flags = "g" + (searchState.caseSensitive ? "" : "i");
  try {
    return searchState.regex
      ? new RegExp(searchState.query, flags)
      : new RegExp(searchState.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
  } catch {
    return null;
  }
}

function runSearch() {
  clearSearchHighlights();
  const re = buildSearchRegex();
  const countEl = document.getElementById("search-count");
  if (!re) {
    countEl.textContent = "0/0";
    return;
  }

  const walker = document.createTreeWalker(contentEl(), NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const tag = n.parentElement && n.parentElement.tagName;
      if (tag === "SCRIPT" || tag === "STYLE") return NodeFilter.FILTER_REJECT;
      return n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  for (const node of textNodes) {
    const text = node.textContent;
    re.lastIndex = 0;
    let match;
    const ranges = [];
    while ((match = re.exec(text)) !== null) {
      ranges.push([match.index, match.index + match[0].length]);
      if (match[0].length === 0) re.lastIndex++;
    }
    if (ranges.length === 0) continue;

    const frag = document.createDocumentFragment();
    let last = 0;
    for (const [start, end] of ranges) {
      if (start > last) frag.appendChild(document.createTextNode(text.slice(last, start)));
      const mark = document.createElement("mark");
      mark.className = "search-hl";
      mark.textContent = text.slice(start, end);
      frag.appendChild(mark);
      searchState.matches.push(mark);
      last = end;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }

  if (searchState.matches.length > 0) {
    searchState.current = 0;
    highlightCurrentMatch();
  }
  updateSearchCount();
}

function highlightCurrentMatch() {
  searchState.matches.forEach((m, i) => m.classList.toggle("current", i === searchState.current));
  const cur = searchState.matches[searchState.current];
  if (cur) cur.scrollIntoView({ block: "center", behavior: "smooth" });
}

function updateSearchCount() {
  const countEl = document.getElementById("search-count");
  const n = searchState.matches.length;
  countEl.textContent = n === 0 ? "0/0" : `${searchState.current + 1}/${n}`;
}

function nextMatch(dir) {
  if (searchState.matches.length === 0) return;
  searchState.current = (searchState.current + dir + searchState.matches.length) % searchState.matches.length;
  highlightCurrentMatch();
  updateSearchCount();
}

function openSearchBar() {
  // In editor/split mode, hand off to CodeMirror's built-in search if editor is focused
  if (editorView && (viewMode === "editor" || (viewMode === "split" && editorView.hasFocus))) {
    const CM = window.CM;
    if (CM && CM.openSearchPanel) {
      editorView.focus();
      CM.openSearchPanel(editorView);
      return;
    }
  }
  if (viewMode === "editor") {
    // No preview to search; fall back to opening editor's search
    if (editorView && window.CM) {
      editorView.focus();
      window.CM.openSearchPanel(editorView);
    }
    return;
  }
  const bar = document.getElementById("search-bar");
  bar.hidden = false;
  const input = document.getElementById("search-input");
  input.focus();
  input.select();
}

function closeSearchBar() {
  document.getElementById("search-bar").hidden = true;
  clearSearchHighlights();
  searchState.query = "";
  document.getElementById("search-input").value = "";
}

function setupSearch() {
  const input = document.getElementById("search-input");
  const caseBtn = document.getElementById("search-case");
  const regexBtn = document.getElementById("search-regex");

  input.addEventListener("input", () => {
    searchState.query = input.value;
    runSearch();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      nextMatch(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeSearchBar();
    }
  });
  caseBtn.addEventListener("click", () => {
    searchState.caseSensitive = !searchState.caseSensitive;
    caseBtn.classList.toggle("active", searchState.caseSensitive);
    runSearch();
  });
  regexBtn.addEventListener("click", () => {
    searchState.regex = !searchState.regex;
    regexBtn.classList.toggle("active", searchState.regex);
    runSearch();
  });
  document.getElementById("search-prev").addEventListener("click", () => nextMatch(-1));
  document.getElementById("search-next").addEventListener("click", () => nextMatch(1));
  document.getElementById("search-close").addEventListener("click", closeSearchBar);
}

// === Markdown insertion helpers (used by edit toolbar) ===
function wrapSelection(open, close = open, placeholder = "") {
  if (!editorView) return;
  const { from, to } = editorView.state.selection.main;
  const selected = editorView.state.sliceDoc(from, to);
  const inner = selected || placeholder;
  const insert = open + inner + close;
  editorView.dispatch({
    changes: { from, to, insert },
    selection: selected
      ? { anchor: from + open.length, head: from + open.length + inner.length }
      : { anchor: from + open.length, head: from + open.length + placeholder.length },
  });
  editorView.focus();
}

function prefixCurrentLine(prefix) {
  if (!editorView) return;
  const { from } = editorView.state.selection.main;
  const line = editorView.state.doc.lineAt(from);
  const existing = line.text;
  // If line already starts with the same prefix, toggle off
  const stripped = existing.replace(/^(#{1,6}\s|>\s|-\s|\d+\.\s)/, "");
  const newText = stripped.startsWith(prefix.trim() + " ") ? stripped : prefix + stripped;
  editorView.dispatch({
    changes: { from: line.from, to: line.to, insert: newText },
    selection: { anchor: line.from + newText.length },
  });
  editorView.focus();
}

function insertBlock(text) {
  if (!editorView) return;
  const { from } = editorView.state.selection.main;
  const doc = editorView.state.doc;
  const line = doc.lineAt(from);
  // Move to end of current line, then insert with surrounding blank lines
  const insertPos = line.to;
  const before = line.text.length > 0 ? "\n\n" : "\n";
  const after = "\n\n";
  const insert = before + text + after;
  editorView.dispatch({
    changes: { from: insertPos, to: insertPos, insert },
    selection: { anchor: insertPos + insert.length },
  });
  editorView.focus();
}

function insertLink() {
  if (!editorView) return;
  const { from, to } = editorView.state.selection.main;
  const selected = editorView.state.sliceDoc(from, to);
  const text = selected || "link text";
  const insert = `[${text}](https://)`;
  // Place cursor inside the URL parentheses (after "https://")
  const urlStart = from + text.length + 3; // [+text+](
  editorView.dispatch({
    changes: { from, to, insert },
    selection: { anchor: urlStart, head: from + insert.length - 1 },
  });
  editorView.focus();
}

const mdActions = {
  bold:      () => wrapSelection("**", "**", "bold text"),
  italic:    () => wrapSelection("*", "*", "italic text"),
  strike:    () => wrapSelection("~~", "~~", "struck text"),
  h1:        () => prefixCurrentLine("# "),
  h2:        () => prefixCurrentLine("## "),
  h3:        () => prefixCurrentLine("### "),
  link:      () => insertLink(),
  code:      () => wrapSelection("`", "`", "code"),
  codeblock: () => insertBlock("```\ncode\n```"),
  ul:        () => prefixCurrentLine("- "),
  ol:        () => prefixCurrentLine("1. "),
  quote:     () => prefixCurrentLine("> "),
  hr:        () => insertBlock("---"),
  pagebreak: () => insertBlock('<div class="page-break"></div>'),
};

function setupEditToolbar() {
  const bar = document.getElementById("edit-toolbar");
  if (!bar) return;
  bar.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-md]");
    if (!btn) return;
    const action = mdActions[btn.dataset.md];
    if (!action) return;
    if (!editorView) ensureEditor();
    action();
  });
}

// Cmd+B / Cmd+I shortcuts when editor is focused
window.addEventListener("keydown", (e) => {
  if (!editorView || viewMode === "preview") return;
  if (!editorView.hasFocus) return;
  if (e.metaKey && !e.shiftKey && !e.altKey) {
    if (e.key === "b") { e.preventDefault(); mdActions.bold(); }
    else if (e.key === "i") { e.preventDefault(); mdActions.italic(); }
  }
});

// Button click + check for file opened via Finder on launch
window.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("open-btn").addEventListener("click", openFileDialog);
  document.getElementById("save-btn").addEventListener("click", saveFile);
  document.getElementById("save-as-btn").addEventListener("click", saveFileAs);
  document.getElementById("print-btn").addEventListener("click", printDocument);
  document.getElementById("mode-btn").addEventListener("click", cycleViewMode);
  document.getElementById("zoom-in-btn").addEventListener("click", zoomIn);
  document.getElementById("zoom-out-btn").addEventListener("click", zoomOut);
  setupSplitter();
  setupSearch();
  setupEditToolbar();
  applyViewMode(viewMode);
  updateSaveButton();

  // Check immediately, then retry after delays to catch late-arriving Opened events
  if (!await checkPendingFile()) {
    setTimeout(() => checkPendingFile(), 300);
    setTimeout(() => checkPendingFile(), 1000);
  }
});
