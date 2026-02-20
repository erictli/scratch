# Scratch Mobile - Product Requirements Document

## Git-Synced Mobile Note-Taking App

**Version:** 1.0 Draft
**Date:** 2026-02-20
**Status:** Proposal

---

## 1. Executive Summary

Scratch Mobile extends the existing Scratch desktop markdown note-taking app to iOS and Android. The mobile app provides a focused, touch-optimized editing experience with bidirectional git-based sync to keep notes consistent across all devices. Users' notes remain plain markdown files in a git repository, preserving the open, portable philosophy of the desktop app.

### Goals

- Provide a native-feeling mobile companion to Scratch desktop
- Enable seamless sync between desktop and mobile via git
- Maintain offline-first architecture: full functionality without connectivity
- Preserve the plain-markdown, folder-based storage model
- Ship an MVP that covers the core read/edit/sync loop

### Non-Goals (v1)

- Full feature parity with desktop (focus mode, AI editing, slash commands)
- Multi-user collaboration or real-time co-editing
- Replacing the desktop app for power-user workflows
- Supporting non-git sync backends (iCloud, Dropbox, etc.)

---

## 2. Background & Motivation

### Current State

Scratch is a cross-platform desktop app (macOS, Windows, Linux) built with Tauri v2 + React/TypeScript + TipTap + Tantivy. It stores notes as plain `.md` files in a user-selected folder and includes basic git integration for version control (init, commit, push). However, the current git implementation is manual-only and desktop-bound.

### Problem

Users want to capture and review notes on mobile devices. Today they must use a separate app (or no app) to access their notes folder, with no integrated sync. The desktop git integration is also limited: it supports commit and push but lacks pull, conflict resolution, and automatic sync.

### Opportunity

A mobile app with automated git sync would:
- Enable capture-anywhere workflows (quick notes on the go, deep editing at the desk)
- Differentiate Scratch from cloud-locked note apps (Notion, Apple Notes)
- Appeal to developers and technical users who value git-based workflows
- Strengthen the desktop app's git integration as a side effect

---

## 3. User Personas

### Primary: Developer/Technical Writer
- Uses Scratch daily on desktop for work notes, documentation, meeting notes
- Wants to review/edit notes from their phone during commutes or meetings
- Comfortable with git concepts but wants sync to be automatic
- Values data ownership and portability (plain files, git history)

### Secondary: Knowledge Worker
- Uses Scratch for personal knowledge management
- Wants quick capture on mobile, longer editing sessions on desktop
- May not understand git internals; needs sync to "just work"
- Expects conflicts to be handled gracefully without data loss

### Tertiary: Student
- Takes notes across devices throughout the day
- Needs offline access (campus, transit)
- Budget-conscious; values free, open solutions
- Wants search to find notes quickly

---

## 4. Technical Architecture

### 4.1 Framework Decision

**Recommended: React Native with Expo**

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Tauri v2 Mobile** | Shares Rust backend; same frontend code | Mobile support is beta/unstable; limited native APIs; small ecosystem; WebView performance inconsistent on Android | Too risky for production |
| **React Native + Expo** | Mature ecosystem; strong TypeScript support; OTA updates; extensive native module library; good rich text editors available | Cannot directly reuse TipTap (web-only); new editor component needed; no Rust backend sharing | **Recommended** |
| **Capacitor.js** | Wraps existing React frontend as-is; minimal code changes | WebView-based (not native feel); poor mobile editor UX in WebView; limited git library support; smaller ecosystem | Acceptable fallback |
| **Flutter** | Excellent performance; good mobile UX | Completely different language (Dart); no code sharing with desktop; separate editor ecosystem | Not recommended for this project |

**Rationale:** React Native + Expo provides the best balance of ecosystem maturity, TypeScript code sharing (types, utilities, business logic), native mobile UX, and long-term maintainability. The main cost is replacing TipTap with a mobile-compatible editor, which is unavoidable on any native framework.

### 4.2 High-Level Architecture

