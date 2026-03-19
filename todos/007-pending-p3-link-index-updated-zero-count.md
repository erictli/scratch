---
status: complete
priority: p3
issue_id: "007"
tags: [code-review, performance, rust]
dependencies: []
---

# Only emit link-index-updated when backlink rewrites actually occurred

## Problem Statement

`link-index-updated` is emitted unconditionally after every rename in `save_note`'s background task, even when `updated_count == 0` (no other notes referenced the old title). This causes the graph view to do a full `invoke("get_link_graph")` round-trip on every rename, including renames that affected zero files. Minor but unnecessary IPC + work.

## Findings

- `src-tauri/src/lib.rs`, tokio::spawn block: `app2.emit("link-index-updated", ...)` always fires
- `GraphView.tsx` listens and calls `doLoad()` (full graph fetch) on every event
- For a user who renames notes frequently without any wikilinks, this fires on every rename

## Proposed Solutions

Only emit the event when `updated_count > 0` OR when `old_title != new_title` AND there were potential matches:

```rust
let updated_count = result.unwrap_or(0);
if updated_count > 0 {
    let _ = app2.emit("link-index-updated", serde_json::json!({...}));
}
```

**Effort:** 5 minutes
**Risk:** None

## Acceptance Criteria

- [ ] `link-index-updated` event only fires when at least one note was rewritten
- [ ] Graph view still refreshes correctly when backlinks are updated
