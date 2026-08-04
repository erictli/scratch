import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { updateWindowSession } from "../services/windowSession";
import {
  createWindowSessionPatchWriter,
  type RestoredWindowSession,
  type WindowSessionPatch,
  type WindowSessionPatchWriter,
} from "./windowSession";

interface UseWindowSessionPersistenceOptions {
  notesFolder: string | null;
  selectedNoteId: string | null;
  sidebarVisible: boolean;
  setSidebarVisible: Dispatch<SetStateAction<boolean>>;
  focusMode: boolean;
  setFocusMode: Dispatch<SetStateAction<boolean>>;
  restoredSession: RestoredWindowSession;
  isRestored: boolean;
}

interface PersistedUiState {
  selectedNoteId: string | null;
  sidebarVisible: boolean;
  focusMode: boolean;
}

export function useWindowSessionPersistence({
  notesFolder,
  selectedNoteId,
  sidebarVisible,
  setSidebarVisible,
  focusMode,
  setFocusMode,
  restoredSession,
  isRestored,
}: UseWindowSessionPersistenceOptions): () => Promise<void> {
  const geometryCaptureRef = useRef<() => Promise<void>>(async () => undefined);
  const writerRef = useRef<WindowSessionPatchWriter | null>(null);
  if (!writerRef.current) {
    writerRef.current = createWindowSessionPatchWriter(updateWindowSession, {
      onError: (error) => {
        console.warn("Window session update failed", error);
      },
    });
  }
  const writer = writerRef.current;
  const lastPersistedRef = useRef<PersistedUiState | null>(null);
  const skipHydrationPersistenceRef = useRef(false);
  const [hydrationVersion, setHydrationVersion] = useState(0);

  useEffect(() => {
    if (!isRestored) return;

    skipHydrationPersistenceRef.current = true;
    lastPersistedRef.current = {
      selectedNoteId: restoredSession.selectedNoteId,
      sidebarVisible: restoredSession.sidebarVisible,
      focusMode: restoredSession.focusMode,
    };
    setSidebarVisible(restoredSession.sidebarVisible);
    setFocusMode(restoredSession.focusMode);
    setHydrationVersion((version) => version + 1);
  }, [isRestored, restoredSession, setFocusMode, setSidebarVisible]);

  useEffect(() => {
    if (!isRestored || !notesFolder) return;
    if (skipHydrationPersistenceRef.current) {
      skipHydrationPersistenceRef.current = false;
      return;
    }

    const current = { selectedNoteId, sidebarVisible, focusMode };
    const previous = lastPersistedRef.current;
    const patch: WindowSessionPatch = {};
    if (!previous || previous.selectedNoteId !== current.selectedNoteId) {
      patch.selectedNoteId = current.selectedNoteId;
    }
    if (!previous || previous.sidebarVisible !== current.sidebarVisible) {
      patch.sidebarVisible = current.sidebarVisible;
    }
    if (!previous || previous.focusMode !== current.focusMode) {
      patch.focusMode = current.focusMode;
    }

    lastPersistedRef.current = current;
    if (Object.keys(patch).length > 0) writer.queue(patch);
  }, [
    focusMode,
    hydrationVersion,
    isRestored,
    notesFolder,
    selectedNoteId,
    sidebarVisible,
    writer,
  ]);

  useEffect(() => {
    if (!isRestored || !notesFolder) return;

    let disposed = false;
    let geometryTimer: ReturnType<typeof setTimeout> | null = null;
    let removeMovedListener: (() => void) | undefined;
    let removeResizedListener: (() => void) | undefined;
    const appWindow = getCurrentWindow();

    const captureGeometry = async () => {
      const [position, size] = await Promise.all([
        appWindow.outerPosition(),
        appWindow.outerSize(),
      ]);
      if (disposed) return;
      writer.queue({
        geometry: {
          x: position.x,
          y: position.y,
          width: size.width,
          height: size.height,
        },
      });
    };
    geometryCaptureRef.current = captureGeometry;

    const scheduleGeometryCapture = () => {
      if (geometryTimer !== null) clearTimeout(geometryTimer);
      geometryTimer = setTimeout(() => {
        geometryTimer = null;
        void captureGeometry().catch((error) => {
          console.warn("Window geometry capture failed", error);
        });
      }, 150);
    };

    void appWindow
      .onMoved(scheduleGeometryCapture)
      .then((removeListener) => {
        if (disposed) removeListener();
        else removeMovedListener = removeListener;
      })
      .catch((error) => {
        console.warn("Window move listener failed", error);
      });
    void appWindow
      .onResized(scheduleGeometryCapture)
      .then((removeListener) => {
        if (disposed) removeListener();
        else removeResizedListener = removeListener;
      })
      .catch((error) => {
        console.warn("Window resize listener failed", error);
      });

    return () => {
      disposed = true;
      if (geometryTimer !== null) clearTimeout(geometryTimer);
      removeMovedListener?.();
      removeResizedListener?.();
      if (geometryCaptureRef.current === captureGeometry) {
        geometryCaptureRef.current = async () => undefined;
      }
    };
  }, [isRestored, notesFolder, writer]);

  useEffect(() => {
    return () => {
      void writer
        .flush()
        .catch((error) => {
          console.warn("Final window session update failed", error);
        });
    };
  }, [writer]);

  return useCallback(async () => {
    try {
      await geometryCaptureRef.current();
    } catch {
      // Best-effort geometry capture; flush pending patches regardless.
    }
    await writer.flush();
  }, [writer]);
}