```
+--------------------------------------------------+
|                  React Native App                 |
|                                                   |
|  +------------+  +----------+  +--------------+   |
|  |   Editor   |  | Note List|  |   Settings   |   |
|  | (rich text)|  | (search) |  | (git config) |   |
|  +------+-----+  +----+-----+  +------+-------+   |
|         |              |               |           |
|  +------+--------------+---------------+-------+   |
|  |              State Management               |   |
|  |         (Zustand or React Context)          |   |
|  +------+------------------+-------------------+   |
|         |                  |                       |
|  +------+------+   +------+-------+               |
|  |  Note Store |   |  Git Engine  |               |
|  | (filesystem)|   |(isomorphic-  |               |
|  |             |   |     git)     |               |
|  +------+------+   +------+-------+               |
|         |                  |                       |
|  +------+------------------+-------------------+   |
|  |           File System (device local)        |   |
|  |     ~/Documents/Scratch/.git (bare clone)   |   |
|  +---------------------------------------------+   |
+--------------------------------------------------+
```

### 4.3 Git Sync Engine

**Library: isomorphic-git**

`isomorphic-git` is a pure JavaScript implementation of git that runs in Node.js, browsers, and React Native. It provides programmatic access to clone, fetch, pull, push, commit, and merge operations without requiring the native git CLI (which is unavailable on iOS/Android).

**Why isomorphic-git:**
- Pure JS - runs anywhere, no native binary dependency
- Supports HTTP/HTTPS remotes (GitHub, GitLab, Bitbucket, self-hosted)
- Supports clone, fetch, pull, push, commit, status, log, merge
- Active maintenance and large user base
- Works with `react-native-fs` or Expo FileSystem for storage
- CORS-free when running natively (not in a browser)

**Authentication:**
- HTTPS tokens (GitHub PAT, GitLab PAT) stored in device Keychain/Keystore
- OAuth flow for GitHub/GitLab (open browser, receive token callback)
- No SSH support in isomorphic-git (HTTPS only - acceptable for mobile)

**Alternative considered:** `libgit2` via native bindings. This offers better performance and SSH support but adds significant complexity (native compilation per platform, C library maintenance, bridging overhead). Not recommended for v1.

### 4.4 Editor Component

**Recommended: Custom markdown editor with native text input**

Options evaluated:

| Editor | Approach | Pros | Cons |
|--------|----------|------|------|
| **react-native-markdown-editor** | Native TextInput + markdown preview | Simple, reliable, fast | Basic formatting only |
| **10tap-editor** | TipTap port for React Native (WebView) | Closest to desktop TipTap | WebView-based; potential performance issues |
| **@expensify/react-native-live-markdown** | Native markdown rendering in TextInput | True native; good performance | Newer library; may lack some formatting |
| **Custom split view** | TextInput (edit) + Markdown renderer (preview) | Full control; reliable | More development work |

**Recommendation for v1:** Start with `10tap-editor` (TipTap-based) for maximum compatibility with desktop note format, with the option to migrate to a native solution if WebView performance is problematic. This allows sharing markdown parsing logic and ensures formatting compatibility.

**Fallback:** If WebView editor performance is unacceptable, switch to a split-pane approach: native `TextInput` for raw markdown editing + `react-native-markdown-display` for preview. This is the pattern GitJournal uses successfully.

### 4.5 Search

**Approach: SQLite FTS5**

The desktop app uses Tantivy (Rust). On mobile, a practical alternative is SQLite with FTS5 (Full-Text Search), which is available natively on both iOS and Android.

- Index note title + content on save
- Full-text search with ranking
- Prefix matching for incremental search
- Rebuild index on clone/pull
- Library: `expo-sqlite` or `react-native-quick-sqlite`

### 4.6 File System

- **iOS:** App Documents directory (backed up to iCloud automatically if user enables)
- **Android:** App internal storage or scoped external storage
- Notes stored as `.md` files in a git working directory
- `.scratch/` folder for app settings and search index
- Library: `expo-file-system` for cross-platform file operations

---

## 5. Git Sync Design

### 5.1 Sync Model

The sync model is **automatic with manual override**, designed for simplicity and reliability.

```
                    +-----------+
                    |  Remote   |
                    |   Repo    |
                    | (GitHub)  |
                    +-----+-----+
                          |
              +-----------+-----------+
              |                       |
        +-----+-----+          +-----+-----+
        |  Desktop   |          |   Mobile   |
        |  (Tauri)   |          | (React     |
        |            |          |   Native)  |
        +-----+------+          +-----+------+
              |                       |
        +-----+------+          +-----+------+
        | Local .git  |          | Local .git  |
        | (notes dir) |          | (app docs)  |
        +-----------+          +-----------+
```

