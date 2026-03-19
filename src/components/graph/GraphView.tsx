import { useEffect, useRef, useState, useMemo } from "react";
import * as d3 from "d3";
import type {
  SimulationNodeDatum,
  SimulationLinkDatum,
  Simulation,
} from "d3";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useNotesData, useNotesActions } from "../../context/NotesContext";
import "./GraphView.css";

// Extend D3 base types with our domain fields
interface GraphNode extends SimulationNodeDatum {
  id: string;
  title: string;
  folder: string;
  linkCount: number;
}

interface GraphLink extends SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
}

interface LinkGraph {
  nodes: GraphNode[];
  edges: GraphLink[];
}

// BFS to compute subgraph within maxDepth hops from rootId
function computeBfsSubgraph(
  graph: LinkGraph,
  rootId: string,
  maxDepth: number
): LinkGraph {
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

  const nodeSet = new Set<string>();
  for (const n of graph.nodes) {
    if (visited.has(n.id)) nodeSet.add(n.id);
  }

  return {
    nodes: graph.nodes.filter((n) => nodeSet.has(n.id)),
    edges: graph.edges.filter((e) => {
      const s = typeof e.source === "string" ? e.source : (e.source as GraphNode).id;
      const t = typeof e.target === "string" ? e.target : (e.target as GraphNode).id;
      return nodeSet.has(s) && nodeSet.has(t);
    }),
  };
}

const MAX_NODES = 500;

interface GraphViewProps {
  onClose: () => void;
}

