# Scratch - Development Guide

## Project Overview

Scratch is a cross-platform markdown note-taking app for macOS and Windows, built with Tauri v2 (Rust backend) + React/TypeScript/Tailwind (frontend) + TipTap (WYSIWYG editor) + Tantivy (full-text search).

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

## Building for Release

**Before building:** Bump version in `package.json` and `src-tauri/tauri.conf.json`

### macOS Build (Universal Binary)

Builds a universal binary supporting both Intel and Apple Silicon Macs.

**Prerequisites:**
```bash
rustup target add x86_64-apple-darwin
rustup target add aarch64-apple-darwin
```

**Build Steps:**

1. Set up environment (credentials in `.env.build`):
   ```bash
   source .env.build
   PATH="/usr/bin:$PATH"  # Ensure system xattr is used, not Python's
   ```

2. Clean previous build and build universal binary:
   ```bash
   rm -rf src-tauri/target/release/bundle
   npm run tauri build -- --target universal-apple-darwin
   ```

3. Submit for notarization:
   ```bash
   xcrun notarytool submit src-tauri/target/release/bundle/macos/Scratch.zip \
     --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" --wait
   ```

4. Staple the notarization ticket:
   ```bash
   xcrun stapler staple src-tauri/target/release/bundle/macos/Scratch.app
   ```

5. Create DMG with Applications symlink:
   ```bash
   mkdir -p /tmp/scratch-dmg
   cp -R src-tauri/target/release/bundle/macos/Scratch.app /tmp/scratch-dmg/
   ln -sf /Applications /tmp/scratch-dmg/Applications
   hdiutil create -volname "Scratch" -srcfolder /tmp/scratch-dmg -ov -format UDZO \
     src-tauri/target/release/bundle/dmg/Scratch_VERSION_universal.dmg
   rm -rf /tmp/scratch-dmg
   ```

6. Get checksum and upload: `shasum -a 256 <dmg_path>`

### Windows Build

Builds `.msi` installer and `.exe` setup for Windows.

**Prerequisites:**
- Windows machine or VM
- Rust toolchain installed (`rustup`)
- WebView2 Runtime (usually pre-installed on Windows 11)

**Build Steps:**

1. Clean previous build:
   ```powershell
   Remove-Item -Recurse -Force src-tauri\target\release\bundle
   ```

2. Build installers:
   ```powershell
   npm run tauri build
   ```

3. Outputs will be in `src-tauri/target/release/bundle/`:
   - `msi/Scratch_VERSION_x64_en-US.msi` - MSI installer
   - `nsis/Scratch_VERSION_x64-setup.exe` - NSIS setup (recommended for distribution)

4. Get checksum and upload:
   ```powershell
   Get-FileHash .\src-tauri\target\release\bundle\nsis\Scratch_VERSION_x64-setup.exe -Algorithm SHA256
   ```

**Notes:**
- The NSIS setup (`.exe`) automatically downloads WebView2 if needed
- For x86 support, add `--target i686-pc-windows-msvc` (requires `rustup target add i686-pc-windows-msvc`)

## Project Structure

```
scratch/
├── src/                            # React frontend
│   ├── components/
│   │   ├── editor/                 # TipTap editor + extensions
│   │   │   ├── Editor.tsx          # Main editor with auto-save, copy-as, format bar
│   │   │   └── LinkEditor.tsx      # Inline link add/edit/remove popup
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
│   │   │   ├── GitSettingsSection.tsx           # Git config & remote
│   │   │   └── ShortcutsSettingsSection.tsx     # Keyboard shortcuts reference
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
- `ThemeContext` handles light/dark/system theme and editor typography settings

### Settings

- **App config** (notes folder path): `{APP_DATA}/config.json`
- **Per-folder settings**: `{NOTES_FOLDER}/.scratch/settings.json`

The settings page provides UI for:

- Theme mode (light/dark/system)
- Editor typography (font family, size, line height, bold weight)
- Git integration (optional)
- Keyboard shortcuts reference

Power users can edit the settings JSON directly to customize colors.

### Editor

TipTap editor with extensions and features:

**Extensions:**
- StarterKit (basic formatting)
- Markdown (bidirectional conversion)
- Link, Image, TaskList, TaskItem, Table

**Key Features:**
- Auto-save with 300ms debounce
- Copy-as menu (Markdown/Plain Text/HTML) via `Cmd+Shift+C`
- Inline link editor popup (`Cmd+K`) for add/edit/remove
- Format bar with 13 tools (bold, italic, headings, lists, code, etc.)
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
- `ThemeContext` - Theme mode and typography with CSS variable application

**Key Components:**
- `Editor` - Main editor with all editing features
- `LinkEditor` - Inline popup for link management
- `CommandPalette` - Cmd+P for quick actions and note search
- `GitStatus` - Floating commit UI in sidebar
- `NoteList` - Scrollable list with context menu and smart date formatting
- `SettingsPage` - Tabbed settings (General, Appearance, Git, Shortcuts)
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
- `Cmd+Shift+C` - Copy as (Markdown/Plain Text/HTML)
- `Cmd+R` - Reload current note (pull external changes)
- `Cmd+,` - Open settings
- `Cmd+1/2/3` - Switch settings tabs (General/Appearance/Shortcuts)
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

## Recent Development

Recent commits show continuous improvement:
- AI editing with Claude Code CLI integration (invoke Claude to edit notes)
- Table editing support with context menu operations
- Keyboard shortcuts reference page in settings
- Find in note functionality with search highlighting
- Yellow selection highlight and UI polish
- Inline link editor (replaced wikilink support)
- Git integration with push/remote management
- Settings UI simplification
- Copy-as feature (Markdown/Plain/HTML)
- Task list styling improvements
- Cross-platform keyboard support (Ctrl on non-Mac)