### 5.2 Sync Operations

#### Initial Setup (One-Time)
1. User enters remote repository URL (HTTPS)
2. User authenticates (GitHub PAT or OAuth)
3. App performs `git clone` of the repository
4. Notes become available immediately
5. Search index is built from cloned content

#### Automatic Sync Loop
```
App foreground / periodic timer (every 60s while active)
    |
    v
[1] git fetch origin
    |
    v
[2] Check for local uncommitted changes
    |-- Yes --> git add -A && git commit -m "Auto-sync from mobile"
    |-- No  --> continue
    |
    v
[3] Check if behind remote
    |-- Yes --> git pull --rebase origin main
    |           |-- Conflict? --> See conflict resolution (5.3)
    |           |-- Clean?    --> continue
    |-- No  --> continue
    |
    v
[4] Check if ahead of remote
    |-- Yes --> git push origin main
    |-- No  --> done (already in sync)
    |
    v
[Done] Update UI, refresh note list, rebuild search index if needed
```

#### Manual Sync
- Pull-to-refresh gesture on note list triggers immediate sync
- Sync status indicator in header (synced / syncing / error / offline)
- Force sync button in settings

#### Background Sync (Phase 2)
- iOS: Background App Refresh (limited, best-effort)
- Android: WorkManager periodic task
- Triggers the same sync loop
- Sends local notification if conflicts detected

### 5.3 Conflict Resolution Strategy

Conflicts are the hardest part of git sync on mobile. The strategy prioritizes **never losing data** over automatic resolution.

#### Conflict Scenarios

| Scenario | Detection | Resolution |
|----------|-----------|------------|
| **Same file edited on both devices** | `git pull --rebase` reports merge conflict | Create conflict copy (see below) |
| **File deleted on one, edited on other** | Git merge conflict | Keep the edited version; note the deletion in sync log |
| **File renamed on both devices** | Git detects rename conflict | Keep both files |
| **Concurrent edits, no overlap** | Git auto-merges cleanly | No user action needed |

#### Conflict Copy Strategy

When a merge conflict occurs on a file (e.g., `meeting-notes.md`):

1. **Preserve both versions:**
   - Keep the remote version as `meeting-notes.md`
   - Save the local version as `meeting-notes (conflict 2026-02-20).md`
2. **Notify the user:** Show a banner: "Sync conflict: 1 note has conflicting changes. Tap to review."
3. **Conflict review screen:** Show both versions side-by-side (or sequentially on small screens) with option to:
   - Keep remote version
   - Keep local version
   - Keep both (already done by default)
   - Open on desktop to merge manually
4. **Auto-commit resolution:** After user picks, commit the result with message "Resolve conflict: meeting-notes.md"

This approach is inspired by Obsidian Sync and Syncthing's conflict handling: never silently discard data, always create a conflict copy, let the user decide.

### 5.4 Merge Strategy: Rebase

Use `git pull --rebase` instead of merge commits:
- Keeps history linear and clean
- Avoids merge commit clutter from mobile syncs
- Conflicts surface immediately during rebase
- Desktop `git log` stays readable

### 5.5 Auto-Commit Behavior

Mobile auto-commits are intentionally minimal:
- **Commit message format:** `"Scratch mobile: update <note-title>"` (single note) or `"Scratch mobile: sync N notes"` (batch)
- **Commit grouping:** All unsaved changes are committed together before sync
- **No empty commits:** Skip if working directory is clean
- **Amend recent:** If the last commit is an auto-commit from the same device within the last 5 minutes, amend it instead of creating a new commit (keeps history clean)

### 5.6 Authentication

| Method | Platform | Storage |
|--------|----------|---------|
| **GitHub Personal Access Token** | iOS + Android | Keychain / Keystore (encrypted) |
| **GitHub OAuth (Device Flow)** | iOS + Android | Keychain / Keystore |
| **GitLab PAT** | iOS + Android | Keychain / Keystore |
| **Generic HTTPS credentials** | iOS + Android | Keychain / Keystore |

OAuth Device Flow is recommended for GitHub as the primary auth method: user visits a URL, enters a code, and the app receives a token. No redirect URI handling needed.