export function GraphView({ onClose }: GraphViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const simRef = useRef<Simulation<GraphNode, GraphLink> | null>(null);

  const [graphData, setGraphData] = useState<LinkGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [depthLimit, setDepthLimit] = useState<number | null>(null);

  const { currentNote } = useNotesData();
  const { selectNote } = useNotesActions();

  // Stable reference for selectNote to avoid stale closures in D3 handlers
  const selectNoteRef = useRef(selectNote);
  selectNoteRef.current = selectNote;

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Initial load + subscribe to link-index-updated for refresh
  useEffect(() => {
    let cancelled = false;

    const doLoad = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await invoke<LinkGraph>("get_link_graph");
        if (!cancelled) {
          setGraphData(data);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setLoading(false);
        }
      }
    };

    doLoad();

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const unlistenPromise = listen("link-index-updated", () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(doLoad, 500);
    });

    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      unlistenPromise.then((fn) => fn());
    };
  }, []);

  // Zoom setup (once)
  useEffect(() => {
    if (!svgRef.current || !gRef.current) return;
    const svg = d3.select(svgRef.current);
    const g = d3.select(gRef.current);
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.05, 8])
      .on("zoom", (e: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        g.attr("transform", e.transform.toString());
      });
    svg.call(zoom).on("dblclick.zoom", null);
    return () => {
      svg.on(".zoom", null);
    };
  }, []);

  // BFS filtered graph
  const filteredGraph = useMemo(() => {
    if (!graphData) return null;
    if (depthLimit !== null && currentNote) {
      return computeBfsSubgraph(graphData, currentNote.id, depthLimit);
    }
    return graphData;
  }, [graphData, depthLimit, currentNote?.id]);

  // Render / update D3 simulation
  useEffect(() => {
    if (!filteredGraph || !svgRef.current || !gRef.current) return;

    // Stop previous simulation
    simRef.current?.stop();

    const svgEl = svgRef.current;
    const width = svgEl.clientWidth || 800;
    const height = svgEl.clientHeight || 600;

    const g = d3.select(gRef.current);
    g.selectAll("*").remove();

    // Cap at MAX_NODES by taking highest-linkCount nodes
    const isCapped = filteredGraph.nodes.length > MAX_NODES;
    const nodesToShow = isCapped
      ? [...filteredGraph.nodes].sort((a, b) => b.linkCount - a.linkCount).slice(0, MAX_NODES)
      : filteredGraph.nodes;
    const nodeIds = new Set(nodesToShow.map((n) => n.id));
    const edgesToShow = filteredGraph.edges.filter((e) => {
      const s = typeof e.source === "string" ? e.source : (e.source as GraphNode).id;
      const t = typeof e.target === "string" ? e.target : (e.target as GraphNode).id;
      return nodeIds.has(s) && nodeIds.has(t);
    });

    // Deep-copy nodes so D3 mutation doesn't affect state
    const simNodes: GraphNode[] = nodesToShow.map((n) => ({ ...n }));
    const simEdges: GraphLink[] = edgesToShow.map((e) => ({
      source: typeof e.source === "string" ? e.source : (e.source as GraphNode).id,
      target: typeof e.target === "string" ? e.target : (e.target as GraphNode).id,
    }));

    // Folder → color
    const folders = [...new Set(simNodes.map((n) => n.folder))];
    const colorScale = d3.scaleOrdinal(folders, d3.schemeTableau10);

    // Draw edges
    const linkSel = g
      .append("g")
      .attr("class", "graph-links")
      .selectAll<SVGLineElement, GraphLink>("line")
      .data(simEdges)
      .join("line")
      .attr("class", "graph-link");

    // Draw nodes
    const nodeGroup = g.append("g").attr("class", "graph-nodes");
    const nodeSel = nodeGroup
      .selectAll<SVGGElement, GraphNode>("g.graph-node")
      .data(simNodes, (d) => d.id)
      .join((enter) => {
        const node = enter.append("g").attr("class", "graph-node");

        node.append("circle").attr("class", "graph-node-circle");

        // Native SVG tooltip
        node.append("title").text((d) => d.title);

        // Label — always use .text() never .html() for security
        node
          .append("text")
          .attr("class", "graph-node-label")
          .attr("text-anchor", "middle")
          .text((d) =>
            d.title.length > 22 ? d.title.slice(0, 21) + "…" : d.title
          );

        return node;
      });

    // Style circles
    nodeSel
      .select<SVGCircleElement>("circle.graph-node-circle")
      .attr("r", (d) => 5 + Math.sqrt(d.linkCount ?? 0) * 3)
      .attr("fill", (d) => colorScale(d.folder))
      .attr("stroke", "var(--graph-node-stroke, #fff)")
      .attr("stroke-width", 1.5);

    // Style labels
    nodeSel
      .select<SVGTextElement>("text.graph-node-label")
      .attr("dy", (d) => 10 + 5 + Math.sqrt(d.linkCount ?? 0) * 3)
      .attr("font-size", "11px")
      .attr("fill", "var(--color-text-muted, #888)");

    // Search highlight
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      nodeSel.attr("opacity", (d) =>
        d.title.toLowerCase().includes(q) ? 1 : 0.15
      );
    }

    // Click handler (uses ref to avoid stale closure)
    nodeSel.on("click", (_, d) => {
      selectNoteRef.current(d.id);
      onCloseRef.current();
    });

    // Drag
    const drag = d3
      .drag<SVGGElement, GraphNode>()
      .on("start", (e, d) => {
        if (!e.active) sim.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (e, d) => {
        d.fx = e.x;
        d.fy = e.y;
      })
      .on("end", (e, d) => {
        if (!e.active) sim.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });
    nodeSel.call(drag);

    // Force simulation
    const sim = d3
      .forceSimulation<GraphNode, GraphLink>(simNodes)
      .force(
        "link",
        d3
          .forceLink<GraphNode, GraphLink>(simEdges)
          .id((d) => d.id)
          .distance(80)
          .strength(0.3)
      )
      .force(
        "charge",
        d3
          .forceManyBody<GraphNode>()
          .strength(-200)
          .distanceMax(300)
          .theta(0.9)
      )
      .force(
        "center",
        d3.forceCenter<GraphNode>(width / 2, height / 2).strength(0.1)
      )
      .force(
        "collide",
        d3.forceCollide<GraphNode>((d) => 5 + Math.sqrt(d.linkCount ?? 0) * 3 + 5)
      )
      .alphaDecay(0.05)
      .velocityDecay(0.4);

    sim.on("tick", () => {
      linkSel
        .attr("x1", (d) => ((d.source as GraphNode).x ?? 0))
        .attr("y1", (d) => ((d.source as GraphNode).y ?? 0))
        .attr("x2", (d) => ((d.target as GraphNode).x ?? 0))
        .attr("y2", (d) => ((d.target as GraphNode).y ?? 0));
      nodeSel.attr(
        "transform",
        (d) => `translate(${d.x ?? 0},${d.y ?? 0})`
      );
    });

    simRef.current = sim;

    return () => {
      sim.stop();
    };
  }, [filteredGraph, searchQuery]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const isCapped = graphData && graphData.nodes.length > MAX_NODES;

  return (
    <div className="graph-view-overlay">
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

        <button className="graph-close-btn" onClick={onClose} title="Close graph (Esc)">
          ✕
        </button>
      </div>

      {isCapped && (
        <div className="graph-cap-banner">
          Showing top {MAX_NODES} most-linked notes (vault has {graphData!.nodes.length} notes)
        </div>
      )}

      <div className="graph-view-body">
        {loading && (
          <div className="graph-loading">Loading graph…</div>
        )}
        {error && !loading && (
          <div className="graph-error">
            Failed to load graph: {error}
          </div>
        )}
        {!loading && !error && (
          <svg ref={svgRef} className="graph-svg">
            <g ref={gRef} />
          </svg>
        )}
      </div>
    </div>
  );
}
