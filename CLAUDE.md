# Scratch - Development Guide

## Project Overview

Scratch is a cross-platform markdown note-taking app for macOS, Windows, and Linux, built with Tauri v2 (Rust backend) + React/TypeScript/Tailwind (frontend) + TipTap (WYSIWYG editor) + Tantivy (full-text search).

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

## CI/CD

### CI (`ci.yml`)

Runs on every push to `main` and on PRs. Validates frontend build (`tsc` + Vite) and Rust compilation (`cargo check` + `cargo clippy`) on an Ubuntu runner. Does not build the Tauri app bundle.

### Release (`release.yml`)

Runs on `v*` tag push or manual `workflow_dispatch`. Builds, signs, and publishes for all platforms in parallel:

- **macOS**: Universal binary (arm64 + x86_64), code-signed and notarized
- **Windows**: NSIS installer (x64)
- **Linux**: AppImage and .deb

Creates a **draft** GitHub release with all artifacts and `latest.json` for the auto-updater.

### Releasing a New Version

1. Bump version in `package.json` and `src-tauri/tauri.conf.json`
2. Commit the version bump to `main`
3. Tag and push:
   ```bash
   git tag v0.5.0 && git push origin v0.5.0
   ```
4. The release workflow builds all platforms (~20-30 min)
5. Review the draft release on GitHub, edit release notes
6. Publish the release — the auto-updater endpoint immediately serves the new `latest.json`

### GitHub Secrets Required

These must be configured in the repo settings (Settings > Secrets and variables > Actions):

| Secret | Purpose |
|--------|---------|
| `APPLE_CERTIFICATE` | Base64-encoded .p12 export of Developer ID certificate |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the .p12 file |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Name (TEAMID)` |
| `APPLE_ID` | Apple Developer account email |
| `APPLE_PASSWORD` | App-specific password for notarization |
| `APPLE_TEAM_ID` | Apple Developer Team ID |
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of Tauri updater signing key |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for Tauri signing key |

### Auto-Updater

The app checks for updates via the Tauri updater plugin, which fetches `latest.json` from GitHub releases:
- Endpoint: `https://github.com/erictli/scratch/releases/latest/download/latest.json`
- On startup (after 3s delay) and manually via Settings > About > "Check for Updates"
- If a newer version is found, a toast appears with an "Update Now" button
- Config is in `src-tauri/tauri.conf.json` under `plugins.updater`

### Local Build (Manual)

For local testing without CI, you can still build manually:

```bash
# macOS universal binary (requires signing env vars from .env.build)
source .env.build
npm run tauri build -- --target universal-apple-darwin

# Windows (on a Windows machine)
npm run tauri build
```

## Project Structure