### 5.7 Offline Behavior

- All operations work offline (read, edit, create, delete, search)
- Changes accumulate as local uncommitted modifications
- On reconnection, sync loop runs automatically
- Offline indicator shown in UI header
- Queue of pending changes shown in sync status

---

## 6. Feature Specifications

### 6.1 MVP Features (v1.0)

#### Note Browsing
- Scrollable note list sorted by last modified
- Note title + preview text + relative date
- Pinned notes at top (synced via `.scratch/settings.json`)
- Pull-to-refresh to trigger sync
- Search bar with full-text search (SQLite FTS5)

#### Note Editing
- Rich text editor with markdown support
- Core formatting: bold, italic, headings (H1-H3), lists, code blocks, links, blockquotes
- Auto-save on pause (500ms debounce)
- Keyboard toolbar with formatting buttons (above keyboard)
- Task list support (checkboxes)

#### Note Management
- Create new note
- Delete note (with confirmation)
- Note title extracted from first `# Heading`

#### Git Sync
- One-time repository setup (clone)
- Automatic sync loop (fetch/commit/rebase/push)
- Manual pull-to-refresh sync trigger
- Sync status indicator (synced / syncing / error / offline)
- Conflict detection with conflict copy creation
- Basic conflict review (keep local / keep remote / keep both)
- Authentication via PAT or OAuth

#### Settings
- Repository URL configuration
- Authentication management
- Sync frequency toggle (auto / manual only)
- Theme (light / dark / system)
- About / version info

### 6.2 Phase 2 Features (v1.x)

- Background sync (iOS Background App Refresh, Android WorkManager)
- Image support (paste, camera capture, stored in `assets/`)
- Folder browsing and navigation
- Note sharing (share sheet integration)
- Quick capture widget (iOS widget / Android widget)
- Keyboard shortcuts for external keyboards (iPad)
- Table editing
- Export (share as PDF, markdown, plain text)
- Commit history viewer (per-note)
- Multi-remote support

### 6.3 Phase 3 Features (v2.0)

- Slash commands
- Focus mode
- Advanced conflict resolution (3-way merge view)
- Selective sync (choose which folders to sync)
- End-to-end encryption (git-crypt or age)
- SSH key authentication
- Apple Watch / Wear OS quick capture
- Siri / Google Assistant integration

---

## 7. User Flows

### 7.1 First Launch / Setup

```
[Welcome Screen]
    "Scratch - Your notes, everywhere"
    [Connect to Git Repository] button
    |
    v
[Repository Setup]
    Enter repository URL: [https://github.com/user/notes.git]
    [Continue]
    |
    v
[Authentication]
    [Sign in with GitHub] (OAuth Device Flow)
    -- or --
    [Enter Personal Access Token]
    |
    v
[Cloning...]
    Progress bar: "Downloading your notes..."
    |
    v
[Ready!]
    Note list populated
    "X notes synced"
    [Start Writing] button
```

### 7.2 Daily Use

```
[Open App]
    |
    v
[Note List] (auto-sync starts in background)
    - Sync spinner in header
    - Notes sorted by last modified
    - Search bar at top
    |
    v
[Tap Note]
    |
    v
[Editor]
    - Note content loaded
    - Keyboard toolbar appears on focus
    - Auto-save on pause (500ms)
    - Back button returns to list
    |
    v
[Return to List]
    - Changes auto-committed on navigation
    - Sync pushes changes to remote
```

### 7.3 Conflict Resolution

```
[Sync detects conflict]
    |
    v
[Banner appears]
    "1 note has conflicting changes"
    [Review] button
    |
    v
[Conflict Screen]
    Note: "meeting-notes.md"

    [Your version]          [Remote version]
    (show preview)          (show preview)

    [Keep Mine] [Keep Remote] [Keep Both]
    |
    v
[Resolution committed and pushed]
    "Conflict resolved"
```

---

## 8. Data Model

### 8.1 Local Storage Structure

```
{App Documents}/
├── repo/                          # Git working directory
│   ├── .git/                      # Git internals
│   ├── .scratch/
│   │   └── settings.json          # Shared settings (pinned notes, etc.)
│   ├── assets/                    # Images (phase 2)
│   ├── note-one.md
│   ├── note-two.md
│   └── subfolder/
│       └── nested-note.md
├── config.json                    # App config (repo URL, last sync time)
└── search.db                      # SQLite FTS5 search index
```

