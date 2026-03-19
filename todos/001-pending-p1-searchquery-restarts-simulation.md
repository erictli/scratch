---
status: complete
priority: p1
issue_id: "001"
tags: [code-review, performance, frontend, graph]
dependencies: []
---

# Remove searchQuery from simulation useEffect deps

## Problem Statement

`searchQuery` is in the dependency array of the main D3 simulation `useEffect` in `GraphView.tsx`. Every character typed in the search box tears down the entire simulation: stops it mid-layout, deep-copies all nodes/edges from scratch, creates new D3 forces, reattaches all event handlers, and restarts physics from alpha=1. With `alphaDecay(0.03)` this takes ~230 ticks (~3.8 seconds of animation) per keystroke. The user sees nodes jump back to random initial positions every time they type. Confirmed by 3 independent review agents.

## Findings

- `src/components/graph/GraphView.tsx`, simulation `useEffect` dep array: `[filteredGraph, searchQuery]`
- `searchQuery` is only needed inside `draw()` to dim non-matching nodes via `searchLower`
- `draw()` is defined inside the effect closure — it does NOT need to be recreated when `searchQuery` changes
- The existing `selectNoteRef` / `onCloseRef` pattern in the same file already demonstrates the correct approach (ref to avoid stale closure without effect restart)
- Also: D3's internal zoom state resets to identity on effect re-run, so after typing a search char, the next scroll/pan snaps the viewport to an unexpected position

## Proposed Solutions

### Option 1: Move searchQuery to a ref (Recommended)

```tsx
const searchQueryRef = useRef(searchQuery)
useEffect(() => { searchQueryRef.current = searchQuery; draw(); }, [searchQuery])
// draw() reads searchQueryRef.current — no closure capture of stale value
```

Remove `searchQuery` from `[filteredGraph, searchQuery]` dep array → just `[filteredGraph]`.
After updating the ref, call `draw()` directly (sim is still running/cooled, just need a repaint).

**Pros:** Zero performance cost, no sim restart, no viewport snap, consistent with existing ref pattern
**Cons:** Slightly indirect (ref instead of direct closure)
**Effort:** 30 minutes
**Risk:** Low

### Option 2: Separate draw-only useEffect

Keep two effects: one for simulation setup (deps: `[filteredGraph]`), one for redraw on search (deps: `[searchQuery]`) that calls `draw()` without touching the sim.

**Pros:** Clean separation of concerns
**Cons:** `draw()` needs to be lifted out of the sim effect — requires more refactoring
**Effort:** 1-2 hours
**Risk:** Medium

## Acceptance Criteria

- [ ] Typing in the search box does NOT restart the D3 simulation (nodes don't jump)
- [ ] Search highlighting (dim non-matching nodes) still works correctly
- [ ] Viewport zoom/pan position is preserved while typing in search
- [ ] Simulation continues cooling from wherever it was when search query changes
