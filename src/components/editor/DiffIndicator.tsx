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

type DiffIndicatorType = "add" | "modify";

type TypedBlockRange = BlockRange & {
  indicatorType: DiffIndicatorType;
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

function getChangeLengths(change: AiEditRawChange) {
  const insertedLength = Math.max(0, change.toB - change.fromB);
  const deletedLength = Math.max(0, change.toA - change.fromA);
  return { insertedLength, deletedLength };
}

function getMergedIndicatorType(
  existingType: DiffIndicatorType | undefined,
  nextType: DiffIndicatorType,
): DiffIndicatorType {
  if (!existingType) return nextType;
  if (existingType === "modify" || nextType === "modify") return "modify";
  return "add";
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

  const touchedBlocks = new Map<string, TypedBlockRange>();

  const markTouchedBlock = (
    range: BlockRange,
    indicatorType: DiffIndicatorType,
  ) => {
    const key = `${range.from}:${range.to}`;
    const existing = touchedBlocks.get(key);
    touchedBlocks.set(key, {
      ...range,
      indicatorType: getMergedIndicatorType(existing?.indicatorType, indicatorType),
    });
  };

  for (const change of changes) {
    const { insertedLength, deletedLength } = getChangeLengths(change);
    const changeFrom = Math.max(0, Math.min(change.fromB, doc.content.size));
    const changeTo = Math.max(0, Math.min(change.toB, doc.content.size));

    if (changeTo > changeFrom) {
      for (const range of findContainingRanges(
        topLevelRanges,
        changeFrom,
        changeTo,
      )) {
        // Treat pure insertions as add, even when they occur inside existing blocks.
        const indicatorType: DiffIndicatorType =
          insertedLength > 0 && deletedLength === 0 ? "add" : "modify";

        markTouchedBlock(range, indicatorType);
      }
      continue;
    }

    const nearestTopLevel = findNearestBlockForCollapsedPosition(
      topLevelRanges,
      changeFrom,
    );
    if (nearestTopLevel) {
      markTouchedBlock(nearestTopLevel, "modify");
    }
  }

  return Array.from(touchedBlocks.values()).map((range) =>
    Decoration.node(range.from, range.to, {
      class: `ai-diff-indicator-block ai-diff-indicator-block--${range.indicatorType}`,
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
  indicatorType: DiffIndicatorType;
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
  const markersByKey = new Map<string, MarkerLayout>();

  for (const target of targets) {
    const rect = target.getBoundingClientRect();
    if (rect.height <= 0) continue;

    const top = rect.top - scrollRect.top + scrollContainer.scrollTop + 2;
    const height = Math.max(10, rect.height - 4);
    const indicatorType: DiffIndicatorType = target.classList.contains(
      "ai-diff-indicator-block--add",
    )
      ? "add"
      : "modify";
    const dedupeKey = `${Math.round(top)}:${Math.round(height)}`;
    const existing = markersByKey.get(dedupeKey);

    if (!existing) {
      markersByKey.set(dedupeKey, { top, height, indicatorType });
      continue;
    }

    markersByKey.set(dedupeKey, {
      ...existing,
      indicatorType: getMergedIndicatorType(existing.indicatorType, indicatorType),
    });
  }

  const markers = Array.from(markersByKey.values());
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
          className={`ai-diff-indicator-marker ai-diff-indicator-marker--${marker.indicatorType}`}
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
