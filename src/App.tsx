import { useState, useEffect, useCallback, useMemo } from "react";
import { NotesProvider, useNotes } from "./context/NotesContext";
import { ThemeProvider } from "./context/ThemeContext";
import { GitProvider } from "./context/GitContext";
import { TooltipProvider, Toaster } from "./components/ui";
import { Sidebar } from "./components/layout/Sidebar";
import { Editor } from "./components/editor/Editor";
import { FolderPicker } from "./components/layout/FolderPicker";
import { CommandPalette } from "./components/command-palette/CommandPalette";
import { SettingsPage } from "./components/settings";

type ViewState = "notes" | "settings";

function AppContent() {
  const {
    notesFolder,
    isLoading,
    createNote,
    notes,
    selectedNoteId,
    selectNote,
    searchQuery,
    searchResults,
    reloadCurrentNote,
  } = useNotes();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [view, setView] = useState<ViewState>("notes");
  const [sidebarVisible, setSidebarVisible] = useState(true);

  const toggleSidebar = useCallback(() => {
    setSidebarVisible((prev) => !prev);
  }, []);

  const toggleSettings = useCallback(() => {
    setView((prev) => (prev === "settings" ? "notes" : "settings"));
  }, []);

  const closeSettings = useCallback(() => {
    setView("notes");
  }, []);

  // Memoize display items to prevent unnecessary recalculations
  const displayItems = useMemo(() => {
    return searchQuery.trim() ? searchResults : notes;
  }, [searchQuery, searchResults, notes]);

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

      // Block all other shortcuts when in settings view
      if (view === "settings") {
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
        setPaletteOpen(true);
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
            (n) => n.id === selectedNoteId
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
        // Focus the note list for keyboard navigation
        window.dispatchEvent(new CustomEvent("focus-note-list"));
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
    view,
  ]);

  const handleClosePalette = useCallback(() => {
    setPaletteOpen(false);
  }, []);

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-bg-secondary">
        <div className="text-text-muted">Loading...</div>
      </div>
    );
  }

  if (!notesFolder) {
    return <FolderPicker />;
  }

  return (
    <>
      <div className="h-screen flex bg-bg overflow-hidden">
        {view === "settings" ? (
          <SettingsPage onBack={closeSettings} />
        ) : (
          <>
            {sidebarVisible && <Sidebar onOpenSettings={toggleSettings} />}
            <Editor
              onToggleSidebar={toggleSidebar}
              sidebarVisible={sidebarVisible}
            />
          </>
        )}
      </div>
      <CommandPalette
        open={paletteOpen}
        onClose={handleClosePalette}
        onOpenSettings={toggleSettings}
      />
    </>
  );
}

function App() {
  // Add platform class for OS-specific styling (e.g., keyboard shortcuts)
  useEffect(() => {
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
    document.documentElement.classList.add(
      isMac ? "platform-mac" : "platform-other"
    );
  }, []);

  return (
    <ThemeProvider>
      <Toaster />
      <TooltipProvider>
        <NotesProvider>
          <GitProvider>
            <AppContent />
          </GitProvider>
        </NotesProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}

export default App;
