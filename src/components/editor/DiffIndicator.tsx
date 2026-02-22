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
  indicatorType?: DiffIndicatorType;
  hasDeletionAnchor?: boolean;
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

  const upsertTouchedBlock = (range: BlockRange): TypedBlockRange => {
    const key = `${range.from}:${range.to}`;
    const existing = touchedBlocks.get(key);
    if (existing) return existing;

    const next: TypedBlockRange = { ...range };
    touchedBlocks.set(key, next);
    return next;
  };

  const markTouchedBlock = (
    range: BlockRange,
    indicatorType: DiffIndicatorType,
  ) => {
    const block = upsertTouchedBlock(range);
    block.indicatorType = getMergedIndicatorType(
      block.indicatorType,
      indicatorType,
    );
  };

  const markDeletionAnchor = (range: BlockRange) => {
    const block = upsertTouchedBlock(range);
    block.hasDeletionAnchor = true;
  };

  for (const change of changes) {
    const changeFrom = Math.max(0, Math.min(change.fromB, doc.content.size));
    const changeTo = Math.max(0, Math.min(change.toB, doc.content.size));

    if (change.kind === "delete-block" && changeTo === changeFrom) {
      const nearestTopLevel = findNearestBlockForCollapsedPosition(
        topLevelRanges,
        changeFrom,
      );
      if (nearestTopLevel) {
        markDeletionAnchor(nearestTopLevel);
        continue;
      }
    }

    if (changeTo > changeFrom) {
      for (const range of findContainingRanges(
        topLevelRanges,
        changeFrom,
        changeTo,
      )) {
        const indicatorType: DiffIndicatorType =
          change.kind === "add" ? "add" : "modify";

        markTouchedBlock(range, indicatorType);
      }
      continue;
    }

    if (change.kind === "delete-block") continue;

    const nearestTopLevel = findNearestBlockForCollapsedPosition(
      topLevelRanges,
      changeFrom,
    );
    if (nearestTopLevel) {
      markTouchedBlock(nearestTopLevel, "modify");
    }
  }

  return Array.from(touchedBlocks.values())
    .map((range) => {
      const classes: string[] = [];
      if (range.indicatorType) {
        classes.push(
          "ai-diff-indicator-block",
          `ai-diff-indicator-block--${range.indicatorType}`,
        );
      }
      if (range.hasDeletionAnchor) {
        classes.push("ai-diff-deletion-anchor-block");
      }

      if (classes.length === 0) return null;

      return Decoration.node(range.from, range.to, {
        class: classes.join(" "),
      });
    })
    .filter((decoration): decoration is Decoration => decoration !== null);
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

type DeletionDividerLayout = {
  top: number;
  left: number;
  width: number;
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
      indicatorType: getMergedIndicatorType(
        existing.indicatorType,
        indicatorType,
      ),
    });
  }

  const markers = Array.from(markersByKey.values());
  markers.sort((a, b) => a.top - b.top);
  return markers;
}

function computeDeletionDividerFrame(
  editorDom: HTMLElement,
  scrollContainer: HTMLDivElement,
): { left: number; width: number } {
  const editorRect = editorDom.getBoundingClientRect();
  const scrollRect = scrollContainer.getBoundingClientRect();
  const horizontalInset = 25;
  const width = Math.max(140, editorRect.width - horizontalInset * 2);
  const left = editorRect.left - scrollRect.left + horizontalInset;

  return { left, width };
}

function collectDeletionDividerLayouts(
  editorDom: HTMLElement,
  scrollContainer: HTMLDivElement,
): DeletionDividerLayout[] {
  const targets = Array.from(
    editorDom.querySelectorAll<HTMLElement>(".ai-diff-deletion-anchor-block"),
  );
  if (targets.length === 0) return [];

  const scrollRect = scrollContainer.getBoundingClientRect();
  const { left, width } = computeDeletionDividerFrame(
    editorDom,
    scrollContainer,
  );
  const markerTopsByKey = new Map<string, number>();

  for (const target of targets) {
    const rect = target.getBoundingClientRect();
    if (rect.height <= 0) continue;
    const marginTop =
      Number.parseFloat(getComputedStyle(target).marginTop) || 0;
    const top =
      rect.top - scrollRect.top + scrollContainer.scrollTop - marginTop / 2;
    const key = `${Math.round(top)}`;
    if (!markerTopsByKey.has(key)) {
      markerTopsByKey.set(key, top);
    }
  }

  return Array.from(markerTopsByKey.values())
    .sort((a, b) => a - b)
    .map((top) => ({ top, left, width }));
}

export function DiffIndicator({
  editor,
  changes = [],
  scrollContainerRef,
}: DiffIndicatorProps) {
  const [markers, setMarkers] = useState<MarkerLayout[]>([]);
  const [deletionDividers, setDeletionDividers] = useState<
    DeletionDividerLayout[]
  >([]);
  const [leftPx, setLeftPx] = useState(0);
  const [overlayHeight, setOverlayHeight] = useState(0);

  const updateOverlay = useCallback(() => {
    if (!editor || !scrollContainerRef?.current) {
      setMarkers([]);
      setDeletionDividers([]);
      setOverlayHeight(0);
      return;
    }

    const editorDom = editor.view.dom as HTMLElement;
    const scrollContainer = scrollContainerRef.current;
    const nextLeftPx = computeIndicatorLeftPx(editorDom, scrollContainer);
    const nextMarkers = collectMarkerLayouts(editorDom, scrollContainer);
    const nextDeletionDividers = collectDeletionDividerLayouts(
      editorDom,
      scrollContainer,
    );

    setLeftPx(nextLeftPx);
    setMarkers(nextMarkers);
    setDeletionDividers(nextDeletionDividers);
    setOverlayHeight(scrollContainer.scrollHeight);
  }, [changes, editor, scrollContainerRef]);

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

  if (markers.length === 0 && deletionDividers.length === 0) return null;

  return (
    <div
      className="ai-diff-indicator-overlay"
      aria-hidden="true"
      style={{ height: overlayHeight }}
    >
      {deletionDividers.map((divider, index) => (
        <div
          key={`${divider.top}:${index}`}
          className="ai-diff-deletion-divider"
          style={{
            top: divider.top,
            left: divider.left,
            width: divider.width,
          }}
        >
          <span className="ai-diff-deletion-divider__label">Deleted</span>
        </div>
      ))}
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
