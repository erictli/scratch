import type { AiDiffIndicatorType } from "../../../lib/diff";
import type { DeletionDividerLayout, MarkerLayout } from "./types";

const MARKER_VERTICAL_PADDING = 2;
const MARKER_MIN_HEIGHT = 10;
const DELETION_DIVIDER_INSET = 25;
const DELETION_DIVIDER_MIN_WIDTH = 140;

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

function resolveIndicatorType(target: HTMLElement): AiDiffIndicatorType {
  return target.classList.contains("ai-diff-indicator-block--add")
    ? "add"
    : "modify";
}

function computeDeletionDividerFrame(
  editorDom: HTMLElement,
  scrollContainer: HTMLDivElement,
): { left: number; width: number } {
  const editorRect = editorDom.getBoundingClientRect();
  const scrollRect = scrollContainer.getBoundingClientRect();
  const width = Math.max(
    DELETION_DIVIDER_MIN_WIDTH,
    editorRect.width - DELETION_DIVIDER_INSET * 2,
  );
  const left = editorRect.left - scrollRect.left + DELETION_DIVIDER_INSET;

  return { left, width };
}

export function computeIndicatorLeftPx(
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

export function collectMarkerLayouts(
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
    const top = blockTop + MARKER_VERTICAL_PADDING;
    const height = Math.max(
      MARKER_MIN_HEIGHT,
      rect.height - MARKER_VERTICAL_PADDING * 2,
    );
    const blockLeft = rect.left - scrollRect.left;
    const blockWidth = rect.width;

    markersById.set(blockId, {
      blockId,
      top,
      height,
      indicatorType: resolveIndicatorType(target),
      blockTop,
      blockLeft,
      blockWidth,
    });
  }

  return Array.from(markersById.values()).sort((a, b) => a.top - b.top);
}

export function collectDeletionDividerLayouts(
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
