import { useEffect, useRef, useState, useMemo } from "react";
import * as d3 from "d3";
import type { SimulationNodeDatum, SimulationLinkDatum, Simulation, ZoomTransform } from "d3";
import { listen } from "@tauri-apps/api/event";
import { useNotesData, useNotesActions } from "../../context/NotesContext";
import * as notesService from "../../services/notes";
import type { GraphNode as GraphNodeType, LinkGraph } from "../../types/note";
import "./GraphView.css";

// Extend base types with D3 simulation fields
interface GraphNode extends GraphNodeType, SimulationNodeDatum {}

interface GraphLink extends SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
}

interface SimLinkGraph {
  nodes: GraphNode[];
  edges: GraphLink[];
}

function toSimGraph(graph: LinkGraph): SimLinkGraph {
  return {
    nodes: graph.nodes.map((n) => ({ ...n })),
    edges: graph.edges.map((e) => ({ source: e.source, target: e.target })),
  };
}

function computeBfsSubgraph(graph: SimLinkGraph, rootId: string, maxDepth: number): SimLinkGraph {
  const adj = new Map<string, string[]>();
  for (const e of graph.edges) {
    const s = typeof e.source === "string" ? e.source : (e.source as GraphNode).id;
    const t = typeof e.target === "string" ? e.target : (e.target as GraphNode).id;
    if (!adj.has(s)) adj.set(s, []);
    if (!adj.has(t)) adj.set(t, []);
    adj.get(s)!.push(t);
    adj.get(t)!.push(s);
  }
  const visited = new Set<string>();
  const queue: { id: string; depth: number }[] = [{ id: rootId, depth: 0 }];
  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id) || depth > maxDepth) continue;
    visited.add(id);
    for (const neighbor of adj.get(id) ?? []) {
      if (!visited.has(neighbor)) queue.push({ id: neighbor, depth: depth + 1 });
    }
  }
  return {
    nodes: graph.nodes.filter((n) => visited.has(n.id)),
    edges: graph.edges.filter((e) => {
      const s = typeof e.source === "string" ? e.source : (e.source as GraphNode).id;
      const t = typeof e.target === "string" ? e.target : (e.target as GraphNode).id;
      return visited.has(s) && visited.has(t);
    }),
  };
}

function nodeRadius(n: GraphNode) {
  return 5 + Math.sqrt(n.linkCount ?? 0) * 3;
}

interface GraphViewProps {
  onClose: () => void;
}

