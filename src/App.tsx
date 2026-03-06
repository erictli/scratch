import { useState, useEffect, useCallback, useMemo, useRef, useReducer } from "react";
import { toast } from "sonner";
import {
  NotesProvider,
  useNotesData,
  useNotesActions,
} from "./context/NotesContext";
import { ThemeProvider, useTheme } from "./context/ThemeContext";
import { GitProvider } from "./context/GitContext";
import { TooltipProvider, Toaster } from "./components/ui";
import { Sidebar } from "./components/layout/Sidebar";
import { Editor } from "./components/editor/Editor";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { FolderPicker } from "./components/layout/FolderPicker";
import { CommandPalette } from "./components/command-palette/CommandPalette";
import { SettingsPage } from "./components/settings";
import {
  SpinnerIcon,
  ClaudeIcon,
  CodexIcon,
  OllamaIcon,
} from "./components/icons";
import { AiEditModal } from "./components/ai/AiEditModal";
import { AiResponseToast } from "./components/ai/AiResponseToast";
import { PreviewApp } from "./components/preview/PreviewApp";
import {
  check as checkForUpdate,
  type Update,
} from "@tauri-apps/plugin-updater";
import { getCurrentWindow } from "@tauri-apps/api/window";
import * as aiService from "./services/ai";
import type { AiProvider } from "./services/ai";
import { getDisplayItems } from "./lib/noteSelectors";

// Detect preview mode from URL search params
function getWindowMode(): {
  isPreview: boolean;
  previewFile: string | null;
  initialVaultPath: string | null;
} {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode");
  const file = params.get("file");
  const vault = params.get("vault");
  return {
    isPreview: mode === "preview" && !!file,
    previewFile: file,
    initialVaultPath: vault ? decodeURIComponent(vault) : null,
  };
}

type ViewState = "notes" | "settings";

interface AppUiState {
  paletteOpen: boolean;
  view: ViewState;
  sidebarVisible: boolean;
  aiModalOpen: boolean;
  aiEditing: boolean;
  focusMode: boolean;
  aiProvider: AiProvider;
  openSidebarSearchSignal: number;
  toggleSourceModeSignal: number;
  focusNoteListSignal: number;
  toggleAllFoldersSignal: number;
}

type AppUiAction =
  | { type: "TOGGLE_SIDEBAR" }
  | { type: "TOGGLE_SETTINGS" }
  | { type: "CLOSE_SETTINGS" }
  | { type: "OPEN_PALETTE" }
  | { type: "CLOSE_PALETTE" }
  | { type: "OPEN_AI_MODAL"; provider: AiProvider }
  | { type: "CLOSE_AI_MODAL" }
  | { type: "BACK_TO_PALETTE" }
  | { type: "START_AI_EDIT" }
  | { type: "FINISH_AI_EDIT" }
  | { type: "TOGGLE_FOCUS_MODE"; canEnter: boolean }
  | { type: "REQUEST_OPEN_SIDEBAR_SEARCH" }
  | { type: "REQUEST_TOGGLE_SOURCE_MODE" }
  | { type: "REQUEST_FOCUS_NOTE_LIST" }
  | { type: "REQUEST_TOGGLE_ALL_FOLDERS" };

const initialAppUiState: AppUiState = {
  paletteOpen: false,
  view: "notes",
  sidebarVisible: true,
  aiModalOpen: false,
  aiEditing: false,
  focusMode: false,
  aiProvider: "claude",
  openSidebarSearchSignal: 0,
  toggleSourceModeSignal: 0,
  focusNoteListSignal: 0,
  toggleAllFoldersSignal: 0,
};

