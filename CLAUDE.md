# Scratch - Development Guide

## Project Overview

Scratch is a native Mac markdown note-taking app built with Tauri v2 (Rust backend) + React/TypeScript/Tailwind (frontend) + TipTap (WYSIWYG editor) + Tantivy (full-text search).

## Tech Stack

- **Backend**: Tauri v2, Rust
- **Frontend**: React 19, TypeScript, Tailwind CSS v4
- **Editor**: TipTap with markdown support
- **Search**: Tantivy full-text search engine
- **File watching**: notify crate with custom debouncing

## Commands

```bash
npm run dev          # Start Vite dev server only
npm run build        # Build frontend (tsc + vite)
npm run tauri dev    # Run full app in development mode
npm run tauri build  # Build production app
```

## Project Structure

```
scratch/
├── src/                            # React frontend
│   ├── components/
│   │   ├── editor/                 # TipTap editor + extensions
│   │   ├── layout/                 # Sidebar, main layout
│   │   ├── notes/                  # NoteList
│   │   ├── command-palette/        # Cmd+P command palette
│   │   ├── settings/               # Settings page
│   │   ├── ui/                     # Shared UI components
│   │   └── icons/                  # SVG icon components
│   ├── context/                    # React context (NotesContext, ThemeContext)
│   ├── lib/                        # Utility functions
│   └── services/                   # Tauri command wrappers
├── src-tauri/                      # Rust backend
│   ├── src/
│   │   ├── lib.rs                  # All Tauri commands, state, file watcher
│   │   └── git.rs                  # Git integration
│   └── capabilities/default.json   # Tauri permissions
└── package.json
```

## Key Patterns

### Tauri Commands

All backend operations go through Tauri commands defined in `src-tauri/src/lib.rs`. Frontend calls them via `invoke()` from `@tauri-apps/api/core`.

### State Management

- `NotesContext` manages all note state, CRUD operations, and search
- `ThemeContext` handles light/dark/system theme and editor typography settings

### Settings

- **App config** (notes folder path): `{APP_DATA}/config.json`
- **Per-folder settings**: `{NOTES_FOLDER}/.scratch/settings.json`

The settings page provides UI for:

- Theme mode (light/dark/system)
- Editor typography (font family, size, bold weight)
- Git integration (optional)

Power users can edit the settings JSON directly to customize colors.

### Editor

TipTap editor with extensions:

- StarterKit (basic formatting)
- Markdown (bidirectional conversion)
- Link, Image, TaskList, TaskItem

### Permissions

Tauri v2 uses capability-based permissions. Add new permissions to `src-tauri/capabilities/default.json`. Core permissions use `core:` prefix (e.g., `core:menu:default`).

## Keyboard Shortcuts

- `Cmd+N` - New note
- `Cmd+P` - Command palette
- `Cmd+K` - Add/edit link (when in editor)
- `Cmd+B/I` - Bold/Italic
- Arrow keys - Navigate note list (when focused)

## Notes Storage

Notes are stored as markdown files in a user-selected folder. Filenames are derived from the note title (sanitized for filesystem safety). The first `# Heading` in the content becomes the note title displayed in the sidebar.

### File Watching

The app watches the notes folder for external changes (e.g., from AI agents or other editors). When a file changes externally, the sidebar updates automatically and the editor reloads the content if the current note was modified.
