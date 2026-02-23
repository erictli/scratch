import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type RefObject,
} from "react";
import { Extension } from "@tiptap/core";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type {
  AiDiffIndicatorType,
  AiDiffSession,
} from "../../lib/diff";
import { DiffMenu } from "./DiffMenu";

export const aiDiffIndicatorPluginKey = new PluginKey<DecorationSet>(
  "aiDiffIndicator",
);

const aiDiffWordDiffPluginKey = new PluginKey<DecorationSet>("aiDiffWordDiff");

type DeletionDividerLayout = {
  top: number;
  left: number;
  width: number;
};

type MarkerLayout = {
  blockId: string;
  top: number;
  height: number;
  indicatorType: AiDiffIndicatorType;
  blockTop: number;
  blockLeft: number;
  blockWidth: number;
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

function clampPosition(value: number, size: number): number {
  return Math.max(0, Math.min(value, size));
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

function buildAiDiffBlockDecorations(
  doc: ProseMirrorNode,
  aiDiffSession: AiDiffSession | null | undefined,
): Decoration[] {
  if (!aiDiffSession || aiDiffSession.blocks.length === 0) return [];

  const docSize = doc.content.size;

  return aiDiffSession.blocks
    .map((block) => {
      const from = clampPosition(block.from, docSize);
      const to = clampPosition(block.to, docSize);
      if (to <= from) return null;

      const classes: string[] = [];
      if (block.indicatorType) {
        classes.push(
          "ai-diff-indicator-block",
          `ai-diff-indicator-block--${block.indicatorType}`,
        );
      }
      if (block.hasDeletionAnchor) {
        classes.push("ai-diff-deletion-anchor-block");
      }

      if (classes.length === 0) return null;

      return Decoration.node(from, to, {
        class: classes.join(" "),
        "data-ai-diff-block-id": block.id,
      });
    })
    .filter((decoration): decoration is Decoration => decoration !== null);
}

function createAiDiffBlockDecorationSet(
  doc: ProseMirrorNode,
  aiDiffSession: AiDiffSession | null | undefined,
): DecorationSet {
  return DecorationSet.create(doc, buildAiDiffBlockDecorations(doc, aiDiffSession));
}

function buildDeletedWidget(text: string, isCodeLikeBlock: boolean): HTMLElement {
  const span = document.createElement("span");
  span.className = isCodeLikeBlock
    ? "ai-diff-word-delete ai-diff-word-delete--code"
    : "ai-diff-word-delete";
  span.textContent = text;
  return span;
}

function buildAiWordDiffDecorations(
  doc: ProseMirrorNode,
  aiDiffSession: AiDiffSession | null | undefined,
  activeBlockId: string | null,
): Decoration[] {
  if (!aiDiffSession || !activeBlockId) return [];

  const activeBlock = aiDiffSession.blocks.find(
    (block) => block.id === activeBlockId && !!block.indicatorType,
  );
  if (!activeBlock) return [];
  const isCodeLikeBlock =
    activeBlock.blockType === "codeBlock" ||
    activeBlock.blockType === "frontmatter";

  const docSize = doc.content.size;
  const blockFrom = clampPosition(activeBlock.from, docSize);
  const blockTo = clampPosition(activeBlock.to, docSize);
  if (blockTo <= blockFrom) return [];
  const blockContentFrom = Math.min(blockTo, blockFrom + 1);
  const blockContentTo = Math.max(blockContentFrom, blockTo - 1);

  const decorations: Decoration[] = [];

  for (const changeIndex of activeBlock.relatedChangeIndexes) {
    const change = aiDiffSession.changes[changeIndex];
    if (!change) continue;

    const insertedFrom = clampPosition(change.fromB, docSize);
    const insertedTo = clampPosition(change.toB, docSize);
    const from = Math.max(insertedFrom, blockContentFrom);
    const to = Math.min(insertedTo, blockContentTo);

    if (to > from) {
      decorations.push(
        Decoration.inline(from, to, {
          class: "ai-diff-word-add",
        }),
      );
    }

    const shouldRenderDeletedWidget =
      change.deletedText.length > 0 &&
      change.deletedText.length <= (isCodeLikeBlock ? 240 : 80) &&
      (isCodeLikeBlock || !change.deletedText.includes("\n"));

    if (shouldRenderDeletedWidget) {
      const anchor = Math.max(
        blockContentFrom,
        Math.min(clampPosition(change.fromB, docSize), blockContentTo),
      );
      decorations.push(
        Decoration.widget(
          anchor,
          () => buildDeletedWidget(change.deletedText, isCodeLikeBlock),
          {
            side: -1,
            ignoreSelection: true,
          },
        ),
      );
    }
  }

  return decorations;
}

function createAiWordDiffDecorationSet(
  doc: ProseMirrorNode,
  aiDiffSession: AiDiffSession | null | undefined,
  activeBlockId: string | null,
): DecorationSet {
  return DecorationSet.create(
    doc,
    buildAiWordDiffDecorations(doc, aiDiffSession, activeBlockId),
  );
}

function collectMarkerLayouts(
  editorDom: HTMLElement,
  scrollContainer: HTMLDivElement,
): MarkerLayout[] {
  const targets = Array.from(
    editorDom.querySelectorAll<HTMLElement>(".ai-diff-indicator-block"),
  );
  const scrollRect = scrollContainer.getBoundingClientRect();
  const markersById = new Map<string, MarkerLayout>();

  for (const target of targets) {
    const blockId = target.dataset.aiDiffBlockId;
    if (!blockId) continue;

    const rect = target.getBoundingClientRect();
    if (rect.height <= 0) continue;

    const blockTop = rect.top - scrollRect.top + scrollContainer.scrollTop;
    const top = blockTop + 2;
    const height = Math.max(10, rect.height - 4);
    const blockLeft = rect.left - scrollRect.left;
    const blockWidth = rect.width;
    const indicatorType: AiDiffIndicatorType = target.classList.contains(
      "ai-diff-indicator-block--add",
    )
      ? "add"
      : "modify";

    markersById.set(blockId, {
      blockId,
      top,
      height,
      indicatorType,
      blockTop,
      blockLeft,
      blockWidth,
    });
  }

  return Array.from(markersById.values()).sort((a, b) => a.top - b.top);
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
      new Plugin({
        key: aiDiffWordDiffPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, oldSet) => {
            const mapped = oldSet.map(tr.mapping, tr.doc);
            const meta = tr.getMeta(aiDiffWordDiffPluginKey);
            if (meta !== undefined) {
              return meta.decorationSet;
            }
            return mapped;
          },
        },
        props: {
          decorations: (state) => aiDiffWordDiffPluginKey.getState(state),
        },
      }),
    ];
  },
});

