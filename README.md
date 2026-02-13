# Scratch

<img src="docs/app-icon.png" alt="Scratch" width="128" height="128" style="border-radius: 22px; margin-bottom: 8px;">

A minimalist, offline-first markdown note-taking app for macOS and Windows.

![macOS](https://img.shields.io/badge/platform-macOS-lightgrey) ![Windows](https://img.shields.io/badge/platform-Windows-blue)

[Website](https://www.ericli.io/scratch) · [Releases](https://github.com/erictli/scratch/releases)

## Features

- **Offline-first** - No cloud, no account, no internet required
- **Markdown-based** - Notes stored as plain `.md` files you own
- **WYSIWYG editing** - Rich text editing that saves as markdown
- **Markdown source mode** - Toggle to view and edit raw markdown (`Cmd+Shift+M`)
- **Slash commands** - Type `/` to quickly insert headings, lists, code blocks, and more
- **Focus mode** - Distraction-free writing with animated sidebar/toolbar fade (`Cmd+Shift+Enter`)
- **Edit with Claude Code** - Use your local Claude Code CLI to edit notes
- **Works with other AI agents** - Detects external file changes
- **Keyboard optimized** - Lots of shortcuts and a command palette
- **Customizable** - Theme, typography, page width, and RTL text direction
- **Git integration** - Optional version control for your notes
- **Lightweight** - Less than 10% the size of Obsidian or Notion

## Screenshot

![Screenshot](docs/screenshot.png)

## Installation

### macOS

**Homebrew (Recommended)**

```bash
brew tap erictli/tap
brew install --cask erictli/tap/scratch
```

**Manual Download**

1. Download the latest `.dmg` from [Releases](https://github.com/erictli/scratch/releases)
2. Open the DMG and drag Scratch to Applications
3. Open Scratch from Applications

### Windows

Pre-built Windows binaries are not yet available. To run on Windows, build from source (see below).

### From Source

**Prerequisites:** Node.js 18+, Rust 1.70+

**macOS:** Xcode Command Line Tools · **Windows:** WebView2 Runtime (pre-installed on Windows 11)

```bash
git clone https://github.com/erictli/scratch.git
cd scratch
npm install
npm run tauri dev      # Development
npm run tauri build    # Production build
```

## Keyboard Shortcuts

Scratch is designed to be usable without a mouse. Here are the essentials to get started:

| Shortcut            | Action                 |
| ------------------- | ---------------------- |
| `Cmd+N`             | New note               |
| `Cmd+P`             | Command palette        |
| `Cmd+K`             | Add/edit link          |
| `Cmd+F`             | Find in note           |
| `Cmd+Shift+C`       | Copy as...             |
| `Cmd+Shift+M`       | Toggle Markdown source |
| `Cmd+Shift+Enter`   | Toggle Focus mode      |
| `Cmd+Shift+F`       | Search notes           |
| `Cmd+R`             | Reload current note    |
| `Cmd+,`             | Open settings          |
| `Cmd+\`             | Toggle sidebar         |
| `Cmd+B/I`           | Bold/Italic            |
| `↑/↓`               | Navigate notes         |

**Note:** On Windows, use `Ctrl` instead of `Cmd` for all shortcuts.

Many more shortcuts and features are available in the app—explore via the command palette (`Cmd+P` / `Ctrl+P`) or view the full reference in Settings → Shortcuts.

## Built With

[Tauri](https://tauri.app/) · [React](https://react.dev/) · [TipTap](https://tiptap.dev/) · [Tailwind CSS](https://tailwindcss.com/) · [Tantivy](https://github.com/quickwit-oss/tantivy)

## License

MIT