function appUiReducer(state: AppUiState, action: AppUiAction): AppUiState {
  switch (action.type) {
    case "TOGGLE_SIDEBAR":
      return { ...state, sidebarVisible: !state.sidebarVisible };
    case "TOGGLE_SETTINGS":
      return {
        ...state,
        view: state.view === "settings" ? "notes" : "settings",
      };
    case "CLOSE_SETTINGS":
      return { ...state, view: "notes" };
    case "OPEN_PALETTE":
      return { ...state, paletteOpen: true };
    case "CLOSE_PALETTE":
      return { ...state, paletteOpen: false };
    case "OPEN_AI_MODAL":
      return { ...state, aiProvider: action.provider, aiModalOpen: true };
    case "CLOSE_AI_MODAL":
      return { ...state, aiModalOpen: false };
    case "BACK_TO_PALETTE":
      return { ...state, aiModalOpen: false, paletteOpen: true };
    case "START_AI_EDIT":
      return { ...state, aiEditing: true };
    case "FINISH_AI_EDIT":
      return { ...state, aiEditing: false };
    case "TOGGLE_FOCUS_MODE":
      if (!state.focusMode && !action.canEnter) return state;
      if (state.focusMode) {
        return { ...state, focusMode: false, sidebarVisible: true };
      }
      return { ...state, focusMode: true };
    case "REQUEST_OPEN_SIDEBAR_SEARCH":
      return {
        ...state,
        sidebarVisible: true,
        openSidebarSearchSignal: state.openSidebarSearchSignal + 1,
      };
    case "REQUEST_TOGGLE_SOURCE_MODE":
      return {
        ...state,
        toggleSourceModeSignal: state.toggleSourceModeSignal + 1,
      };
    case "REQUEST_FOCUS_NOTE_LIST":
      return { ...state, focusNoteListSignal: state.focusNoteListSignal + 1 };
    case "REQUEST_TOGGLE_ALL_FOLDERS":
      return {
        ...state,
        toggleAllFoldersSignal: state.toggleAllFoldersSignal + 1,
      };
    default:
      return state;
  }
}

