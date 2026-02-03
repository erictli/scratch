# Scratch

A minimalist, offline-first markdown note-taking app for Mac.

![Scratch](https://img.shields.io/badge/platform-macOS-lightgrey)

## Features

- **Offline-first** - No cloud, no account, no internet required
- **Markdown-based** - Notes stored as plain `.md` files you own
- **WYSIWYG editing** - Rich text editing that saves as markdown
- **Works with AI agents** - Live-syncing markdown files perfect for external editing
- **Full-text search** - Fast search with command palette
- **Git integration** - Optional version control for your notes
- **Customizable** - Theme (light/dark/system) and editor typography settings

## Installation

### From Source

Prerequisites:

- Node.js 18+
- Rust 1.70+
- Xcode Command Line Tools

```bash
# Clone the repository
git clone https://github.com/yourusername/scratch.git
cd scratch

# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

The built app will be in `src-tauri/target/release/bundle/`.

## Keyboard Shortcuts

Scratch is designed to be usable without a mouse. Here are the essentials to get started:

| Shortcut  | Action                |
| --------- | --------------------- |
| `Cmd+N`   | New note              |
| `Cmd+P`   | Command palette       |
| `Cmd+K`   | Add/edit link         |
| `Cmd+R`   | Reload current note   |
| `Cmd+,`   | Open settings         |
| `Cmd+\`   | Toggle sidebar        |
| `Cmd+B/I` | Bold/Italic           |
| `↑/↓`     | Navigate notes        |

Many more shortcuts and features are available in the app—explore via the command palette (`Cmd+P`).

## Built With

[Tauri](https://tauri.app/) · [React](https://react.dev/) · [TipTap](https://tiptap.dev/) · [Tailwind CSS](https://tailwindcss.com/) · [Tantivy](https://github.com/quickwit-oss/tantivy)

## License

MIT
