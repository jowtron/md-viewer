# MD Viewer

A simple, fast markdown viewer for macOS. Open `.md` files with a double-click, drag-and-drop, or the built-in file picker.

![MD Viewer screenshot](docs/screenshot.png)

## Features

- Renders Markdown including tables, code blocks, and inline formatting
- GitHub-inspired styling
- Light and dark mode with automatic system theme detection
- Adjustable zoom level (toolbar buttons or Cmd +/-)
- Open files via the toolbar, File menu, drag-and-drop, or double-clicking in Finder
- File associations for `.md`, `.markdown`, `.mdx`, and `.txt`

## Installation (macOS)

Download the latest `.dmg` from the [Releases](../../releases) page, open it, and drag **MD Viewer** to your Applications folder.

Two builds are provided per release:
- `MD.Viewer_*_aarch64.dmg` — Apple Silicon (M1/M2/M3/M4)
- `MD.Viewer_*_x86_64.dmg` — Intel

## Platform support

| Platform | Status |
|----------|--------|
| macOS | Fully tested |
| Linux | Built in CI, but **untested** |
| Windows | Built in CI, but **untested** |

Linux (`.deb`) and Windows (`.msi`/`.exe`) installers are produced by CI and attached to each release, but they have not been tested. Bug reports welcome.

## Usage

- **Open a file:** Click "Open File" in the toolbar, use File → Open (Cmd+O), drag a file onto the window, or double-click a `.md` file in Finder
- **Zoom:** Toolbar − / + buttons, or Cmd+− / Cmd+=
- **Theme:** Click the 🌙/☀️ button in the toolbar, or View → Toggle Dark Mode

## Building from source

**Requirements:** Rust (stable), Node.js 18+

```sh
git clone https://github.com/your-username/md-viewer.git
cd md-viewer
npm install
npm run tauri dev      # development
npm run tauri build    # production .app bundle
```

## License

MIT