function AppContent() {
  const {
    notesFolder,
    isLoading,
    notes,
    selectedNoteId,
    searchQuery,
    searchResults,
    currentNote,
  } = useNotesData();
  const { createNote, selectNote, reloadCurrentNote } = useNotesActions();
  const { interfaceZoom, setInterfaceZoom } = useTheme();
  const interfaceZoomRef = useRef(interfaceZoom);
  interfaceZoomRef.current = interfaceZoom;
  const [ui, dispatchUi] = useReducer(appUiReducer, initialAppUiState);
  const editorRef = useRef<TiptapEditor | null>(null);

  const toggleSidebar = useCallback(() => {
    dispatchUi({ type: "TOGGLE_SIDEBAR" });
  }, []);

  const toggleFocusMode = useCallback(() => {
    dispatchUi({ type: "TOGGLE_FOCUS_MODE", canEnter: Boolean(selectedNoteId) });
  }, [selectedNoteId]);

  const toggleSettings = useCallback(() => {
    dispatchUi({ type: "TOGGLE_SETTINGS" });
  }, []);

  const closeSettings = useCallback(() => {
    dispatchUi({ type: "CLOSE_SETTINGS" });
  }, []);

  // Go back to command palette from AI modal
  const handleBackToPalette = useCallback(() => {
    dispatchUi({ type: "BACK_TO_PALETTE" });
  }, []);

  // AI Edit handler
  const handleAiEdit = useCallback(
    async (prompt: string, ollamaModel?: string) => {
      if (!currentNote) {
        toast.error("No note selected");
        return;
      }

      dispatchUi({ type: "START_AI_EDIT" });

      try {
        let result: aiService.AiExecutionResult;
        if (ui.aiProvider === "codex") {
          result = await aiService.executeCodexEdit(currentNote.path, prompt);
        } else if (ui.aiProvider === "ollama") {
          result = await aiService.executeOllamaEdit(
            currentNote.path,
            prompt,
            ollamaModel || "qwen3:8b",
          );
        } else {
          result = await aiService.executeClaudeEdit(currentNote.path, prompt);
        }

        // Reload the current note from disk
        await reloadCurrentNote();

        // Show results
        if (result.success) {
          // Close modal after success
          dispatchUi({ type: "CLOSE_AI_MODAL" });

          // Show success toast with provider response
          toast(<AiResponseToast output={result.output} provider={ui.aiProvider} />, {
            duration: Infinity,
            closeButton: true,
            className: "!min-w-[450px] !max-w-[600px]",
          });
        } else {
          toast.error(
            <div className="space-y-1">
              <div className="font-medium">AI Edit Failed</div>
              <div className="text-xs">{result.error || "Unknown error"}</div>
            </div>,
            { duration: Infinity, closeButton: true },
          );
        }
      } catch (error) {
        console.error("[AI] Error:", error);
        toast.error(
          `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      } finally {
        dispatchUi({ type: "FINISH_AI_EDIT" });
      }
    },
    [currentNote, reloadCurrentNote, ui.aiProvider],
  );

  const displayItems = useMemo(
    () => getDisplayItems(notes, searchQuery, searchResults),
    [notes, searchQuery, searchResults],
  );

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInEditor = target.closest(".ProseMirror");
      const isInInput =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA";

      // Cmd+, - Toggle settings (always works, even in settings)
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        toggleSettings();
        return;
      }

      // Cmd+= or Cmd++ - Zoom in (works everywhere, including settings)
      if ((e.metaKey || e.ctrlKey) && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        setInterfaceZoom((prev) => prev + 0.05);
        const newZoom = Math.round(Math.min(interfaceZoomRef.current + 0.05, 1.5) * 20) / 20;
        toast(`Zoom ${Math.round(newZoom * 100)}%`, { id: "zoom", duration: 1500 });
        return;
      }

      // Cmd+- - Zoom out (works everywhere, including settings)
      if ((e.metaKey || e.ctrlKey) && (e.key === "-" || e.key === "_")) {
        e.preventDefault();
        setInterfaceZoom((prev) => prev - 0.05);
        const newZoom = Math.round(Math.max(interfaceZoomRef.current - 0.05, 0.7) * 20) / 20;
        toast(`Zoom ${Math.round(newZoom * 100)}%`, { id: "zoom", duration: 1500 });
        return;
      }

      // Cmd+0 - Reset zoom (works everywhere, including settings)
      if ((e.metaKey || e.ctrlKey) && e.key === "0") {
        e.preventDefault();
        setInterfaceZoom(1.0);
        toast("Zoom 100%", { id: "zoom", duration: 1500 });
        return;
      }

      // Block all other shortcuts when in settings view
      if (ui.view === "settings") {
        return;
      }

      // Cmd+Shift+Enter - Toggle focus mode
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "Enter") {
        e.preventDefault();
        toggleFocusMode();
        return;
      }

      // Cmd+Shift+M - Toggle markdown source mode
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "m"
      ) {
        e.preventDefault();
        dispatchUi({ type: "REQUEST_TOGGLE_SOURCE_MODE" });
        return;
      }

      // Escape exits focus mode when not in editor
      if (e.key === "Escape" && ui.focusMode && !isInEditor) {
        e.preventDefault();
        toggleFocusMode();
        return;
      }

      // Trap Tab/Shift+Tab in notes view only - prevent focus navigation
      // TipTap handles indentation internally before event bubbles up
      if (e.key === "Tab") {
        e.preventDefault();
        return;
      }

      // Cmd+P - Open command palette
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault();
        dispatchUi({ type: "OPEN_PALETTE" });
        return;
      }

      // Cmd/Ctrl+Shift+F - Open sidebar search
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "f"
      ) {
        e.preventDefault();
        dispatchUi({ type: "REQUEST_OPEN_SIDEBAR_SEARCH" });
        return;
      }

      // Cmd+\ - Toggle sidebar
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      // Cmd+N - New note
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        createNote();
        return;
      }

      // Cmd+R - Reload current note (pull external changes)
      if ((e.metaKey || e.ctrlKey) && e.key === "r") {
        e.preventDefault();
        reloadCurrentNote();
        return;
      }

      // Arrow keys for note navigation (when not in editor or input)
      if (!isInEditor && !isInInput && displayItems.length > 0) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const currentIndex = displayItems.findIndex(
            (n) => n.id === selectedNoteId,
          );
          let newIndex: number;

          if (e.key === "ArrowDown") {
            newIndex =
              currentIndex < displayItems.length - 1 ? currentIndex + 1 : 0;
          } else {
            newIndex =
              currentIndex > 0 ? currentIndex - 1 : displayItems.length - 1;
          }

          selectNote(displayItems[newIndex].id);
          return;
        }

        // Enter to focus editor
        if (e.key === "Enter" && selectedNoteId) {
          e.preventDefault();
          const editor = document.querySelector(".ProseMirror") as HTMLElement;
          if (editor) {
            editor.focus();
          }
          return;
        }
      }

      // Escape to blur editor and go back to note list
      if (e.key === "Escape" && isInEditor) {
        e.preventDefault();
        (target as HTMLElement).blur();
        dispatchUi({ type: "REQUEST_FOCUS_NOTE_LIST" });
        return;
      }
    };

    // Disable right-click context menu except in editor
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Allow context menu in editor (prose class) and inputs
      const isInEditor =
        target.closest(".prose") || target.closest(".ProseMirror");
      const isInput =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA";
      if (!isInEditor && !isInput) {
        e.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("contextmenu", handleContextMenu);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [
    createNote,
    displayItems,
    reloadCurrentNote,
    selectedNoteId,
    selectNote,
    toggleSettings,
    toggleSidebar,
    toggleFocusMode,
    ui.focusMode,
    ui.view,
    setInterfaceZoom,
  ]);

  const handleClosePalette = useCallback(() => {
    dispatchUi({ type: "CLOSE_PALETTE" });
  }, []);

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-bg-secondary">
        <div className="text-text-muted/70 text-sm flex items-center gap-1.5 font-medium">
          <SpinnerIcon className="w-4.5 h-4.5 stroke-[1.5] animate-spin" />
          Initializing Scratch...
        </div>
      </div>
    );
  }

  if (!notesFolder) {
    return <FolderPicker />;
  }

  return (
    <>
      <div className="h-screen flex bg-bg overflow-hidden">
        {ui.view === "settings" ? (
          <SettingsPage onBack={closeSettings} />
        ) : (
          <>
            <div
              className={`transition-all duration-500 ease-out overflow-hidden ${!ui.sidebarVisible || ui.focusMode ? "opacity-0 -translate-x-4 w-0 pointer-events-none" : "opacity-100 translate-x-0 w-64"}`}
            >
              <Sidebar
                onOpenSettings={toggleSettings}
                openSearchSignal={ui.openSidebarSearchSignal}
                focusNoteListSignal={ui.focusNoteListSignal}
                toggleAllFoldersSignal={ui.toggleAllFoldersSignal}
                onToggleAllFolders={() =>
                  dispatchUi({ type: "REQUEST_TOGGLE_ALL_FOLDERS" })
                }
              />
            </div>
            <Editor
              onToggleSidebar={toggleSidebar}
              sidebarVisible={ui.sidebarVisible && !ui.focusMode}
              focusMode={ui.focusMode}
              toggleSourceModeSignal={ui.toggleSourceModeSignal}
              onEditorReady={(editor) => {
                editorRef.current = editor;
              }}
            />
          </>
        )}
      </div>

      {/* Shared backdrop for command palette and AI modal */}
      {(ui.paletteOpen || ui.aiModalOpen) && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 animate-fade-in"
          onClick={() => {
            if (ui.paletteOpen) handleClosePalette();
            if (ui.aiModalOpen) dispatchUi({ type: "CLOSE_AI_MODAL" });
          }}
        />
      )}

      <CommandPalette
        open={ui.paletteOpen}
        onClose={handleClosePalette}
        onOpenSettings={toggleSettings}
        onToggleSourceMode={() =>
          dispatchUi({ type: "REQUEST_TOGGLE_SOURCE_MODE" })
        }
        onToggleFolderTree={() =>
          dispatchUi({ type: "REQUEST_TOGGLE_ALL_FOLDERS" })
        }
        onOpenAiModal={(provider) => {
          dispatchUi({ type: "OPEN_AI_MODAL", provider });
        }}
        focusMode={ui.focusMode}
        onToggleFocusMode={toggleFocusMode}
        editorRef={editorRef}
      />
      <AiEditModal
        open={ui.aiModalOpen}
        provider={ui.aiProvider}
        onBack={handleBackToPalette}
        onExecute={handleAiEdit}
        isExecuting={ui.aiEditing}
      />

      {/* AI Editing Overlay */}
      {ui.aiEditing && (
        <div className="fixed inset-0 bg-bg/50 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="flex items-center gap-2">
            {ui.aiProvider === "codex" ? (
              <CodexIcon className="w-4.5 h-4.5 fill-text-muted animate-spin-slow" />
            ) : ui.aiProvider === "ollama" ? (
              <OllamaIcon className="w-4.5 h-4.5 fill-text-muted animate-bounce-gentle" />
            ) : (
              <ClaudeIcon className="w-4.5 h-4.5 fill-text-muted animate-spin-slow" />
            )}
            <div className="text-sm font-medium text-text">
              {ui.aiProvider === "codex"
                ? "Codex is editing your note..."
                : ui.aiProvider === "ollama"
                  ? "Ollama is editing your note..."
                  : "Claude is editing your note..."}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Shared update check — used by startup and manual "Check for Updates"
async function showUpdateToast(): Promise<"update" | "no-update" | "error"> {
  try {
    const update = await checkForUpdate();
    if (update) {
      toast(<UpdateToast update={update} toastId="update-toast" />, {
        id: "update-toast",
        duration: Infinity,
        closeButton: true,
      });
      return "update";
    }
    return "no-update";
  } catch (err) {
    // Network errors and 404s (no release published yet) are not real failures
    const msg = String(err);
    if (
      msg.includes("404") ||
      msg.includes("network") ||
      msg.includes("Could not fetch")
    ) {
      return "no-update";
    }
    console.error("Update check failed:", err);
    return "error";
  }
}

export { showUpdateToast };

function UpdateToast({
  update,
  toastId,
}: {
  update: Update;
  toastId: string | number;
}) {
  const [installing, setInstalling] = useState(false);

  const handleUpdate = async () => {
    setInstalling(true);
    try {
      await update.downloadAndInstall();
      toast.dismiss(toastId);
      toast.success("Update installed! Restart Scratch to apply.", {
        duration: Infinity,
        closeButton: true,
      });
    } catch (err) {
      console.error("Update failed:", err);
      toast.error("Update failed. Please try again later.");
      setInstalling(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="font-medium text-sm">
        Update Available: v{update.version}
      </div>
      {update.body && (
        <div className="text-xs text-text-muted line-clamp-3">
          {update.body}
        </div>
      )}
      <button
        onClick={handleUpdate}
        disabled={installing}
        className="self-start mt-1 text-xs font-medium px-3 py-1.5 rounded-md bg-text text-bg hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        {installing ? "Installing..." : "Update Now"}
      </button>
    </div>
  );
}

function App() {
  const { isPreview, previewFile, initialVaultPath } = useMemo(getWindowMode, []);

  // Cmd/Ctrl+W — close window (works in both preview and folder mode)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "w") {
        e.preventDefault();
        getCurrentWindow().close().catch(console.error);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Add platform class for OS-specific styling (e.g., keyboard shortcuts)
  useEffect(() => {
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
    document.documentElement.classList.add(
      isMac ? "platform-mac" : "platform-other",
    );
  }, []);

  // Check for app updates on startup (folder mode only)
  useEffect(() => {
    if (isPreview) return;
    const timer = setTimeout(() => showUpdateToast(), 3000);
    return () => clearTimeout(timer);
  }, [isPreview]);

  // Preview mode: lightweight editor without sidebar, search, git
  if (isPreview && previewFile) {
    return (
      <ThemeProvider>
        <Toaster />
        <TooltipProvider>
          <PreviewApp filePath={decodeURIComponent(previewFile)} />
        </TooltipProvider>
      </ThemeProvider>
    );
  }

  // Folder mode: full app with sidebar, search, git, etc.
  return (
    <ThemeProvider>
      <Toaster />
      <TooltipProvider>
        <NotesProvider initialVaultPath={initialVaultPath}>
          <GitProvider>
            <AppContent />
          </GitProvider>
        </NotesProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}

export default App;
