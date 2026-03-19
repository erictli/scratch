---
status: complete
priority: p2
issue_id: "005"
tags: [code-review, agent-native, rust, api]
dependencies: []
---

# Add get_backlinks Tauri command for agent-accessible backlink queries

## Problem Statement

The graph view shows backlinks visually, but there is no programmatic way for an agent or external tool to ask "what notes link to note X?" An agent wanting to clean up references before deleting a note, or wanting to understand a note's connections, must pull the entire graph via `get_link_graph` and filter client-side. This is inefficient and not idiomatic. Agents lack the fundamental "what links here?" primitive.

Also: `get_link_graph` and its types (`LinkGraph`, `GraphNode`, `GraphEdge`) are not exposed in `src/services/notes.ts` or `src/types/note.ts`, making them invisible to the service layer used by other components.

## Findings

- Agent-native reviewer: "agents cannot answer 'what notes link to X?' without pulling the full graph and doing client-side filtering"
- `src-tauri/src/lib.rs`: `LinkIndex.forward` is a forward map only — no reverse map, but backlinks can be computed by scanning `forward` for entries containing the target title
- `src/services/notes.ts`: no wrapper for `get_link_graph`
- `src/types/note.ts`: `LinkGraph`, `GraphNode`, `GraphEdge` types defined inline in `GraphView.tsx` instead of shared

## Proposed Solutions

### Option 1: Add get_backlinks command + move types (Recommended)

**Rust** (`lib.rs`): Add a 10-line command:
```rust
#[tauri::command]
fn get_backlinks(note_id: String, state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let cache = state.notes_cache.read().expect("cache read lock");
    let li = state.link_index.lock().expect("link index mutex");
    let link_index = li.as_ref().ok_or("Link index not ready")?;
    // Find this note's title
    let title = cache.get(&note_id).map(|m| m.title.as_str()).unwrap_or(&note_id);
    // Find all notes whose forward links contain this title
    let backlinks: Vec<String> = link_index.forward.iter()
        .filter(|(_, targets)| targets.contains(title))
        .map(|(id, _)| id.clone())
        .collect();
    Ok(backlinks)
}
```

Register in `generate_handler![]`.

**TypeScript**: Move `LinkGraph`/`GraphNode`/`GraphEdge` to `types/note.ts`. Add to `services/notes.ts`:
```ts
export async function getLinkGraph(): Promise<LinkGraph> { return invoke("get_link_graph"); }
export async function getBacklinks(noteId: string): Promise<string[]> { return invoke("get_backlinks", { noteId }); }
```

**Effort:** 1 hour
**Risk:** Low

## Acceptance Criteria

- [ ] `get_backlinks(note_id)` Tauri command returns list of note IDs that link to the given note
- [ ] Command is registered in `generate_handler![]`
- [ ] `getLinkGraph()` and `getBacklinks()` are exported from `services/notes.ts`
- [ ] `LinkGraph`, `GraphNode`, `GraphEdge` types are defined in `types/note.ts`
- [ ] `GraphView.tsx` imports types from `types/note.ts` instead of defining them inline