```
scratch/
├── .github/workflows/
│   ├── ci.yml                      # CI: build validation on push/PR
│   └── release.yml                 # Release: multi-platform build + publish
├── src/                            # React frontend
│   ├── components/
│   │   ├── editor/                 # TipTap editor + extensions
│   │   │   ├── Editor.tsx          # Main editor with auto-save, copy-as, format bar, source mode
│   │   │   ├── LinkEditor.tsx      # Inline link add/edit/remove popup
│   │   │   ├── SlashCommand.tsx    # Slash command extension for TipTap
│   │   │   └── SlashCommandList.tsx # Slash command popup menu UI
│   │   ├── layout/                 # Sidebar, main layout
│   │   │   ├── Sidebar.tsx         # Note list, search, git status
│   │   │   └── FolderPicker.tsx    # Initial folder selection dialog
│   │   ├── notes/
│   │   │   └── NoteList.tsx        # Scrollable note list with context menu
│   │   ├── command-palette/
│   │   │   └── CommandPalette.tsx  # Cmd+P for notes & commands
│   │   ├── settings/               # Settings page
│   │   │   ├── SettingsPage.tsx    # Tabbed settings interface
│   │   │   ├── GeneralSettingsSection.tsx       # Notes folder picker
│   │   │   ├── AppearanceSettingsSection.tsx    # Theme & typography
│   │   │   ├── ShortcutsSettingsSection.tsx     # Keyboard shortcuts reference
│   │   │   └── AboutSettingsSection.tsx         # App version, updates, and links
│   │   ├── ai/                     # AI editing components
│   │   │   ├── AiEditModal.tsx     # AI prompt input modal
│   │   │   └── AiResponseToast.tsx # AI response display with undo
│   │   ├── git/
│   │   │   └── GitStatus.tsx       # Floating git status with commit UI
│   │   ├── ui/                     # Shared UI components
│   │   │   ├── Button.tsx          # Button variants (default, ghost, outline, etc.)
│   │   │   ├── Input.tsx           # Form input
│   │   │   ├── Tooltip.tsx         # Radix UI tooltip wrapper
│   │   │   └── index.tsx           # ListItem, CommandItem, ToolbarButton exports
│   │   └── icons/                  # SVG icon components (30+ icons)
│   │       └── index.tsx
│   ├── context/                    # React context providers
│   │   ├── NotesContext.tsx        # Note CRUD, search, file watching
│   │   ├── GitContext.tsx          # Git operations wrapper
│   │   └── ThemeContext.tsx        # Theme mode & typography settings
│   ├── lib/                        # Utility functions
│   │   └── utils.ts                # cn() for className merging
│   ├── services/                   # Tauri command wrappers
│   │   ├── notes.ts                # Note management commands
│   │   ├── git.ts                  # Git commands
│   │   └── ai.ts                   # AI/Claude Code CLI commands
│   ├── types/
│   │   └── note.ts                 # TypeScript types
│   ├── App.tsx                     # Main app component
│   └── main.tsx                    # React root & providers
├── src-tauri/                      # Rust backend
│   ├── src/
│   │   ├── lib.rs                  # Tauri commands, state, file watcher, search
│   │   └── git.rs                  # Git CLI wrapper (8 commands)
│   ├── capabilities/default.json   # Tauri permissions config
│   └── Cargo.toml                  # Rust dependencies
└── package.json                    # Node dependencies & scripts
```

## Key Patterns

### Tauri Commands

All backend operations go through Tauri commands defined in `src-tauri/src/lib.rs`. Frontend calls them via `invoke()` from `@tauri-apps/api/core`.

### State Management

- `NotesContext` manages all note state, CRUD operations, and search
- `ThemeContext` handles light/dark/system theme, editor typography, text direction, and page width settings

### Settings

- **App config** (notes folder path): `{APP_DATA}/config.json`
- **Per-folder settings**: `{NOTES_FOLDER}/.scratch/settings.json`

The settings page provides UI for:

- Theme mode (light/dark/system)
- Editor typography (font family, size, line height, bold weight)
- Text direction (LTR/RTL)
- Page width (narrow/normal/wide/full)
- Git integration (optional)
- Keyboard shortcuts reference
- App version, updates, and project links

Power users can edit the settings JSON directly to customize colors.

### Editor

TipTap editor with extensions and features:

**Extensions:**
- StarterKit (basic formatting)
- Markdown (bidirectional conversion)
- Link, Image, TaskList, TaskItem, Table

**Key Features:**
- Auto-save with 300ms debounce
- Copy & Export menu (Markdown/Plain Text/HTML/PDF) via `Cmd+Shift+C`
- Inline link editor popup (`Cmd+K`) for add/edit/remove
- Format bar with 13 tools (bold, italic, headings, lists, code, etc.)
- Slash commands (`/`) for quick block insertion (headings, lists, code, etc.)
- Markdown source mode (`Cmd+Shift+M`) to view/edit raw markdown
- Focus mode (`Cmd+Shift+Enter`) for distraction-free writing with animated transitions
- RTL text direction support (configurable in settings)
- Configurable page width (narrow/normal/wide/full)
- Table editing with right-click context menu (insert/delete rows/columns, merge/split cells)
- Markdown paste detection and parsing
- Image insertion from disk
- External file change detection with auto-reload
- Find in note (`Cmd+F`) with highlighting
- "Last saved" status indicator
- Unsaved changes spinner
- AI editing with Claude Code CLI integration

### Component Architecture

**Context Providers:**
- `NotesContext` - Dual context pattern (data/actions separated for performance)
  - Data: notes, selectedNoteId, currentNote, searchResults, etc.
  - Actions: selectNote, createNote, saveNote, deleteNote, search, etc.
  - Race condition protection during note switches
  - Recently saved note tracking to ignore own file watcher events
- `GitContext` - Git operations with loading states and error handling
  - Auto-refresh status on file changes (1000ms debounce)
- `ThemeContext` - Theme mode, typography, text direction, and page width with CSS variable application

