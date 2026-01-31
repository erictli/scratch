# Scratch

A minimalist markdown note-taking app for Mac, built with Tauri.

![Scratch](https://img.shields.io/badge/platform-macOS-lightgrey)

## Features

- **Native Mac app** - Fast, lightweight, and feels right at home on macOS
- **Markdown-first** - Notes stored as plain `.md` files you own
- **WYSIWYG editing** - Rich text editing with TipTap, saved as markdown
- **Full-text search** - Blazing fast search powered by Tantivy
- **Wikilinks** - Link notes together with `[[wikilinks]]`
- **Auto-save** - Changes saved automatically as you type
- **Dark mode** - Follows system theme or set manually
- **Typography settings** - Customize font family, size, and weight
- **Copy as** - Export notes as Markdown, Plain Text, or HTML
- **Command palette** - Quick access to actions with `Cmd+P`

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

## Usage

1. On first launch, select a folder to store your notes
2. Create notes with `Cmd+N`
3. Write in markdown - formatting is rendered as you type
4. Search notes with the search bar or `Cmd+P`
5. Link notes using `[[note title]]` syntax

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+N` | New note |
| `Cmd+P` | Command palette |
| `Cmd+K` | Add/edit link |
| `Cmd+B` | Bold |
| `Cmd+I` | Italic |
| `↑/↓` | Navigate notes |

## Tech Stack

- [Tauri v2](https://tauri.app/) - Native app framework
- [React](https://react.dev/) - UI framework
- [TipTap](https://tiptap.dev/) - Rich text editor
- [Tailwind CSS](https://tailwindcss.com/) - Styling
- [Tantivy](https://github.com/quickwit-oss/tantivy) - Full-text search

## License

MIT