export function GraphView({ onClose }: GraphViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Simulation<GraphNode, GraphLink> | null>(null);
  const transformRef = useRef<ZoomTransform>(d3.zoomIdentity);
  // searchQuery as a ref so the draw loop always reads the latest value
  // without causing the simulation to restart on every keystroke (#001)
  const searchQueryRef = useRef("");
  // drawRef lets the search-query effect trigger a repaint without re-running the sim
  const drawRef = useRef<(() => void) | null>(null);

  const [graphData, setGraphData] = useState<SimLinkGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [depthLimit, setDepthLimit] = useState<number | null>(null);

  const { currentNote } = useNotesData();
  const { selectNote } = useNotesActions();

  const selectNoteRef = useRef(selectNote);
  selectNoteRef.current = selectNote;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Keep searchQueryRef current on every render (no effects, no re-runs)
  searchQueryRef.current = searchQuery;

  // Fetch on mount + re-fetch when link index updates
  useEffect(() => {
    let cancelled = false;
    const doLoad = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await notesService.getLinkGraph();
        if (!cancelled) { setGraphData(toSimGraph(data)); setLoading(false); }
      } catch (e) {
        if (!cancelled) { setError(String(e)); setLoading(false); }
      }
    };
    doLoad();
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const unlistenPromise = listen("link-index-updated", () => {
      if (cancelled) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(doLoad, 500);
    });
    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      unlistenPromise.then((fn) => fn());
    };
  }, []);

  // BFS filtered graph (recomputed when data, depth, or current note changes)
  const filteredGraph = useMemo(() => {
    if (!graphData) return null;
    if (depthLimit !== null && currentNote) {
      return computeBfsSubgraph(graphData, currentNote.id, depthLimit);
    }
    return graphData;
  }, [graphData, depthLimit, currentNote?.id]);

  // Redraw on search query change WITHOUT restarting the simulation (#001)
  useEffect(() => {
    drawRef.current?.();
  }, [searchQuery]);

  // Main simulation + canvas render — only restarts when graph data changes (#001)
  useEffect(() => {
    if (!filteredGraph || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d")!;

    simRef.current?.stop();

    // Set initial canvas size
    const initWidth = canvas.offsetWidth || 900;
    const initHeight = canvas.offsetHeight || 700;
    canvas.width = initWidth * devicePixelRatio;
    canvas.height = initHeight * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);

    // Deep-copy nodes/edges so D3 mutations don't pollute state
    const simNodes: GraphNode[] = filteredGraph.nodes.map((n) => ({ ...n }));
    const simEdges: GraphLink[] = filteredGraph.edges.map((e) => ({
      source: typeof e.source === "string" ? e.source : (e.source as GraphNode).id,
      target: typeof e.target === "string" ? e.target : (e.target as GraphNode).id,
    }));

    const folders = [...new Set(simNodes.map((n) => n.folder))];
    const colorScale = d3.scaleOrdinal(folders, d3.schemeTableau10);

    const isDark = document.documentElement.classList.contains("dark") ||
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    const edgeColor = isDark ? "rgba(200,200,200,0.25)" : "rgba(0,0,0,0.15)";
    const labelColor = isDark ? "rgba(200,200,200,0.75)" : "rgba(80,80,80,0.85)";

    function draw() {
      // Read dimensions fresh from canvas each draw — avoids stale closure on resize (#003)
      const w = canvas.width / devicePixelRatio;
      const h = canvas.height / devicePixelRatio;
      // Read searchQuery from ref so this is always current without restarting the sim (#001)
      const searchLower = searchQueryRef.current.toLowerCase();

      const t = transformRef.current;
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(t.k, t.k);

      ctx.strokeStyle = edgeColor;
      ctx.lineWidth = 1 / t.k;
      for (const e of simEdges) {
        const src = e.source as GraphNode;
        const tgt = e.target as GraphNode;
        if (src.x == null || tgt.x == null) continue;
        ctx.beginPath();
        ctx.moveTo(src.x, src.y!);
        ctx.lineTo(tgt.x, tgt.y!);
        ctx.stroke();
      }

      for (const n of simNodes) {
        if (n.x == null) continue;
        const r = nodeRadius(n);
        const dimmed = searchLower && !n.title.toLowerCase().includes(searchLower);
        ctx.globalAlpha = dimmed ? 0.12 : 1;
        ctx.beginPath();
        ctx.arc(n.x, n.y!, r, 0, 2 * Math.PI);
        ctx.fillStyle = colorScale(n.folder);
        ctx.fill();
        ctx.strokeStyle = isDark ? "rgba(0,0,0,0.4)" : "#fff";
        ctx.lineWidth = 1.5 / t.k;
        ctx.stroke();
        if (t.k > 0.4) {
          ctx.globalAlpha = dimmed ? 0.12 : 1;
          ctx.fillStyle = labelColor;
          ctx.font = `${11 / t.k}px -apple-system, sans-serif`;
          ctx.textAlign = "center";
          const label = n.title.length > 24 ? n.title.slice(0, 23) + "…" : n.title;
          ctx.fillText(label, n.x, n.y! + r + 13 / t.k);
        }
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }

    // Expose draw so the search-query effect can trigger a repaint
    drawRef.current = draw;

    // Force simulation — deps: [filteredGraph] only (searchQuery excluded via ref pattern)
    const sim = d3.forceSimulation<GraphNode, GraphLink>(simNodes)
      .force("link", d3.forceLink<GraphNode, GraphLink>(simEdges).id((d) => d.id).distance(80).strength(0.5))
      .force("charge", d3.forceManyBody<GraphNode>().strength(-200).distanceMax(400))
      .force("x", d3.forceX<GraphNode>(initWidth / 2).strength(0.08))
      .force("y", d3.forceY<GraphNode>(initHeight / 2).strength(0.08))
      .alphaDecay(0.03)
      .velocityDecay(0.35)
      .on("tick", draw);

    simRef.current = sim;

    // ResizeObserver: update canvas dimensions + center forces on window resize (#003)
    const ro = new ResizeObserver(() => {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      if (w === 0 || h === 0) return;
      canvas.width = w * devicePixelRatio;
      canvas.height = h * devicePixelRatio;
      ctx.scale(devicePixelRatio, devicePixelRatio);
      sim.force("x", d3.forceX<GraphNode>(w / 2).strength(0.08));
      sim.force("y", d3.forceY<GraphNode>(h / 2).strength(0.08));
      if (sim.alpha() < 0.05) sim.alpha(0.1).restart();
      else draw();
    });
    ro.observe(canvas);

    function nodeAtCanvasPoint(cx: number, cy: number): GraphNode | null {
      const t = transformRef.current;
      const sx = (cx - t.x) / t.k;
      const sy = (cy - t.y) / t.k;
      for (const n of simNodes) {
        if (n.x == null) continue;
        const dx = sx - n.x;
        const dy = sy - n.y!;
        if (Math.sqrt(dx * dx + dy * dy) <= nodeRadius(n) + 2) return n;
      }
      return null;
    }

    const zoom = d3.zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.05, 12])
      .filter((event: Event) => {
        if (event.type === "mousedown") {
          const me = event as MouseEvent;
          const rect = canvas.getBoundingClientRect();
          if (nodeAtCanvasPoint(me.clientX - rect.left, me.clientY - rect.top)) return false;
        }
        return true;
      })
      .on("zoom", (e: d3.D3ZoomEvent<HTMLCanvasElement, unknown>) => {
        transformRef.current = e.transform;
        draw();
      });
    d3.select(canvas).call(zoom).on("dblclick.zoom", null);

    let dragMoved = false;
    let mouseDownPos = { x: 0, y: 0 };
    const DRAG_THRESHOLD = 4;

    const handleClick = (e: MouseEvent) => {
      if (dragMoved) return;
      const rect = canvas.getBoundingClientRect();
      const hit = nodeAtCanvasPoint(e.clientX - rect.left, e.clientY - rect.top);
      if (hit) { selectNoteRef.current(hit.id); onCloseRef.current(); }
    };
    canvas.addEventListener("click", handleClick);

    let dragging: GraphNode | null = null;
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      dragMoved = false;
      mouseDownPos = { x: e.clientX, y: e.clientY };
      const rect = canvas.getBoundingClientRect();
      const hit = nodeAtCanvasPoint(e.clientX - rect.left, e.clientY - rect.top);
      if (hit) { dragging = hit; hit.fx = hit.x; hit.fy = hit.y; sim.alphaTarget(0.3).restart(); }
    };
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging) return;
      const dx = e.clientX - mouseDownPos.x;
      const dy = e.clientY - mouseDownPos.y;
      if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) dragMoved = true;
      const rect = canvas.getBoundingClientRect();
      const t = transformRef.current;
      dragging.fx = (e.clientX - rect.left - t.x) / t.k;
      dragging.fy = (e.clientY - rect.top - t.y) / t.k;
    };
    const handleMouseUp = () => {
      if (dragging) { dragging.fx = null; dragging.fy = null; sim.alphaTarget(0); dragging = null; }
    };
    canvas.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      sim.stop();
      drawRef.current = null;
      ro.disconnect();
      d3.select(canvas).on(".zoom", null);
      canvas.removeEventListener("click", handleClick);
      canvas.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [filteredGraph]); // searchQuery intentionally excluded — handled via ref + drawRef

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onCloseRef.current(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="graph-view-overlay">
      <div className="graph-drag-region" data-tauri-drag-region />
      <div className="graph-view-header">
        <span className="graph-view-title">Graph View</span>
        <div className="graph-view-controls">
          <input
            type="text"
            className="graph-search-input"
            placeholder="Search notes…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <label className="graph-depth-label">
            Depth:
            <select
              className="graph-depth-select"
              value={depthLimit ?? "all"}
              onChange={(e) => {
                const val = e.target.value;
                setDepthLimit(val === "all" ? null : parseInt(val, 10));
              }}
            >
              <option value="all">All</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
              <option value="5">5</option>
            </select>
          </label>
        </div>
        <button className="graph-close-btn" onClick={onClose} title="Close (Esc)">✕</button>
      </div>

      <div className="graph-view-body">
        <canvas ref={canvasRef} className="graph-canvas" />
        {loading && <div className="graph-overlay-message">Loading graph…</div>}
        {error && !loading && (
          <div className="graph-overlay-message graph-overlay-error">
            Failed to load graph: {error}
          </div>
        )}
        {!loading && !error && graphData && graphData.nodes.length === 0 && (
          <div className="graph-overlay-message">
            No notes found. Create notes with [[wikilinks]] to see connections.
          </div>
        )}
      </div>
    </div>
  );
}
