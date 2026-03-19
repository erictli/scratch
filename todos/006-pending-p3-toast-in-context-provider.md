---
status: complete
priority: p3
issue_id: "006"
tags: [code-review, architecture, frontend]
dependencies: []
---

# Move wikilink-update toast from NotesContext to component layer

## Problem Statement

`NotesContext.tsx` imports `toast` from `sonner` and shows a UI toast ("Updated wikilinks in N notes"). Context providers are data/state layers and shouldn't own toast rendering — it couples the context to a specific UI library and makes it harder to test or reuse.

## Findings

- `src/context/NotesContext.tsx`: `import { toast } from "sonner"` added at line ~12
- `toast.success(...)` called inside the `link-index-updated` listener
- All other toasts in the app originate from component layer (`App.tsx`, `Editor.tsx`, etc.)

## Proposed Solutions

### Option 1: Expose the event count via a callback prop or context value

Pass an optional `onLinksUpdated?: (count: number) => void` callback into the provider, called instead of the toast. The caller (`App.tsx`) shows the toast.

**Or simpler:** Add `linksUpdatedCount` to the actions context, and let `App.tsx` show the toast from a `useEffect` watching that value.

**Effort:** 30 minutes
**Risk:** Low

## Acceptance Criteria

- [ ] `NotesContext.tsx` does not import or call `toast`
- [ ] "Updated wikilinks in N notes" toast still appears in the UI
- [ ] Toast is triggered from the component layer (App.tsx or similar)