### 8.2 Config Schema

```typescript
interface MobileConfig {
  repositoryUrl: string;
  branch: string;                 // default: "main"
  syncMode: "auto" | "manual";
  syncIntervalSeconds: number;    // default: 60
  lastSyncTimestamp: number;
  lastSyncCommit: string;         // SHA of last synced commit
  theme: "light" | "dark" | "system";
}
```

### 8.3 Shared Types (Reused from Desktop)

```typescript
// These types are shared between desktop and mobile codebases
interface NoteMetadata {
  id: string;           // Relative path, no .md extension
  title: string;        // From first # heading
  preview: string;      // First non-heading line (100 chars)
  modified: number;     // Unix timestamp
}

interface Note extends NoteMetadata {
  content: string;      // Full markdown content
  path: string;         // Absolute file path on device
}

interface Settings {
  theme: { mode: "light" | "dark" | "system" };
  gitEnabled: boolean;
  pinnedNoteIds: string[];
  textDirection: "ltr" | "rtl";
}
```

---

## 9. Sync Protocol Details

### 9.1 Sync State Machine

```
                    +----------+
                    |   IDLE   |<---------+
                    +----+-----+          |
                         |                |
                    timer / manual        |
                    trigger               |
                         |                |
                    +----v-----+          |
               +--->| FETCHING |          |
               |    +----+-----+          |
               |         |                |
               |    +----v-------+        |
               |    | COMMITTING |        |
               |    | (if dirty) |        |
               |    +----+-------+        |
               |         |                |
               |    +----v-----+          |
               |    | REBASING |          |
               |    +----+-----+          |
               |         |                |
               |    conflict?             |
               |    /          \          |
               |  yes           no        |
               |   |             |        |
               |   v             v        |
               | +----------+ +----+----+ |
               | | CONFLICT | | PUSHING | |
               | | RESOLVE  | +----+----+ |
               | +----+-----+      |      |
               |      |            |      |
               |      +------+-----+      |
               |             |            |
               |        +----v-----+      |
               |        | UPDATING |------+
               |        | INDEX    |
               |        +----------+
               |
               +--- retry on network error (3 attempts, exponential backoff)
```

### 9.2 Sync Frequency

| App State | Sync Behavior |
|-----------|--------------|
| Foreground, active editing | Every 60 seconds |
| Foreground, idle | Every 120 seconds |
| Background (phase 2) | iOS: opportunistic via BGAppRefreshTask; Android: every 15 minutes via WorkManager |
| No network | Disabled; retry on connectivity change |

### 9.3 Bandwidth Considerations

- Git fetch is efficient (only transfers new objects)
- Typical note sync: < 10 KB per sync cycle
- Initial clone: depends on repository history size
- Shallow clone option for large repositories: `--depth 1` for initial setup, full clone available in settings

---

## 10. UI/UX Design Principles

### 10.1 Design Philosophy

- **Mobile-first, not desktop-shrunk.** Design for thumb zones, touch targets, and mobile attention spans.
- **Sync is invisible.** When sync works, users shouldn't think about it. Surface sync state only when action is needed.
- **Offline is normal.** Never show error states for offline. Just queue changes and sync when possible.
- **Speed over features.** App should launch to editable note in < 1 second. Optimize for the quick-capture use case.

### 10.2 Navigation Structure

```
[Tab Bar - bottom]
├── Notes          # Note list with search
├── + (FAB)        # Quick create new note
└── Settings       # Git config, theme, about
```

The app uses a minimal two-tab structure with a floating action button. No hamburger menus, no nested navigation beyond note list -> editor.

### 10.3 Key Screens

1. **Note List** - Full-screen scrollable list, search bar, sync status, pinned section
2. **Editor** - Full-screen editor with formatting toolbar above keyboard
3. **Settings** - Repository config, auth, sync preferences, theme
4. **Conflict Review** - Side-by-side (tablet) or sequential (phone) comparison
5. **Setup Wizard** - 3-step onboarding (repo URL, auth, clone)

### 10.4 Platform Conventions

