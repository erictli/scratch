---
status: complete
priority: p2
issue_id: "004"
tags: [code-review, performance, rust, startup]
dependencies: []
---

# Merge double walkdir scan at startup into single pass

## Problem Statement

At startup (`run()`) and on folder change (`initialize_notes_folder`), the app performs two sequential walkdir scans over the entire notes folder: one for `SearchIndex::rebuild_index` and one for `LinkIndex::build`. Each scan calls `std::fs::read_to_string` on every note file. At 2000 notes × 5KB avg = 10MB of disk reads happening twice, adding ~250-700ms to cold startup time.

## Findings

- `src-tauri/src/lib.rs`, `run()` setup block: `rebuild_index(&folder_path)` then `LinkIndex::build(&folder_path)` — two sequential scans
- `src-tauri/src/lib.rs`, `initialize_notes_folder`: same pattern
- Both scans use `walkdir::WalkDir::new(folder).max_depth(10).filter_entry(is_visible_notes_entry)`
- Estimated added latency: ~250ms at 2000 notes, ~700ms at 5000 notes

## Proposed Solutions

### Option 1: Unified scan function (Recommended)

Add a `build_all_indexes` function that walks once and feeds both:

```rust
fn build_all_indexes(folder: &Path, search: &SearchIndex, link_index: &mut LinkIndex) {
    for entry in WalkDir::new(folder).max_depth(10).filter_entry(is_visible_notes_entry)... {
        if let Some(id) = id_from_abs_path(folder, file_path) {
            if let Ok(content) = std::fs::read_to_string(file_path) {
                // Feed search index
                let title = extract_title(&content);
                let _ = writer.add_document(doc!(...));
                // Feed link index
                let targets = extract_wikilink_targets(&content);
                link_index.forward.insert(id, targets);
            }
        }
    }
    writer.commit()?;
}
```

Halves total startup I/O. Both indexes are built from the same filesystem snapshot (consistent).

**Effort:** 1-2 hours
**Risk:** Low

## Acceptance Criteria

- [ ] App startup performs a single walkdir pass over the notes folder, not two
- [ ] Both search index and link index are populated correctly after the single pass
- [ ] `initialize_notes_folder` (folder change in settings) also uses the single pass
