import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type RefObject,
} from "react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import type { AiDiffSession } from "../../../lib/diff";
import {
  createAiDiffBlockDecorationSet,
  createAiWordDiffDecorationSet,
} from "./decorations";
import {
  collectDeletionDividerLayouts,
  collectMarkerLayouts,
  computeIndicatorLeftPx,
} from "./layout";
import {
  aiDiffIndicatorPluginKey,
  aiDiffWordDiffPluginKey,
  dispatchDecorationSet,
} from "./extension";
import type { DeletionDividerLayout, MarkerLayout } from "./types";

interface UseDiffIndicatorStateParams {
  editor: TiptapEditor | null;
  aiDiffSession?: AiDiffSession | null;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
}

interface UseDiffIndicatorStateResult {
  markers: MarkerLayout[];
  deletionDividers: DeletionDividerLayout[];
  leftPx: number;
  overlayHeight: number;
  activeBlockId: string | null;
  activeMarker: MarkerLayout | null;
  toggleMarker: (blockId: string) => void;
  clearActiveBlock: () => void;
}

export function useDiffIndicatorState({
  editor,
  aiDiffSession,
  scrollContainerRef,
}: UseDiffIndicatorStateParams): UseDiffIndicatorStateResult {
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

  useEffect(() => {
    if (!activeBlockId) return;
    const activeMarkerStillVisible = markers.some(
      (marker) => marker.blockId === activeBlockId,
    );
    if (!activeMarkerStillVisible) {
      setActiveBlockId(null);
    }
  }, [activeBlockId, markers]);

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
    dispatchDecorationSet(editor, aiDiffIndicatorPluginKey, decorationSet);
    requestAnimationFrame(updateOverlay);
  }, [editor, aiDiffSession, updateOverlay]);

  useEffect(() => {
    if (!editor) return;

    const decorationSet = createAiWordDiffDecorationSet(
      editor.state.doc,
      aiDiffSession,
      activeBlockId,
    );
    dispatchDecorationSet(editor, aiDiffWordDiffPluginKey, decorationSet);
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

  const toggleMarker = useCallback((blockId: string) => {
    setActiveBlockId((current) => (current === blockId ? null : blockId));
  }, []);

  const clearActiveBlock = useCallback(() => {
    setActiveBlockId(null);
  }, []);

  return {
    markers,
    deletionDividers,
    leftPx,
    overlayHeight,
    activeBlockId,
    activeMarker,
    toggleMarker,
    clearActiveBlock,
  };
}