| Aspect | iOS | Android |
|--------|-----|---------|
| Navigation | Native stack navigator, swipe-back | Material navigation, system back |
| Theme | SF Pro font, iOS blur effects | Roboto, Material You dynamic color |
| Haptics | UIKit haptic feedback on actions | Android haptic feedback |
| Share | iOS share sheet | Android share intent |
| Keyboard | iOS keyboard accessories | Android keyboard toolbar |
| Status bar | Adapts to theme | Material status bar |

---

## 11. Performance Requirements

| Metric | Target |
|--------|--------|
| Cold start to note list | < 2 seconds |
| Note open (tap to editable) | < 500ms |
| Search results appear | < 200ms |
| Sync cycle (no changes) | < 3 seconds |
| Sync cycle (small change) | < 5 seconds |
| Memory usage (idle) | < 100 MB |
| Memory usage (editing) | < 150 MB |
| Battery impact | < 2% per hour (foreground active use) |
| Offline storage | < 50 MB base app + notes |

---

## 12. Security Considerations

- **Credentials:** Git tokens stored in iOS Keychain / Android Keystore (hardware-backed encryption)
- **At rest:** Notes stored in app sandbox (encrypted by OS on locked device)
- **In transit:** HTTPS only for git operations (TLS 1.2+)
- **No telemetry:** No analytics, no crash reporting that includes note content
- **Token scoping:** GitHub OAuth requests minimal scope (`repo` only for private repos, `public_repo` for public)
- **Biometric lock (Phase 2):** Optional Face ID / fingerprint to open app

---

## 13. Testing Strategy

### Unit Tests
- Git sync engine: clone, fetch, commit, rebase, push, conflict detection
- Note parsing: title extraction, preview generation, frontmatter handling
- Search indexing and querying
- Conflict resolution logic

### Integration Tests
- Full sync cycle against test git repository
- Offline -> online transition with queued changes
- Conflict creation and resolution flow
- Authentication flow (mock OAuth)

### E2E Tests (Detox or Maestro)
- Setup wizard completion
- Create note -> edit -> sync -> verify on remote
- Pull-to-refresh with remote changes
- Conflict scenario: edit same note on two devices

### Manual Testing
- Real-device testing on iOS and Android
- Various network conditions (WiFi, cellular, offline, flaky)
- Large repositories (1000+ notes)
- Long notes (10000+ words)

---

## 14. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| isomorphic-git performance on large repos | Slow sync, poor UX | Medium | Shallow clone option; lazy loading; pagination |
| WebView editor performance (10tap-editor) | Janky editing experience | Medium | Fallback to native TextInput + markdown preview |
| Merge conflicts confuse non-technical users | User frustration, data anxiety | High | Conflict copy strategy (never lose data); clear UI; "resolve on desktop" escape hatch |
| GitHub rate limiting on frequent syncs | Sync failures | Low | Exponential backoff; 60s minimum interval; cache fetch results |
| iOS background execution limits | Stale data when app opened | High | Aggressive foreground sync; clear "last synced" timestamp; sync on app foreground |
| react-native-fs or expo-file-system limitations | Can't read/write .git internals | Low | isomorphic-git uses its own fs abstraction (lightning-fs or custom) |
| HTTPS-only auth (no SSH) | Blocks users with SSH-only repos | Medium | Document HTTPS requirement clearly; Phase 3 SSH support via native module |

---

## 15. Success Metrics

| Metric | Target (3 months post-launch) |
|--------|-------------------------------|
| App Store rating | >= 4.5 stars |
| Daily active users | Track growth week-over-week |
| Sync success rate | >= 99% of sync attempts succeed |
| Conflict rate | < 5% of sync cycles produce conflicts |
| Crash-free rate | >= 99.5% |
| Notes created on mobile | >= 20% of total notes created |
| Time to first sync (setup) | < 2 minutes from install |

---

## 16. Project Structure

