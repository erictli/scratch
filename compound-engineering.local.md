---
review_agents:
  - compound-engineering:review:kieran-typescript-reviewer
  - compound-engineering:review:security-sentinel
  - compound-engineering:review:julik-frontend-races-reviewer
  - compound-engineering:review:performance-oracle
  - compound-engineering:review:architecture-strategist
  - compound-engineering:review:code-simplicity-reviewer
---

# Scratch - Review Context

Tauri v2 (Rust) + React 19 + TypeScript desktop note-taking app. No database — notes are plain markdown files on disk. No Rails, no migrations.

Key patterns:
- Rust backend uses `std::sync::Mutex` / `std::sync::RwLock` (NOT tokio async locks) in Tauri commands
- Frontend uses dual-context pattern: `NotesDataContext` / `NotesActionsContext`
- TipTap editor with official `@tiptap/markdown` package (markdownTokenizer / parseMarkdown / renderMarkdown API)
- All file I/O goes through Tauri `invoke()` commands
