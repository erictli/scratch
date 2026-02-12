import { useEffect, useRef, useCallback, useState } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import type { BlockNoteEditor } from "@blocknote/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { toast } from "sonner";
import { mod, shift, isMac } from "../../lib/platform";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useNotes } from "../../context/NotesContext";
import { useTheme } from "../../context/ThemeContext";
import { cn } from "../../lib/utils";
import { Button, IconButton, Tooltip } from "../ui";
import * as notesService from "../../services/notes";
import type { Settings } from "../../types/note";
import {
  SpinnerIcon,
  CircleCheckIcon,
  CopyIcon,
  PanelLeftIcon,
  RefreshCwIcon,
  PinIcon,
  ImageIcon,
} from "../icons";

function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface EditorProps {
  onToggleSidebar?: () => void;
  sidebarVisible?: boolean;
}

export function Editor({ onToggleSidebar, sidebarVisible }: EditorProps) {
  const {
    currentNote,
    saveNote,
    createNote,
    hasExternalChanges,
    reloadCurrentNote,
    reloadVersion,
    pinNote,
    unpinNote,
  } = useNotes();
  const { resolvedTheme } = useTheme();
  const [isSaving, setIsSaving] = useState(false);
  const [copyMenuOpen, setCopyMenuOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const isLoadingRef = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const currentNoteIdRef = useRef<string | null>(null);
  const needsSaveRef = useRef(false);

  // Keep ref in sync with current note ID
  currentNoteIdRef.current = currentNote?.id ?? null;

  // Create BlockNote editor
  const editor = useCreateBlockNote();

  // Track which note's content is currently loaded in the editor
  const loadedNoteIdRef = useRef<string | null>(null);
  const loadedModifiedRef = useRef<number | null>(null);
  const lastSaveRef = useRef<{ noteId: string; content: string } | null>(null);
  const lastReloadVersionRef = useRef(0);

  // Get markdown from BlockNote editor
  const getMarkdown = useCallback(
    (editorInstance: BlockNoteEditor) => {
      try {
        return editorInstance.blocksToMarkdownLossy(editorInstance.document);
      } catch {
        return "";
      }
    },
    [],
  );

  // Load settings when note changes
  useEffect(() => {
    if (currentNote?.id) {
      notesService
        .getSettings()
        .then(setSettings)
        .catch((error) => {
          console.error("Failed to load settings:", error);
          toast.error(
            `Failed to load settings: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
          );
        });
    }
  }, [currentNote?.id]);

  const isPinned =
    settings?.pinnedNoteIds?.includes(currentNote?.id || "") || false;

  // Immediate save function
  const saveImmediately = useCallback(
    async (noteId: string, content: string) => {
      setIsSaving(true);
      try {
        lastSaveRef.current = { noteId, content };
        await saveNote(content, noteId);
      } finally {
        setIsSaving(false);
      }
    },
    [saveNote],
  );

  // Flush any pending save immediately
  const flushPendingSave = useCallback(async () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    if (needsSaveRef.current && editor && loadedNoteIdRef.current) {
      needsSaveRef.current = false;
      const markdown = getMarkdown(editor);
      await saveImmediately(loadedNoteIdRef.current, markdown);
    }
  }, [saveImmediately, getMarkdown, editor]);

  // Schedule a debounced save
  const scheduleSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    const savingNoteId = currentNote?.id;
    if (!savingNoteId) return;

    needsSaveRef.current = true;

    saveTimeoutRef.current = window.setTimeout(() => {
      if (currentNoteIdRef.current !== savingNoteId || !needsSaveRef.current) {
        return;
      }

      if (editor) {
        needsSaveRef.current = false;
        const markdown = getMarkdown(editor);
        saveImmediately(savingNoteId, markdown);
      }
    }, 500);
  }, [saveImmediately, getMarkdown, currentNote?.id, editor]);

  // Handle editor content changes
  const handleEditorChange = useCallback(() => {
    if (isLoadingRef.current) return;
    scheduleSave();
  }, [scheduleSave]);

  // Load note content when the current note changes
  useEffect(() => {
    if (!currentNote || !editor) return;

    const isSameNote = currentNote.id === loadedNoteIdRef.current;

    // Flush any pending save before switching to a different note
    if (!isSameNote && needsSaveRef.current) {
      void flushPendingSave();
    }

    const isManualReload = reloadVersion !== lastReloadVersionRef.current;

    if (isSameNote) {
      if (isManualReload) {
        lastReloadVersionRef.current = reloadVersion;
        loadedModifiedRef.current = currentNote.modified;
        isLoadingRef.current = true;

        try {
          const blocks = editor.tryParseMarkdownToBlocks(currentNote.content);
          editor.replaceBlocks(editor.document, blocks);
        } catch {
          // Fallback: ignore parse errors
        }
        isLoadingRef.current = false;
        return;
      }
      loadedModifiedRef.current = currentNote.modified;
      return;
    }

    // Handle note rename
    const lastSave = lastSaveRef.current;
    if (
      lastSave?.noteId === loadedNoteIdRef.current &&
      lastSave?.content === currentNote.content
    ) {
      loadedNoteIdRef.current = currentNote.id;
      loadedModifiedRef.current = currentNote.modified;
      lastSaveRef.current = null;
      return;
    }

    const loadingNoteId = currentNote.id;

    loadedNoteIdRef.current = loadingNoteId;
    loadedModifiedRef.current = currentNote.modified;

    isLoadingRef.current = true;

    // Parse markdown and load into BlockNote
    try {
      const blocks = editor.tryParseMarkdownToBlocks(currentNote.content);
      if (loadedNoteIdRef.current !== loadingNoteId) return;
      editor.replaceBlocks(editor.document, blocks);
    } catch {
      // Fallback: ignore parse errors
    }

    scrollContainerRef.current?.scrollTo(0, 0);

    requestAnimationFrame(() => {
      if (loadedNoteIdRef.current !== loadingNoteId) return;
      scrollContainerRef.current?.scrollTo(0, 0);
      isLoadingRef.current = false;
    });
  }, [currentNote, editor, flushPendingSave, reloadVersion]);

  // Scroll to top on mount
  useEffect(() => {
    scrollContainerRef.current?.scrollTo(0, 0);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      if (needsSaveRef.current && editor) {
        needsSaveRef.current = false;
        try {
          const markdown = editor.blocksToMarkdownLossy(editor.document);
          saveNote(markdown);
        } catch {
          // Ignore errors during cleanup
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard shortcut for Cmd+Shift+C to open copy menu
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "c") {
        e.preventDefault();
        setCopyMenuOpen(true);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Image handler
  const handleAddImage = useCallback(async () => {
    if (!editor) return;
    const selected = await openDialog({
      multiple: false,
      filters: [
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"],
        },
      ],
    });
    if (selected) {
      try {
        const relativePath = await invoke<string>("copy_image_to_assets", {
          sourcePath: selected as string,
        });
        const notesFolder = await invoke<string>("get_notes_folder");
        const absolutePath = await join(notesFolder, relativePath);
        const assetUrl = convertFileSrc(absolutePath);

        const cursorBlock = editor.getTextCursorPosition().block;
        editor.insertBlocks(
          [
            {
              type: "image",
              props: { url: assetUrl },
            },
          ],
          cursorBlock,
          "after",
        );
      } catch (error) {
        console.error("Failed to add image:", error);
        toast.error("Failed to add image");
      }
    }
  }, [editor]);

  // Copy handlers
  const handleCopyMarkdown = useCallback(async () => {
    if (!editor) return;
    try {
      const markdown = getMarkdown(editor);
      await invoke("copy_to_clipboard", { text: markdown });
      toast.success("Copied as Markdown");
    } catch (error) {
      console.error("Failed to copy markdown:", error);
      toast.error("Failed to copy");
    }
  }, [editor, getMarkdown]);

  const handleCopyPlainText = useCallback(async () => {
    if (!editor) return;
    try {
      // Convert to markdown then strip formatting for plain text
      const markdown = getMarkdown(editor);
      const text = markdown
        .replace(/^#{1,6}\s+/gm, "") // strip heading markers
        .replace(/\*\*(.+?)\*\*/g, "$1") // bold
        .replace(/\*(.+?)\*/g, "$1") // italic
        .replace(/`(.+?)`/g, "$1") // inline code
        .replace(/\[(.+?)\]\(.+?\)/g, "$1") // links
        .replace(/!\[.*?\]\(.+?\)/g, "") // images
        .replace(/^[-*+]\s+/gm, "- ") // normalize list markers
        .replace(/^\d+\.\s+/gm, (m) => m); // keep numbered lists
      await invoke("copy_to_clipboard", { text });
      toast.success("Copied as plain text");
    } catch (error) {
      console.error("Failed to copy plain text:", error);
      toast.error("Failed to copy");
    }
  }, [editor, getMarkdown]);

  const handleCopyHtml = useCallback(async () => {
    if (!editor) return;
    try {
      const html = editor.blocksToHTMLLossy(editor.document);
      await invoke("copy_to_clipboard", { text: html });
      toast.success("Copied as HTML");
    } catch (error) {
      console.error("Failed to copy HTML:", error);
      toast.error("Failed to copy");
    }
  }, [editor]);

  if (!currentNote) {
    return (
      <div className="flex-1 flex flex-col bg-bg">
        <div
          className="h-10 shrink-0 flex items-end px-4 pb-1"
          data-tauri-drag-region
        ></div>
        <div className="flex-1 flex items-center justify-center pb-8">
          <div className="text-center text-text-muted select-none">
            <img
              src="/note-dark.png"
              alt="Note"
              className="w-42 h-auto mx-auto mb-1 invert dark:invert-0"
            />
            <h1 className="text-2xl text-text font-serif mb-1 tracking-[-0.01em]">
              What's on your mind?
            </h1>
            <p className="text-sm">
              Pick up where you left off, or start something new
            </p>
            <Button
              onClick={createNote}
              variant="secondary"
              size="md"
              className="mt-4"
            >
              New Note{" "}
              <span className="text-text-muted ml-1">
                {mod}
                {isMac ? "" : "+"}N
              </span>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-bg overflow-hidden">
      {/* Drag region with sidebar toggle, date and save status */}
      <div
        className={cn(
          "h-11 shrink-0 flex items-center justify-between px-3",
          !sidebarVisible && "pl-22",
        )}
        data-tauri-drag-region
      >
        <div className="titlebar-no-drag flex items-center gap-1 min-w-0">
          {onToggleSidebar && (
            <IconButton
              onClick={onToggleSidebar}
              title={
                sidebarVisible
                  ? `Hide sidebar (${mod}${isMac ? "" : "+"}\\)`
                  : `Show sidebar (${mod}${isMac ? "" : "+"}\\)`
              }
              className="shrink-0"
            >
              <PanelLeftIcon className="w-4.5 h-4.5 stroke-[1.5]" />
            </IconButton>
          )}
          <span className="text-xs text-text-muted mb-px truncate">
            {formatDateTime(currentNote.modified)}
          </span>
        </div>
        <div className="titlebar-no-drag flex items-center gap-px shrink-0">
          {hasExternalChanges ? (
            <Tooltip
              content={`External changes detected (${mod}${isMac ? "" : "+"}R to refresh)`}
            >
              <button
                onClick={reloadCurrentNote}
                className="h-7 px-2 flex items-center gap-1 text-xs text-orange-500 hover:bg-orange-500/10 rounded transition-colors font-medium"
              >
                <RefreshCwIcon className="w-4 h-4 stroke-[1.6]" />
                <span>Refresh</span>
              </button>
            </Tooltip>
          ) : isSaving ? (
            <Tooltip content="Saving...">
              <div className="h-7 w-7 flex items-center justify-center">
                <SpinnerIcon className="w-4.5 h-4.5 text-text-muted/40 stroke-[1.5] animate-spin" />
              </div>
            </Tooltip>
          ) : (
            <Tooltip content="All changes saved">
              <div className="h-7 w-7 flex items-center justify-center rounded-full">
                <CircleCheckIcon className="w-4.5 h-4.5 mt-px stroke-[1.5] text-text-muted/40" />
              </div>
            </Tooltip>
          )}
          <Tooltip content={isPinned ? "Unpin note" : "Pin note"}>
            <IconButton
              onClick={async () => {
                try {
                  if (isPinned) {
                    await unpinNote(currentNote.id);
                    toast.success("Note unpinned");
                  } else {
                    await pinNote(currentNote.id);
                    toast.success("Note pinned");
                  }
                  const updatedSettings = await notesService.getSettings();
                  setSettings(updatedSettings);
                } catch (error) {
                  console.error("Failed to pin/unpin note:", error);
                  toast.error(
                    `Failed to ${isPinned ? "unpin" : "pin"} note: ${
                      error instanceof Error ? error.message : "Unknown error"
                    }`,
                  );
                }
              }}
            >
              <PinIcon
                className={cn(
                  "w-5 h-5 stroke-[1.3]",
                  isPinned && "fill-current",
                )}
              />
            </IconButton>
          </Tooltip>
          <Tooltip content="Add image">
            <IconButton onClick={handleAddImage}>
              <ImageIcon className="w-4.25 h-4.25 stroke-[1.6]" />
            </IconButton>
          </Tooltip>
          <DropdownMenu.Root open={copyMenuOpen} onOpenChange={setCopyMenuOpen}>
            <Tooltip
              content={`Copy as... (${mod}${isMac ? "" : "+"}${shift}${isMac ? "" : "+"}C)`}
            >
              <DropdownMenu.Trigger asChild>
                <IconButton>
                  <CopyIcon className="w-4.25 h-4.25 stroke-[1.6]" />
                </IconButton>
              </DropdownMenu.Trigger>
            </Tooltip>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="min-w-35 bg-bg border border-border rounded-md shadow-lg py-1 z-50"
                sideOffset={5}
                align="end"
                onCloseAutoFocus={(e) => e.preventDefault()}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                    e.stopPropagation();
                  }
                }}
              >
                <DropdownMenu.Item
                  className="px-3 py-1.5 text-sm text-text cursor-pointer outline-none hover:bg-bg-muted focus:bg-bg-muted"
                  onSelect={handleCopyMarkdown}
                >
                  Markdown
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="px-3 py-1.5 text-sm text-text cursor-pointer outline-none hover:bg-bg-muted focus:bg-bg-muted"
                  onSelect={handleCopyPlainText}
                >
                  Plain Text
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="px-3 py-1.5 text-sm text-text cursor-pointer outline-none hover:bg-bg-muted focus:bg-bg-muted"
                  onSelect={handleCopyHtml}
                >
                  HTML
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>

      {/* BlockNote Editor */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto"
      >
        <div className="max-w-3xl mx-auto px-12 pt-4 pb-24">
          <BlockNoteView
            editor={editor}
            theme={resolvedTheme}
            onChange={handleEditorChange}
          />
        </div>
      </div>
    </div>
  );
}