```
scratch-mobile/
├── app/                           # Expo Router screens
│   ├── (tabs)/
│   │   ├── index.tsx              # Note list screen
│   │   └── settings.tsx           # Settings screen
│   ├── note/[id].tsx              # Editor screen
│   ├── setup/                     # Onboarding wizard
│   │   ├── repo.tsx
│   │   ├── auth.tsx
│   │   └── clone.tsx
│   └── conflict/[id].tsx          # Conflict resolution screen
├── components/
│   ├── editor/
│   │   ├── MobileEditor.tsx       # Rich text editor wrapper
│   │   └── FormattingToolbar.tsx  # Above-keyboard toolbar
│   ├── notes/
│   │   ├── NoteList.tsx           # Note list with search
│   │   └── NoteListItem.tsx       # Individual note row
│   ├── sync/
│   │   ├── SyncIndicator.tsx      # Header sync status
│   │   └── ConflictBanner.tsx     # Conflict notification
│   └── ui/                        # Shared UI components
├── lib/
│   ├── git/
│   │   ├── sync-engine.ts         # Core sync loop logic
│   │   ├── conflict-resolver.ts   # Conflict detection & resolution
│   │   ├── auth.ts                # Token management
│   │   └── operations.ts          # Git operation wrappers
│   ├── notes/
│   │   ├── parser.ts              # Markdown title/preview extraction
│   │   ├── storage.ts             # File system operations
│   │   └── search.ts              # SQLite FTS5 search
│   └── shared/                    # Types shared with desktop
│       └── types.ts
├── store/
│   ├── notes-store.ts             # Note state (Zustand)
│   ├── sync-store.ts              # Sync state
│   └── config-store.ts            # App configuration
├── app.json                       # Expo config
├── package.json
└── tsconfig.json
```

---

## 17. Dependency Overview

### Core
- `expo` ~52 - App framework
- `expo-router` ~4 - File-based navigation
- `react-native` 0.76+ - UI framework
- `isomorphic-git` ^1.27 - Git operations
- `expo-secure-store` - Credential storage (Keychain/Keystore)
- `expo-file-system` - File operations
- `expo-sqlite` - Search index (FTS5)

### Editor
- `10tap-editor` or `@expensify/react-native-live-markdown` - Rich text editing

### UI
- `nativewind` ^4 - Tailwind CSS for React Native (shares design tokens with desktop)
- `react-native-reanimated` - Animations
- `expo-haptics` - Tactile feedback

### State
- `zustand` ^5 - Lightweight state management

---

## 18. Desktop App Improvements (Side Effects)

Building the mobile sync engine will motivate improvements to the desktop app's git integration:

1. **Add `git pull` support** - Desktop currently lacks pull; needed for bidirectional sync
2. **Add `git fetch` support** - Check for remote changes without pulling
3. **Conflict detection** - Detect when local and remote have diverged
4. **Auto-sync option** - Optional automatic commit + push (matching mobile behavior)
5. **Sync status indicator** - Show last sync time and sync state in sidebar
6. **Custom commit messages** - Allow users to write commit messages (not just "Quick commit")

These improvements can be made independently of the mobile app and would improve the desktop experience on their own.

---

## 19. Open Questions

1. **Monorepo or separate repo?** Should `scratch-mobile` live in the same git repository as the desktop app (shared types via workspace) or in a separate repository?

2. **App Store distribution:** Free app? Paid? Freemium with sync as paid feature?

3. **Minimum OS versions:** iOS 16+? Android 10+? (Affects available APIs)

4. **Tablet-optimized layout?** Should iPad/Android tablet get a split-view (list + editor side by side)?

5. **Git hosting lock-in:** Should v1 be GitHub-only (simpler OAuth) or support any git host from day one?

6. **Desktop auto-sync:** Should the desktop app also adopt auto-sync to match mobile, or remain manual-commit-only?

7. **Shared component library:** How much UI code (design tokens, component patterns) should be shared between desktop and mobile via a shared package?

---

## 20. Timeline Overview

### Phase 1 - MVP
- Repository setup and clone flow
- Note list with search
- Markdown editor (rich text)
- Automatic git sync (fetch/commit/rebase/push)
- Conflict detection with conflict copy creation
- Basic settings (repo, auth, theme)
- iOS and Android builds

### Phase 2 - Polish
- Background sync
- Image support
- Folder navigation
- Quick capture widget
- Share sheet integration
- Tablet-optimized layout
- Commit history viewer

### Phase 3 - Advanced
- Slash commands
- Focus mode
- End-to-end encryption
- SSH authentication
- Advanced conflict resolution (3-way merge)
- Selective folder sync
- Watch/Wear OS companion
