# Scratch

<img src="docs/app-icon.png" alt="Scratch" width="128" height="128" style="border-radius: 22px; margin-bottom: 8px;">

A minimalist, offline-first markdown note-taking app for Mac.

![macOS](https://img.shields.io/badge/platform-macOS-lightgrey)

## Features

- **Offline-first** - No cloud, no account, no internet required
- **Markdown-based** - Notes stored as plain `.md` files you own
- **WYSIWYG editing** - Rich text editing that saves as markdown
- **Works with AI agents** - Detects external file changes and refreshes on demand
- **Full-text search** - Fast search with command palette
- **Git integration** - Optional version control for your notes
- **Customizable** - Theme (light/dark/system) and editor typography settings

## Screenshot

![Screenshot](docs/screenshot.png)

## Installation

### Homebrew (Recommended)

```bash
brew tap erictli/tap
brew install --cask erictli/tap/scratch
```

### Manual Download

1. Download the latest DMG from [Releases](https://github.com/erictli/scratch/releases)
2. Open the DMG and drag Scratch to Applications
3. Open Scratch from Applications

### From Source

Prerequisites: Node.js 18+, Rust 1.70+, Xcode Command Line Tools

```bash
git clone https://github.com/erictli/scratch.git
cd scratch
npm install
npm run tauri dev      # Development
npm run tauri build    # Production build
```

## Keyboard Shortcuts

Scratch is designed to be usable without a mouse. Here are the essentials to get started:

| Shortcut  | Action              |
| --------- | ------------------- |
| `Cmd+N`   | New note            |
| `Cmd+P`   | Command palette     |
| `Cmd+K`   | Add/edit link       |
| `Cmd+R`   | Reload current note |
| `Cmd+,`   | Open settings       |
| `Cmd+\`   | Toggle sidebar      |
| `Cmd+B/I` | Bold/Italic         |
| `↑/↓`     | Navigate notes      |

Many more shortcuts and features are available in the app—explore via the command palette (`Cmd+P`).

## Built With

[Tauri](https://tauri.app/) · [React](https://react.dev/) · [TipTap](https://tiptap.dev/) · [Tailwind CSS](https://tailwindcss.com/) · [Tantivy](https://github.com/quickwit-oss/tantivy)

## License

MIT