interface DiffIndicatorProps {
  editor: TiptapEditor | null;
  aiDiffSession?: AiDiffSession | null;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
  onRejectBlock?: (blockId: string) => void;
}

export function DiffIndicator({
  editor,
  aiDiffSession,
  scrollContainerRef,
  onRejectBlock,
}: DiffIndicatorProps) {
  const [markers, setMarkers] = useState<MarkerLayout[]>([]);
  const [deletionDividers, setDeletionDividers] = useState<
    DeletionDividerLayout[]
  >([]);
  const [leftPx, setLeftPx] = useState(0);
  const [overlayHeight, setOverlayHeight] = useState(0);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);

  useEffect(() => {
    if (!aiDiffSession || aiDiffSession.blocks.length === 0) {
      setActiveBlockId(null);
      return;
    }

    if (!activeBlockId) return;
    const activeStillExists = aiDiffSession.blocks.some(
      (block) => block.id === activeBlockId && !!block.indicatorType,
    );
    if (!activeStillExists) {
      setActiveBlockId(null);
    }
  }, [aiDiffSession, activeBlockId]);

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
  }, [editor, scrollContainerRef]);

  useEffect(() => {
    if (!editor) return;

    const decorationSet = createAiDiffBlockDecorationSet(
      editor.state.doc,
      aiDiffSession,
    );
    const tr = editor.state.tr.setMeta(aiDiffIndicatorPluginKey, {
      decorationSet,
    });
    editor.view.dispatch(tr);
    requestAnimationFrame(updateOverlay);
  }, [editor, aiDiffSession, updateOverlay]);

  useEffect(() => {
    if (!editor) return;

    const wordDecorationSet = createAiWordDiffDecorationSet(
      editor.state.doc,
      aiDiffSession,
      activeBlockId,
    );
    const tr = editor.state.tr.setMeta(aiDiffWordDiffPluginKey, {
      decorationSet: wordDecorationSet,
    });
    editor.view.dispatch(tr);
    requestAnimationFrame(updateOverlay);
  }, [editor, aiDiffSession, activeBlockId, updateOverlay]);

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

  const activeMarker = useMemo(() => {
    if (!activeBlockId) return null;
    return markers.find((marker) => marker.blockId === activeBlockId) ?? null;
  }, [activeBlockId, markers]);

  const handleMarkerClick = useCallback((blockId: string) => {
    setActiveBlockId((current) => (current === blockId ? null : blockId));
  }, []);

  if (markers.length === 0 && deletionDividers.length === 0) return null;

  return (
    <div className="ai-diff-indicator-overlay" style={{ height: overlayHeight }}>
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
      {markers.map((marker) => (
        <button
          key={marker.blockId}
          type="button"
          className={`ai-diff-indicator-marker ai-diff-indicator-marker--${marker.indicatorType}${activeBlockId === marker.blockId ? " ai-diff-indicator-marker--active" : ""}`}
          style={{
            top: marker.top,
            height: marker.height,
            left: leftPx,
          }}
          onClick={() => handleMarkerClick(marker.blockId)}
          aria-label={
            marker.indicatorType === "add"
              ? "Show added content diff"
              : "Show modified content diff"
          }
          aria-pressed={activeBlockId === marker.blockId}
          title={
            marker.indicatorType === "add"
              ? "Show block additions"
              : "Show block word diff"
          }
        />
      ))}
      {activeMarker && onRejectBlock && (
        <DiffMenu
          top={Math.max(0, activeMarker.blockTop + 4)}
          left={Math.max(
            0,
            activeMarker.blockLeft + activeMarker.blockWidth - 28,
          )}
          onReject={() => {
            onRejectBlock(activeMarker.blockId);
            setActiveBlockId(null);
          }}
        />
      )}
    </div>
  );
}