**Key Components:**
- `Editor` - Main editor with all editing features
- `LinkEditor` - Inline popup for link management
- `CommandPalette` - Cmd+P for quick actions and note search
- `GitStatus` - Floating commit UI in sidebar
- `NoteList` - Scrollable list with context menu and smart date formatting
- `SettingsPage` - Tabbed settings (General, Appearance, Shortcuts, About)
- `AiEditModal` - AI prompt input for Claude Code CLI integration
- `AiResponseToast` - AI response display with markdown parsing and undo button

### Tauri Commands

**Note Management:** `list_notes`, `read_note`, `save_note`, `delete_note`, `create_note`

**Configuration:** `get_notes_folder`, `set_notes_folder`, `get_settings`, `update_settings`

**Search:** `search_notes`, `rebuild_search_index` (Tantivy full-text with prefix fallback)

**File Watching:** `start_file_watcher` (notify crate with 500ms debounce per file)

**Git:** `git_is_available`, `git_get_status`, `git_init_repo`, `git_commit`, `git_push`, `git_add_remote`, `git_push_with_upstream`

**AI/Claude Code:** `ai_check_claude_cli`, `ai_execute_claude` (shell execution with Claude Code CLI)

**Utilities:** `copy_to_clipboard`, `copy_image_to_assets`, `save_clipboard_image`

**UI Helpers:** `open_folder_dialog`, `reveal_in_file_manager`, `open_url_safe` (URL scheme validated)

### Search Implementation

The app uses **Tantivy** (Rust full-text search engine) with:
- Schema: id (string), title (text), content (text), modified (i64)
- Full-text search with prefix query fallback (query*)
- Returns top 20 results with scoring
- Fallback to cache-based search (title/preview matching) if Tantivy fails

### File Watching

Uses `notify` crate with custom debouncing:
- 500ms debounce per file to batch rapid changes
- Emits "file-change" events to frontend
- Frontend filters events for currently edited note to prevent conflicts
- Debounce map cleanup (5 second retention)

### Permissions

Tauri v2 uses capability-based permissions. Add new permissions to `src-tauri/capabilities/default.json`. Core permissions use `core:` prefix (e.g., `core:menu:default`).

Current capabilities include:
- File system read/write for notes folder
- Dialog (folder picker)
- Clipboard
- Shell (for git commands)
- Window management

## Keyboard Shortcuts

- `Cmd+N` - New note
- `Cmd+P` - Command palette
- `Cmd+K` - Add/edit link (when in editor)
- `Cmd+F` - Find in current note
- `Cmd+Shift+C` - Open Copy & Export menu
- `Cmd+Shift+M` - Toggle Markdown source mode
- `Cmd+Shift+Enter` - Toggle Focus mode
- `Cmd+Shift+F` - Search notes
- `Cmd+R` - Reload current note (pull external changes)
- `Cmd+,` - Open settings
- `Cmd+1/2/3/4` - Switch settings tabs (General/Appearance/Shortcuts/About)
- `Cmd+\` - Toggle sidebar
- `Cmd+B/I` - Bold/Italic
- Arrow keys - Navigate note list (when focused)

**Note:** On Windows and Linux, use `Ctrl` instead of `Cmd` for all shortcuts. Full reference available in Settings → Shortcuts tab.

## Notes Storage

Notes are stored as markdown files in a user-selected folder. Filenames are derived from the note title (sanitized for filesystem safety). The first `# Heading` in the content becomes the note title displayed in the sidebar.

### File Watching

The app watches the notes folder for external changes (e.g., from AI agents or other editors). When a file changes externally, the sidebar updates automatically and the editor reloads the content if the current note was modified.

## Development Philosophy

### Code Quality
- Clean, minimal codebase with low technical debt
- Proper React patterns (contexts, hooks, memoization)
- Type-safe with TypeScript throughout
- No commented-out code or TODOs in production code

### Performance Optimizations
- Auto-save debouncing (300ms)
- Search debouncing (150ms in sidebar)
- File watcher debouncing (500ms per file)
- Git status refresh debouncing (1000ms)
- React.memo for expensive components (NoteList items)
- useCallback/useMemo for performance-critical paths

### User Experience
- Native macOS feel with drag region
- Keyboard-first navigation
- Smart date formatting (Today, Yesterday, X days ago)
- Inline editing (links, commits)
- Non-blocking operations (async everything)
- Error handling with user-friendly messages
