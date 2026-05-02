# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [0.3.4] — 2026-05-03

### Added
- **macOS QuickLook preview extension.** Spacebar on a `.md`/`.markdown` file
  in Finder renders the document with the same `marked` parser and
  GitHub-style CSS the app itself uses, follows the system light/dark setting,
  and opens links in the default browser. Built as a sandboxed Swift
  `QLPreviewingController` compiled by `swiftc` directly (no Xcode project),
  with `marked` and `styles.css` inlined from `src/` at build time so there is
  one source of truth. Embedded into `md-viewer.app/Contents/PlugIns/` by
  `scripts/install-quicklook.sh`, which also patches the host `Info.plist`
  with a `UTExportedTypeDeclarations` entry for `.mdx` and unregisters stale
  duplicate copies. The CI release job builds and embeds the extension before
  repackaging the DMG. Requires a real (Apple Development or Developer ID)
  signing identity to load — ad-hoc-signed extensions are rejected by macOS at
  activation time.

## [0.3.3] — 2026-04-21

### Added
- **Print support** (Cmd+P) with print-specific stylesheet: clean pagination,
  light colors forced regardless of theme, URLs printed after links, and
  page-break rules that keep headings attached and avoid splitting code
  blocks / tables / images.
- **Editor mode powered by CodeMirror 6.** Three view modes toggle with Cmd+E
  (or the toolbar button): Preview, Split, Editor. Includes markdown syntax
  highlighting, line numbers, undo/redo, bracket matching, and line wrapping.
- **Split view** with draggable splitter and synced scrolling. Scroll one pane
  and the other follows, anchored at markdown section boundaries so the same
  block stays on screen in both.
- **Save** (Cmd+S) and **Save As…** (Cmd+Shift+S) from the editor. Dirty state
  is shown in the Save button (`Save •`) and a prompt appears on window close
  if there are unsaved changes.
- **Find in document** (Cmd+F). In the preview pane a custom search bar
  supports case-sensitive and regex matching with highlighted matches and
  prev/next navigation. In the editor pane, Cmd+F opens CodeMirror's built-in
  search.

### Changed
- **Theme is now always automatic.** The manual theme toggle was removed —
  the app follows the system `prefers-color-scheme` and updates live when
  the OS switches.
- **Position is preserved across view-mode switches.** Switching between
  Preview / Split / Editor no longer loses your place; the source-line
  currently at the viewport top is used to restore the same spot in the
  target mode.
- **Split-view scroll sync uses pixel-pair mapping.** Within each markdown
  section, editor-pixel fraction maps directly to preview-pixel fraction, so
  long wrapped source lines no longer cause the follower pane to stall and
  then snap forward. Section boundaries still act as anchors.

## [0.3.2] — 2026-03-16

### Fixed
- Save As was writing to the wrong directory when the Tauri fs plugin
  silently remapped paths; now writes via an explicit Rust command.

## [0.3.1] — 2026-03-11

### Added
- Clickable URLs in rendered markdown (bare URLs auto-linkify; external
  links open in the default browser).
- Horizontal scrolling for oversized content.
- Auto-resize window width to fit content on open, clamped to the screen.
- Cascading window positions when opening multiple files so they don't stack.

## [0.3.0] — 2026-03-07

### Added
- Save As support.
- Multi-window support: opening additional files while a window already has
  one loaded creates a new window.
- File path shown in the window title bar.

## [0.2.1] — 2026-02-26

### Added
- Custom MD Viewer app icon (replaced default Tauri icon).

## [0.2.0] — 2026-02-26

### Added
- Cross-platform CI that builds macOS (arm64 + x86_64), Linux, and Windows
  bundles on tag push and uploads them to a GitHub release.
- `DEVELOPMENT.md` documenting build issues and macOS file-association notes.

## [0.1.0] — 2026-02-26

### Added
- Initial release. Markdown viewer built on Tauri v2 with GitHub-style
  rendering, light/dark theme, zoom, open via toolbar / drag-and-drop /
  Finder double-click, and file associations for `.md`, `.markdown`,
  `.mdx`, and `.txt`.

[0.3.4]: https://github.com/jowtron/md-viewer/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/jowtron/md-viewer/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/jowtron/md-viewer/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/jowtron/md-viewer/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/jowtron/md-viewer/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/jowtron/md-viewer/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/jowtron/md-viewer/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/jowtron/md-viewer/releases/tag/v0.1.0
