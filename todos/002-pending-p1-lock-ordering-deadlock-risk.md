---
status: complete
priority: p1
issue_id: "002"
tags: [code-review, security, rust, concurrency]
dependencies: []
---

# Fix ABBA deadlock risk: inconsistent lock ordering across save_note / get_link_graph / file watcher

## Problem Statement

Three code paths acquire `notes_cache` and `link_index` locks in different orders, creating an ABBA deadlock pattern. Two review agents independently flagged this.

- `save_note`: acquires `link_index` (~line 1137-1145), then `notes_cache.write()` (~line 1149-1151)
- `get_link_graph`: acquires `notes_cache.read()` first, then `link_index`
- File watcher: acquires `search_index` while inside that block acquires `link_index`

`RwLock` read locks don't block each other, but if `save_note` holds `link_index` and waits for `notes_cache.write()`, while `get_link_graph` holds `notes_cache.read()` and waits for `link_index`, that is a deadlock. Hasn't happened yet due to brief lock hold times, but it's structurally unsound.

## Findings

- `src-tauri/src/lib.rs`, `save_note`: `link_index` block at ~line 1137, `notes_cache.write()` at ~line 1149
- `src-tauri/src/lib.rs`, `get_link_graph`: `notes_cache.read()` then `link_index`
- `src-tauri/src/lib.rs`, file watcher (~line 2390): `search_index` held while acquiring `link_index` in all three branches
- Classic ABBA pattern — low probability per transaction, but the probability is nonzero and increases with vault size + frequent saves

## Proposed Solutions

### Option 1: Establish canonical lock order and fix save_note (Recommended)

Define and document a global lock order at the top of `AppState`:
```
notes_cache (RwLock) → search_index (Mutex) → link_index (Mutex) → debounce_map (Mutex)
```

In `save_note`: capture `old_title` from `notes_cache` early (already done), do `link_index` update, then immediately drop the `link_index` guard before taking `notes_cache.write()`:
```rust
{   // link_index block — dropped at end of this scope
    let mut li = state.link_index.lock().expect(...);
    if let Some(idx) = li.as_mut() { idx.update(&final_id, targets); }
}   // link_index dropped here
{   // now safe to take notes_cache.write()
    let mut cache = state.notes_cache.write().expect(...);
    cache.remove(old_id_str);
}
```

In file watcher: drop `search_index` guard before acquiring `link_index`:
```rust
// Use a scope block to ensure search_index drops before link_index acquisition
```

**Pros:** Minimal diff, clear documentation, matches Rust's RAII scoping
**Effort:** 1 hour
**Risk:** Low

### Option 2: Snapshot link_index under lock, process outside

In `get_link_graph`, clone the `forward` map under the lock, release immediately, do all processing on the clone:
```rust
let forward_snapshot = {
    let li = state.link_index.lock().expect(...);
    li.as_ref().map(|idx| idx.forward.clone())
};
// lock dropped, no contention during O(N*E) processing
```

**Pros:** Also fixes performance issue (lock held during O(N*E) in-degree computation)
**Effort:** 30 minutes
**Risk:** Low

## Acceptance Criteria

- [ ] A comment block at `AppState` documents the canonical lock acquisition order
- [ ] `save_note` drops `link_index` guard before acquiring `notes_cache.write()`
- [ ] File watcher drops `search_index` guard before acquiring `link_index`
- [ ] `get_link_graph` either holds both locks briefly OR uses a snapshot approach
