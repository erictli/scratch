import type { RefObject } from "react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import type { AiDiffIndicatorType, AiDiffSession } from "../../lib/diff";
import { DiffMenu } from "./DiffMenu";
import { useDiffIndicatorState } from "./diff-indicator/useDiffIndicatorState";

export {
  AiDiffIndicatorExtension,
  aiDiffIndicatorPluginKey,
} from "./diff-indicator/extension";

interface DiffIndicatorProps {
  editor: TiptapEditor | null;
  aiDiffSession?: AiDiffSession | null;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
  onRejectBlock?: (blockId: string) => void;
}

function getMarkerClassName(
  indicatorType: AiDiffIndicatorType,
  isActive: boolean,
): string {
  const activeClass = isActive ? " ai-diff-indicator-marker--active" : "";
  return `ai-diff-indicator-marker ai-diff-indicator-marker--${indicatorType}${activeClass}`;
}

function getMarkerAriaLabel(indicatorType: AiDiffIndicatorType): string {
  return indicatorType === "add"
    ? "Show added content diff"
    : "Show modified content diff";
}

function getMarkerTitle(indicatorType: AiDiffIndicatorType): string {
  return indicatorType === "add"
    ? "Show block additions"
    : "Show block word diff";
}

export function DiffIndicator({
  editor,
  aiDiffSession,
  scrollContainerRef,
  onRejectBlock,
}: DiffIndicatorProps) {
  const {
    markers,
    deletionDividers,
    leftPx,
    overlayHeight,
    activeBlockId,
    activeMarker,
    toggleMarker,
    clearActiveBlock,
  } = useDiffIndicatorState({
    editor,
    aiDiffSession,
    scrollContainerRef,
  });

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
      {markers.map((marker) => {
        const isActive = activeBlockId === marker.blockId;
        return (
          <button
            key={marker.blockId}
            type="button"
            className={getMarkerClassName(marker.indicatorType, isActive)}
            style={{
              top: marker.top,
              height: marker.height,
              left: leftPx,
            }}
            onClick={() => toggleMarker(marker.blockId)}
            aria-label={getMarkerAriaLabel(marker.indicatorType)}
            aria-pressed={isActive}
            title={getMarkerTitle(marker.indicatorType)}
          />
        );
      })}
      {activeMarker && onRejectBlock && (
        <DiffMenu
          top={Math.max(0, activeMarker.blockTop + 4)}
          left={Math.max(
            0,
            activeMarker.blockLeft + activeMarker.blockWidth - 28,
          )}
          onReject={() => {
            onRejectBlock(activeMarker.blockId);
            clearActiveBlock();
          }}
        />
      )}
    </div>
  );
}
