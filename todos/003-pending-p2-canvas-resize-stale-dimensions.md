---
status: complete
priority: p2
issue_id: "003"
tags: [code-review, frontend, graph, canvas]
dependencies: []
---

# Fix stale canvas dimensions on window resize

## Problem Statement

`width` and `height` are captured once when the simulation `useEffect` runs (`canvas.offsetWidth`, `canvas.offsetHeight`). The `draw()` function inside the closure uses these stale values for `ctx.clearRect(0, 0, width, height)`. If the user resizes the app window while the graph view is open, `clearRect` leaves rendering artifacts in the newly exposed area and nodes continue to simulate toward the old center point.

## Findings

- `src/components/graph/GraphView.tsx`, simulation effect: `const width = canvas.offsetWidth` captured as closure variable
- `draw()` uses `width`/`height` for `clearRect` — stale if canvas resizes
- `forceX(width/2)` and `forceY(height/2)` also use stale center — nodes drift toward old center after resize
- Canvas backing store (`canvas.width = width * devicePixelRatio`) is also set once and not updated
- No `ResizeObserver` or `window.resize` handler

## Proposed Solutions

### Option 1: Read dimensions from canvas inside draw() (Recommended)

Instead of closing over `width`/`height`, read them from the canvas element at draw time:

```tsx
function draw() {
  const w = canvas.width / devicePixelRatio;
  const h = canvas.height / devicePixelRatio;
  ctx.clearRect(0, 0, w, h);
  // use w/h for all coordinate math
}
```

Add a `ResizeObserver` to update canvas dimensions and reheat the simulation when the container resizes:
```tsx
const ro = new ResizeObserver(() => {
  const w = canvas.offsetWidth;
  const h = canvas.offsetHeight;
  canvas.width = w * devicePixelRatio;
  canvas.height = h * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);
  sim.force("x", d3.forceX(w / 2).strength(0.08));
  sim.force("y", d3.forceY(h / 2).strength(0.08));
  sim.alpha(0.1).restart();
});
ro.observe(canvas);
// cleanup: ro.disconnect()
```

**Effort:** 30 minutes
**Risk:** Low

## Acceptance Criteria

- [ ] Resizing the app window while graph view is open does not leave rendering artifacts
- [ ] After resize, nodes are gently pulled toward the new viewport center
- [ ] Canvas pixel density scales correctly on retina displays after resize
