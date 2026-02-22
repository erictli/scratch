import { useCallback, useEffect, useState, type RefObject } from "react";
import { Extension } from "@tiptap/core";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { AiEditRawChange } from "../../lib/diff";

export const aiDiffIndicatorPluginKey = new PluginKey<DecorationSet>(
  "aiDiffIndicator",
);

type BlockRange = {
  from: number;
  to: number;
};

function getTopLevelBlockRanges(doc: ProseMirrorNode): BlockRange[] {
  const ranges: BlockRange[] = [];

  doc.forEach((node, offset) => {
    if (!node.isBlock) return;
    ranges.push({
      from: offset,
      to: offset + node.nodeSize,
    });
  });

  return ranges;
}

function dedupeRanges(ranges: BlockRange[]): BlockRange[] {
  const seen = new Set<string>();
  const deduped: BlockRange[] = [];

  for (const range of ranges) {
    const key = `${range.from}:${range.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(range);
  }

  return deduped;
}

function findContainingRanges(
  ranges: BlockRange[],
  from: number,
  to: number,
): BlockRange[] {
  return ranges.filter((range) => from < range.to && to > range.from);
}

function findNearestBlockForCollapsedPosition(
  ranges: BlockRange[],
  position: number,
): BlockRange | null {
  if (ranges.length === 0) return null;

  const containing = ranges.find((range) => {
    return position >= range.from && position < range.to;
  });
  if (containing) return containing;

  if (position >= ranges[ranges.length - 1].to) {
    return ranges[ranges.length - 1];
  }

  let nearest: BlockRange | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const range of ranges) {
    const distance =
      position < range.from
        ? range.from - position
        : position > range.to
          ? position - range.to
          : 0;

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = range;
    }
  }

  return nearest;
}

export function buildAiDiffBlockDecorations(
  doc: ProseMirrorNode,
  changes: AiEditRawChange[],
): Decoration[] {
  if (changes.length === 0) return [];

  const topLevelRanges = getTopLevelBlockRanges(doc);
  if (topLevelRanges.length === 0) return [];

  const touchedBlocks: BlockRange[] = [];

  for (const change of changes) {
    const changeFrom = Math.max(0, Math.min(change.fromB, doc.content.size));
    const changeTo = Math.max(0, Math.min(change.toB, doc.content.size));

    if (changeTo > changeFrom) {
      touchedBlocks.push(
        ...findContainingRanges(topLevelRanges, changeFrom, changeTo),
      );
      continue;
    }

    const nearestTopLevel = findNearestBlockForCollapsedPosition(
      topLevelRanges,
      changeFrom,
    );
    if (nearestTopLevel) {
      touchedBlocks.push(nearestTopLevel);
    }
  }

  return dedupeRanges(touchedBlocks).map((range) =>
    Decoration.node(range.from, range.to, {
      class: "ai-diff-indicator-block",
    }),
  );
}

export function createAiDiffDecorationSet(
  doc: ProseMirrorNode,
  changes: AiEditRawChange[],
): DecorationSet {
  return DecorationSet.create(doc, buildAiDiffBlockDecorations(doc, changes));
}

export const AiDiffIndicatorExtension = Extension.create({
  name: "aiDiffIndicator",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: aiDiffIndicatorPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, oldSet) => {
            const mapped = oldSet.map(tr.mapping, tr.doc);
            const meta = tr.getMeta(aiDiffIndicatorPluginKey);
            if (meta !== undefined) {
              return meta.decorationSet;
            }
            return mapped;
          },
        },
        props: {
          decorations: (state) => aiDiffIndicatorPluginKey.getState(state),
        },
      }),
    ];
  },
});

interface DiffIndicatorProps {
  editor: TiptapEditor | null;
  changes?: AiEditRawChange[];
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
}

type MarkerLayout = {
  top: number;
  height: number;
};

function parseCssLengthToPx(value: string, baseFontSizePx: number): number {
  const raw = value.trim();
  if (!raw) return 0;

  if (raw.endsWith("rem")) {
    return Number.parseFloat(raw) * baseFontSizePx;
  }
  if (raw.endsWith("px")) {
    return Number.parseFloat(raw);
  }

  const numeric = Number.parseFloat(raw);
  return Number.isFinite(numeric) ? numeric : 0;
}

function computeIndicatorLeftPx(
  editorDom: HTMLElement,
  scrollContainer: HTMLDivElement,
): number {
  const editorRect = editorDom.getBoundingClientRect();
  const scrollRect = scrollContainer.getBoundingClientRect();
  const editorFontSize =
    Number.parseFloat(getComputedStyle(editorDom).fontSize) || 16;
  const offsetPx = parseCssLengthToPx(
    getComputedStyle(editorDom).getPropertyValue("--ai-diff-indicator-left"),
    editorFontSize,
  );

  return editorRect.left - scrollRect.left + offsetPx;
}

function collectMarkerLayouts(
  editorDom: HTMLElement,
  scrollContainer: HTMLDivElement,
): MarkerLayout[] {
  const targets = Array.from(
    editorDom.querySelectorAll<HTMLElement>(".ai-diff-indicator-block"),
  );

  const scrollRect = scrollContainer.getBoundingClientRect();
  const seen = new Set<string>();
  const markers: MarkerLayout[] = [];

  for (const target of targets) {
    const rect = target.getBoundingClientRect();
    if (rect.height <= 0) continue;

    const top = rect.top - scrollRect.top + scrollContainer.scrollTop + 2;
    const height = Math.max(10, rect.height - 4);
    const dedupeKey = `${Math.round(top)}:${Math.round(height)}`;

    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    markers.push({ top, height });
  }

  markers.sort((a, b) => a.top - b.top);
  return markers;
}

export function DiffIndicator({
  editor,
  changes = [],
  scrollContainerRef,
}: DiffIndicatorProps) {
  const [markers, setMarkers] = useState<MarkerLayout[]>([]);
  const [leftPx, setLeftPx] = useState(0);
  const [overlayHeight, setOverlayHeight] = useState(0);

  const updateOverlay = useCallback(() => {
    if (!editor || !scrollContainerRef?.current) {
      setMarkers([]);
      setOverlayHeight(0);
      return;
    }

    const editorDom = editor.view.dom as HTMLElement;
    const scrollContainer = scrollContainerRef.current;
    const nextLeftPx = computeIndicatorLeftPx(editorDom, scrollContainer);
    const nextMarkers = collectMarkerLayouts(editorDom, scrollContainer);

    setLeftPx(nextLeftPx);
    setMarkers(nextMarkers);
    setOverlayHeight(scrollContainer.scrollHeight);
  }, [editor, scrollContainerRef]);

  useEffect(() => {
    if (!editor) return;

    const decorationSet = createAiDiffDecorationSet(editor.state.doc, changes);
    const tr = editor.state.tr.setMeta(aiDiffIndicatorPluginKey, {
      decorationSet,
    });
    editor.view.dispatch(tr);
    requestAnimationFrame(updateOverlay);
  }, [editor, changes, updateOverlay]);

  useEffect(() => {
    if (!editor || !scrollContainerRef?.current) return;

    const editorDom = editor.view.dom as HTMLElement;
    const scrollContainer = scrollContainerRef.current;
    const scheduleOverlayUpdate = () => {
      requestAnimationFrame(updateOverlay);
    };

    const resizeObserver = new ResizeObserver(scheduleOverlayUpdate);
    resizeObserver.observe(editorDom);
    resizeObserver.observe(scrollContainer);

    editor.on("transaction", scheduleOverlayUpdate);
    scrollContainer.addEventListener("scroll", scheduleOverlayUpdate, {
      passive: true,
    });
    window.addEventListener("resize", scheduleOverlayUpdate);
    scheduleOverlayUpdate();

    return () => {
      resizeObserver.disconnect();
      editor.off("transaction", scheduleOverlayUpdate);
      scrollContainer.removeEventListener("scroll", scheduleOverlayUpdate);
      window.removeEventListener("resize", scheduleOverlayUpdate);
    };
  }, [editor, scrollContainerRef, updateOverlay]);

  if (markers.length === 0) return null;

  return (
    <div
      className="ai-diff-indicator-overlay"
      aria-hidden="true"
      style={{ height: overlayHeight }}
    >
      {markers.map((marker, index) => (
        <div
          key={`${marker.top}:${marker.height}:${index}`}
          className="ai-diff-indicator-marker"
          style={{
            top: marker.top,
            height: marker.height,
            left: leftPx,
          }}
        />
      ))}
    </div>
  );
}
