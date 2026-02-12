import { useEffect, useRef, useCallback, useState } from "react";
import {
  useEditor,
  EditorContent,
  ReactRenderer,
  type Editor as TiptapEditor,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import { Extension } from "@tiptap/core";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { toast } from "sonner";
import { mod, alt, shift, isMac } from "../../lib/platform";

// Validate URL scheme for safe opening
function isAllowedUrlScheme(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { useNotes } from "../../context/NotesContext";
import { useTheme } from "../../context/ThemeContext";
import { LinkEditor } from "./LinkEditor";
import { SearchToolbar } from "./SearchToolbar";
import { cn } from "../../lib/utils";
import {
  DEFAULT_SHORTCUTS,
  getShortcutDisplayText,
  matchesParsedShortcut,
  parseShortcut,
} from "../../lib/shortcuts";
import { Button, IconButton, ToolbarButton, Tooltip } from "../ui";
import * as notesService from "../../services/notes";
import type { Settings } from "../../types/note";
import {
  BoldIcon,
  ItalicIcon,
  StrikethroughIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  Heading4Icon,
  ListIcon,
  ListOrderedIcon,
  CheckSquareIcon,
  QuoteIcon,
  CodeIcon,
  InlineCodeIcon,
  SeparatorIcon,
  LinkIcon,
  ImageIcon,
  TableIcon,
  SpinnerIcon,
  CircleCheckIcon,
  CopyIcon,
  PanelLeftIcon,
  RefreshCwIcon,
  PinIcon,
  SearchIcon,
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

// Search highlight extension - adds yellow backgrounds to search matches
const searchHighlightPluginKey = new PluginKey("searchHighlight");

interface SearchHighlightOptions {
  matches: Array<{ from: number; to: number }>;
  currentIndex: number;
}

const SearchHighlight = Extension.create<SearchHighlightOptions>({
  name: "searchHighlight",

  addOptions() {
    return {
      matches: [],
      currentIndex: 0,
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: searchHighlightPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, oldSet) => {
            // Map decorations through document changes
            const set = oldSet.map(tr.mapping, tr.doc);

            // Check if we need to update decorations (from transaction meta)
            const meta = tr.getMeta(searchHighlightPluginKey);
            if (meta !== undefined) {
              return meta.decorationSet;
            }

            return set;
          },
        },
        props: {
          decorations: (state) => {
            return searchHighlightPluginKey.getState(state);
          },
        },
      }),
    ];
  },
});

// GridPicker component for table insertion
interface GridPickerProps {
  onSelect: (rows: number, cols: number) => void;
}

function GridPicker({ onSelect }: GridPickerProps) {
  const [hovered, setHovered] = useState({ row: 3, col: 3 });

  return (
    <>
      <div className="grid grid-cols-5 gap-1">
        {Array.from({ length: 25 }).map((_, i) => {
          const row = Math.floor(i / 5) + 1;
          const col = (i % 5) + 1;
          const isHighlighted = row <= hovered.row && col <= hovered.col;

          return (
            <div
              key={i}
              className={cn(
                "w-5.5 h-5.5 border rounded cursor-pointer transition-colors",
                isHighlighted
                  ? "bg-accent/20 border-accent/50"
                  : "border-border hover:border-accent/50",
              )}
              onMouseEnter={() => setHovered({ row, col })}
              onClick={() => onSelect(row, col)}
            />
          );
        })}
      </div>
      <p className="text-xs text-center mt-2 text-text-muted">
        {hovered.row} × {hovered.col} table
      </p>
    </>
  );
}

interface FormatBarProps {
  editor: TiptapEditor | null;
  onAddLink: () => void;
  onAddImage: () => void;
  boldShortcutLabel: string;
  italicShortcutLabel: string;
  addLinkShortcutLabel: string;
}

// FormatBar must re-render with parent to reflect editor.isActive() state changes
// (editor instance is mutable, so memo would cause stale active states)
function FormatBar({
  editor,
  onAddLink,
  onAddImage,
  boldShortcutLabel,
  italicShortcutLabel,
  addLinkShortcutLabel,
}: FormatBarProps) {
  const [tableMenuOpen, setTableMenuOpen] = useState(false);

  if (!editor) return null;

  return (
    <div className="flex items-center gap-1 px-3 pb-2 border-b border-border overflow-x-auto scrollbar-none">
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive("bold")}
        title={`Bold (${boldShortcutLabel})`}
      >
        <BoldIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive("italic")}
        title={`Italic (${italicShortcutLabel})`}
      >
        <ItalicIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        isActive={editor.isActive("strike")}
        title={`Strikethrough (${mod}${isMac ? "" : "+"}${shift}${isMac ? "" : "+"}S)`}
      >
        <StrikethroughIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>

      <div className="w-px h-4.5 border-l border-border mx-2" />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        isActive={editor.isActive("heading", { level: 1 })}
        title={`Heading 1 (${mod}${isMac ? "" : "+"}${alt}${isMac ? "" : "+"}1)`}
      >
        <Heading1Icon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        isActive={editor.isActive("heading", { level: 2 })}
        title={`Heading 2 (${mod}${isMac ? "" : "+"}${alt}${isMac ? "" : "+"}2)`}
      >
        <Heading2Icon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        isActive={editor.isActive("heading", { level: 3 })}
        title={`Heading 3 (${mod}${isMac ? "" : "+"}${alt}${isMac ? "" : "+"}3)`}
      >
        <Heading3Icon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
        isActive={editor.isActive("heading", { level: 4 })}
        title={`Heading 4 (${mod}${isMac ? "" : "+"}${alt}${isMac ? "" : "+"}4)`}
      >
        <Heading4Icon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>

      <div className="w-px h-4.5 border-l border-border mx-2" />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        isActive={editor.isActive("bulletList")}
        title={`Bullet List (${mod}${isMac ? "" : "+"}${shift}${isMac ? "" : "+"}8)`}
      >
        <ListIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        isActive={editor.isActive("orderedList")}
        title={`Numbered List (${mod}${isMac ? "" : "+"}${shift}${isMac ? "" : "+"}7)`}
      >
        <ListOrderedIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        isActive={editor.isActive("taskList")}
        title="Task List"
      >
        <CheckSquareIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        isActive={editor.isActive("blockquote")}
        title={`Blockquote (${mod}${isMac ? "" : "+"}${shift}${isMac ? "" : "+"}B)`}
      >
        <QuoteIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCode().run()}
        isActive={editor.isActive("code")}
        title={`Inline Code (${mod}${isMac ? "" : "+"}E)`}
      >
        <InlineCodeIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        isActive={editor.isActive("codeBlock")}
        title={`Code Block (${mod}${isMac ? "" : "+"}${alt}${isMac ? "" : "+"}C)`}
      >
        <CodeIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        isActive={false}
        title="Horizontal Rule"
      >
        <SeparatorIcon />
      </ToolbarButton>

      <div className="w-px h-4.5 border-l border-border mx-2" />

      <ToolbarButton
        onClick={onAddLink}
        isActive={editor.isActive("link")}
        title={`Add Link (${addLinkShortcutLabel})`}
      >
        <LinkIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton onClick={onAddImage} isActive={false} title="Add Image">
        <ImageIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <DropdownMenu.Root open={tableMenuOpen} onOpenChange={setTableMenuOpen}>
        <Tooltip content="Insert Table">
          <DropdownMenu.Trigger asChild>
            <ToolbarButton isActive={editor.isActive("table")}>
              <TableIcon className="w-4.5 h-4.5 stroke-[1.5]" />
            </ToolbarButton>
          </DropdownMenu.Trigger>
        </Tooltip>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="p-2.5 bg-bg border border-border rounded-md shadow-lg z-50"
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <GridPicker
              onSelect={(rows, cols) => {
                editor
                  .chain()
                  .focus()
                  .insertTable({
                    rows,
                    cols,
                    withHeaderRow: true,
                  })
                  .run();
                setTableMenuOpen(false);
              }}
            />
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

interface EditorProps {
  onToggleSidebar?: () => void;
  sidebarVisible?: boolean;
}

export function Editor({ onToggleSidebar, sidebarVisible }: EditorProps) {
  const { shortcuts } = useTheme();
  const {
    notes,
    currentNote,
    saveNote,
    createNote,
    hasExternalChanges,
    reloadCurrentNote,
    reloadVersion,
    pinNote,
    unpinNote,
  } = useNotes();
  const [isSaving, setIsSaving] = useState(false);
  // Force re-render when selection changes to update toolbar active states
  const [, setSelectionKey] = useState(0);
  const [copyMenuOpen, setCopyMenuOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  // Search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatches, setSearchMatches] = useState<
    Array<{ from: number; to: number }>
  >([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const saveTimeoutRef = useRef<number | null>(null);
  const linkPopupRef = useRef<TippyInstance | null>(null);
  const isLoadingRef = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<TiptapEditor | null>(null);
  const currentNoteIdRef = useRef<string | null>(null);
  // Track if we need to save (use ref to avoid computing markdown on every keystroke)
  const needsSaveRef = useRef(false);

  // Keep ref in sync with current note ID
  currentNoteIdRef.current = currentNote?.id ?? null;

  // Get markdown from editor
  const getMarkdown = useCallback(
    (editorInstance: ReturnType<typeof useEditor>) => {
      if (!editorInstance) return "";
      const manager = editorInstance.storage.markdown?.manager;
      if (manager) {
        let markdown = manager.serialize(editorInstance.getJSON());
        // Clean up nbsp entities in table cells (TipTap adds these to empty cells)
        // Match table rows and remove one or more &nbsp; or &#160; from cells
        markdown = markdown.replace(/(\|)\s*(?:&nbsp;|&#160;)+\s*(?=\|)/g, "$1 ");
        return markdown;
      }
      // Fallback to plain text
      return editorInstance.getText();
    },
    [],
  );

  // Load settings when note changes or notes are refreshed (e.g., after pin/unpin)
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
  }, [currentNote?.id, notes]);

  // Calculate if current note is pinned
  const isPinned =
    settings?.pinnedNoteIds?.includes(currentNote?.id || "") || false;

  // Find all matches for search query (case-insensitive)
  const findMatches = useCallback(
    (query: string, editorInstance: TiptapEditor | null) => {
      if (!editorInstance || !query.trim()) return [];

      const doc = editorInstance.state.doc;
      const lowerQuery = query.toLowerCase();
      const matches: Array<{ from: number; to: number }> = [];

      // Search through each text node
      doc.descendants((node, nodePos) => {
        if (node.isText && node.text) {
          const text = node.text;
          const lowerText = text.toLowerCase();

          let searchPos = 0;
          while (searchPos < lowerText.length && matches.length < 500) {
            const index = lowerText.indexOf(lowerQuery, searchPos);
            if (index === -1) break;

            const matchFrom = nodePos + index;
            const matchTo = matchFrom + query.length;

            // Make sure the match doesn't extend beyond valid document bounds
            if (matchTo <= doc.content.size) {
              matches.push({
                from: matchFrom,
                to: matchTo,
              });
            }

            searchPos = index + 1;
          }
        }
      });

      return matches;
    },
    [],
  );

  // Update search decorations - applies yellow backgrounds to all matches
  const updateSearchDecorations = useCallback(
    (
      matches: Array<{ from: number; to: number }>,
      currentIndex: number,
      editorInstance: TiptapEditor | null,
    ) => {
      if (!editorInstance) return;

      try {
        const { state } = editorInstance;
        const decorations: Decoration[] = [];

        // Add decorations for all matches
        matches.forEach((match, index) => {
          const isActive = index === currentIndex;
          decorations.push(
            Decoration.inline(match.from, match.to, {
              class: isActive
                ? "bg-yellow-300/50 dark:bg-yellow-400/40" // Brighter yellow for active match
                : "bg-yellow-300/25 dark:bg-yellow-400/20", // Lighter yellow for inactive matches
            }),
          );
        });

        const decorationSet = DecorationSet.create(state.doc, decorations);

        // Update decorations via transaction
        const tr = state.tr.setMeta(searchHighlightPluginKey, {
          decorationSet,
        });

        editorInstance.view.dispatch(tr);

        // Scroll to current match
        if (matches[currentIndex]) {
          const match = matches[currentIndex];
          const { node } = editorInstance.view.domAtPos(match.from);
          const element =
            node.nodeType === Node.ELEMENT_NODE
              ? (node as HTMLElement)
              : node.parentElement;

          if (element) {
            element.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }
      } catch (error) {
        console.error("Failed to update search decorations:", error);
      }
    },
    [],
  );

  // Immediate save function (used for flushing)
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

  // Flush any pending save immediately (saves to the note currently loaded in editor)
  const flushPendingSave = useCallback(async () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    // Use loadedNoteIdRef (the note in the editor) not currentNoteIdRef (which may have changed)
    if (needsSaveRef.current && editorRef.current && loadedNoteIdRef.current) {
      needsSaveRef.current = false;
      const markdown = getMarkdown(editorRef.current);
      await saveImmediately(loadedNoteIdRef.current, markdown);
    }
  }, [saveImmediately, getMarkdown]);

  // Schedule a debounced save (markdown computed only when timer fires)
  const scheduleSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    const savingNoteId = currentNote?.id;
    if (!savingNoteId) return;

    needsSaveRef.current = true;

    saveTimeoutRef.current = window.setTimeout(async () => {
      if (currentNoteIdRef.current !== savingNoteId || !needsSaveRef.current) {
        return;
      }

      // Compute markdown only now, when we actually save
      if (editorRef.current) {
        needsSaveRef.current = false;
        const markdown = getMarkdown(editorRef.current);
        await saveImmediately(savingNoteId, markdown);
      }
    }, 500);
  }, [saveImmediately, getMarkdown, currentNote?.id]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3, 4, 5, 6],
        },
      }),
      Placeholder.configure({
        placeholder: "Start writing...",
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "underline cursor-pointer",
        },
      }),
      Image.configure({
        inline: false,
        allowBase64: false,
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      TableKit.configure({
        table: {
          resizable: false,
          HTMLAttributes: {
            class: "not-prose",
          },
        },
      }),
      Markdown.configure({}),
      SearchHighlight.configure({
        matches: [],
        currentIndex: 0,
      }),
    ],
    editorProps: {
      attributes: {
        class:
          "prose prose-lg dark:prose-invert max-w-3xl mx-auto focus:outline-none min-h-full px-6 pt-8 pb-24",
      },
      // Trap Tab key inside the editor
      handleKeyDown: (_view, event) => {
        if (event.key === "Tab") {
          // Allow default tab behavior (indent in lists, etc.)
          // but prevent focus from leaving the editor
          return false;
        }
        return false;
      },
      // Handle markdown and image paste
      handlePaste: (_view, event) => {
        const clipboardData = event.clipboardData;
        if (!clipboardData) return false;

        // Check for images first
        const items = Array.from(clipboardData.items);
        const imageItem = items.find((item) => item.type.startsWith("image/"));

        if (imageItem) {
          const blob = imageItem.getAsFile();
          if (blob) {
            // Convert blob to base64 and handle async operations
            const reader = new FileReader();
            reader.onload = async () => {
              const base64 = (reader.result as string).split(",")[1]; // Remove data:image/...;base64, prefix

              try {
                // Save clipboard image
                const relativePath = await invoke<string>(
                  "save_clipboard_image",
                  { base64Data: base64 },
                );

                // Get notes folder and construct absolute path using Tauri's join
                const notesFolder = await invoke<string>("get_notes_folder");
                const absolutePath = await join(notesFolder, relativePath);

                // Convert to Tauri asset URL
                const assetUrl = convertFileSrc(absolutePath);

                // Insert image
                editorRef.current
                  ?.chain()
                  .focus()
                  .setImage({ src: assetUrl })
                  .run();
              } catch (error) {
                console.error("Failed to paste image:", error);
                toast.error("Failed to paste image");
              }
            };
            reader.onerror = () => {
              console.error("Failed to read clipboard image:", reader.error);
              toast.error("Failed to read clipboard image");
            };
            reader.readAsDataURL(blob);
            return true; // Handled
          }
        }

        // Handle markdown text paste
        const text = clipboardData.getData("text/plain");
        if (!text) return false;

        // Check if text looks like markdown (has common markdown patterns)
        const markdownPatterns =
          /^#{1,6}\s|^\s*[-*+]\s|^\s*\d+\.\s|^\s*>\s|```|^\s*\[.*\]\(.*\)|^\s*!\[|\*\*.*\*\*|__.*__|~~.*~~|^\s*[-*_]{3,}\s*$|^\|.+\|$/m;
        if (!markdownPatterns.test(text)) {
          // Not markdown, let TipTap handle it normally
          return false;
        }

        // Parse markdown and insert using editor ref
        const currentEditor = editorRef.current;
        if (!currentEditor) return false;

        const manager = currentEditor.storage.markdown?.manager;
        if (manager && typeof manager.parse === "function") {
          try {
            const parsed = manager.parse(text);
            if (parsed) {
              currentEditor.commands.insertContent(parsed);
              return true;
            }
          } catch {
            // Fall back to default paste behavior
          }
        }

        return false;
      },
    },
    onCreate: ({ editor: editorInstance }) => {
      editorRef.current = editorInstance;
    },
    onUpdate: () => {
      if (isLoadingRef.current) return;
      scheduleSave();
    },
    onSelectionUpdate: () => {
      // Trigger re-render to update toolbar active states
      setSelectionKey((k) => k + 1);
    },
    // Prevent flash of unstyled content during initial render
    immediatelyRender: false,
  });

  // Track which note's content is currently loaded in the editor
  const loadedNoteIdRef = useRef<string | null>(null);
  // Track the modified timestamp of the loaded content
  const loadedModifiedRef = useRef<number | null>(null);
  // Track the last save (note ID and content) to detect our own saves vs external changes
  const lastSaveRef = useRef<{ noteId: string; content: string } | null>(null);
  // Track reloadVersion to detect manual refreshes
  const lastReloadVersionRef = useRef(0);

  // Search navigation functions (defined after editor is created)
  const goToNextMatch = useCallback(() => {
    if (searchMatches.length === 0 || !editor) return;
    const nextIndex = (currentMatchIndex + 1) % searchMatches.length;
    setCurrentMatchIndex(nextIndex);
    updateSearchDecorations(searchMatches, nextIndex, editor);
  }, [searchMatches, currentMatchIndex, editor, updateSearchDecorations]);

  const goToPreviousMatch = useCallback(() => {
    if (searchMatches.length === 0 || !editor) return;
    const prevIndex =
      (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
    setCurrentMatchIndex(prevIndex);
    updateSearchDecorations(searchMatches, prevIndex, editor);
  }, [searchMatches, currentMatchIndex, editor, updateSearchDecorations]);

  // Handle search query change
  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  // Debounced search effect
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchMatches([]);
      setCurrentMatchIndex(0);
      // Clear decorations when search is empty
      if (editor) {
        updateSearchDecorations([], 0, editor);
      }
      return;
    }

    const timer = setTimeout(() => {
      if (!editor) return;
      const matches = findMatches(searchQuery, editor);
      setSearchMatches(matches);
      setCurrentMatchIndex(0);
      // Always update decorations (clears old highlights when no matches)
      updateSearchDecorations(matches, 0, editor);
    }, 150);

    return () => clearTimeout(timer);
  }, [searchQuery, editor, findMatches, updateSearchDecorations]);

  // Prevent links from opening unless Cmd/Ctrl+Click
  useEffect(() => {
    if (!editor) return;

    const handleLinkClick = (e: MouseEvent) => {
      const link = (e.target as HTMLElement).closest("a");

      if (link) {
        e.preventDefault(); // Always prevent default link behavior

        // If Cmd/Ctrl is pressed, open in browser
        if ((e.metaKey || e.ctrlKey) && link.href) {
          if (isAllowedUrlScheme(link.href)) {
            openUrl(link.href).catch((error) =>
              console.error("Failed to open link:", error),
            );
          } else {
            toast.error("Cannot open links with this URL scheme");
          }
        }
      }
    };

    const editorElement = editor.view.dom;
    editorElement.addEventListener("click", handleLinkClick);

    return () => {
      editorElement.removeEventListener("click", handleLinkClick);
    };
  }, [editor]);

  // Load note content when the current note changes
  useEffect(() => {
    // Skip if no note or editor
    if (!currentNote || !editor) {
      return;
    }

    const isSameNote = currentNote.id === loadedNoteIdRef.current;

    // Flush any pending save before switching to a different note
    if (!isSameNote && needsSaveRef.current) {
      flushPendingSave();
    }
    // Check if this is a manual reload (user clicked Refresh button or pressed Cmd+R)
    const isManualReload = reloadVersion !== lastReloadVersionRef.current;

    if (isSameNote) {
      if (isManualReload) {
        // Manual reload - update the editor content
        lastReloadVersionRef.current = reloadVersion;
        loadedModifiedRef.current = currentNote.modified;
        isLoadingRef.current = true;
        const manager = editor.storage.markdown?.manager;
        if (manager) {
          try {
            const parsed = manager.parse(currentNote.content);
            editor.commands.setContent(parsed);
          } catch {
            editor.commands.setContent(currentNote.content);
          }
        } else {
          editor.commands.setContent(currentNote.content);
        }
        isLoadingRef.current = false;
        return;
      }
      // Just a save - update refs but don't reload content
      loadedModifiedRef.current = currentNote.modified;
      return;
    }

    // Handle note rename (ID changed but we were editing this note)
    // Check both: lastSave matches loaded note AND content matches (same note, just renamed)
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

    const isNewNote = loadedNoteIdRef.current === null;
    const wasEmpty = !isNewNote && currentNote.content?.trim() === "";
    const loadingNoteId = currentNote.id;

    loadedNoteIdRef.current = loadingNoteId;
    loadedModifiedRef.current = currentNote.modified;

    isLoadingRef.current = true;

    // Blur editor before setting content to prevent ghost cursor
    editor.commands.blur();

    // Parse markdown and set content
    const manager = editor.storage.markdown?.manager;
    if (manager) {
      try {
        const parsed = manager.parse(currentNote.content);
        editor.commands.setContent(parsed);
      } catch {
        // Fallback to plain text if parsing fails
        editor.commands.setContent(currentNote.content);
      }
    } else {
      editor.commands.setContent(currentNote.content);
    }

    // Scroll to top after content is set (must be after setContent to work reliably)
    scrollContainerRef.current?.scrollTo(0, 0);

    // Capture note ID to check in RAF callback - prevents race condition
    // if user switches notes quickly before RAF fires
    requestAnimationFrame(() => {
      // Bail if a different note started loading
      if (loadedNoteIdRef.current !== loadingNoteId) {
        return;
      }

      // Scroll again in RAF to ensure it takes effect after DOM updates
      scrollContainerRef.current?.scrollTo(0, 0);

      isLoadingRef.current = false;

      // For brand new empty notes, focus and select all so user can start typing
      if ((isNewNote || wasEmpty) && currentNote.content.trim() === "") {
        editor.commands.focus("start");
        editor.commands.selectAll();
      }
      // For existing notes, don't auto-focus - let user click where they want
    });
  }, [currentNote, editor, flushPendingSave, reloadVersion]);

  // Scroll to top on mount (e.g., when returning from settings)
  useEffect(() => {
    scrollContainerRef.current?.scrollTo(0, 0);
  }, []);

  // Cleanup on unmount - flush pending saves
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      // Flush any pending save before unmounting
      if (needsSaveRef.current && editorRef.current) {
        needsSaveRef.current = false;
        const manager = editorRef.current.storage.markdown?.manager;
        const markdown = manager
          ? manager.serialize(editorRef.current.getJSON())
          : editorRef.current.getText();
        // Fire and forget - save will complete in background
        saveNote(markdown);
      }
      if (linkPopupRef.current) {
        linkPopupRef.current.destroy();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run cleanup on unmount, not when saveNote changes

  // Link handlers - show inline popup at cursor position
  const handleAddLink = useCallback(() => {
    if (!editor) return;

    // Destroy existing popup if any
    if (linkPopupRef.current) {
      linkPopupRef.current.destroy();
      linkPopupRef.current = null;
    }

    // Get existing link URL if cursor is on a link
    const existingUrl = editor.getAttributes("link").href || "";

    // Get selection bounds for popup placement using DOM Range for accurate multi-line support
    const { from, to } = editor.state.selection;
    const hasSelection = from !== to;

    // Create a virtual element at the selection for tippy to anchor to
    const virtualElement = {
      getBoundingClientRect: () => {
        // For selections with text, use DOM Range for accurate bounds
        if (hasSelection) {
          const startPos = editor.view.domAtPos(from);
          const endPos = editor.view.domAtPos(to);

          if (startPos && endPos) {
            try {
              const range = document.createRange();
              range.setStart(startPos.node, startPos.offset);
              range.setEnd(endPos.node, endPos.offset);
              return range.getBoundingClientRect();
            } catch (e) {
              // Fallback if range creation fails
              console.error("Range creation failed:", e);
            }
          }
        }

        // For collapsed cursor, use coordsAtPos with proper viewport positioning
        const coords = editor.view.coordsAtPos(from);

        // Create a DOMRect-like object with proper positioning
        return {
          width: 2,
          height: 20,
          top: coords.top,
          left: coords.left,
          right: coords.right,
          bottom: coords.bottom,
          x: coords.left,
          y: coords.top,
          toJSON: () => ({}),
        } as DOMRect;
      },
    };

    // Create the link editor component
    const component = new ReactRenderer(LinkEditor, {
      props: {
        initialUrl: existingUrl,
        // Only show text input if there's no selection AND not editing an existing link
        initialText: hasSelection || existingUrl ? undefined : "",
        onSubmit: (url: string, text?: string) => {
          if (url.trim()) {
            if (text !== undefined) {
              // No selection case - insert new link with text
              if (text.trim()) {
                editor
                  .chain()
                  .focus()
                  .insertContent({
                    type: "text",
                    text: text.trim(),
                    marks: [{ type: "link", attrs: { href: url.trim() } }],
                  })
                  .run();
              }
            } else {
              // Has selection - apply link to selection
              editor
                .chain()
                .focus()
                .extendMarkRange("link")
                .setLink({ href: url.trim() })
                .run();
            }
          } else {
            editor.chain().focus().extendMarkRange("link").unsetLink().run();
          }
          linkPopupRef.current?.destroy();
          linkPopupRef.current = null;
        },
        onRemove: () => {
          editor.chain().focus().extendMarkRange("link").unsetLink().run();
          linkPopupRef.current?.destroy();
          linkPopupRef.current = null;
        },
        onCancel: () => {
          editor.commands.focus();
          linkPopupRef.current?.destroy();
          linkPopupRef.current = null;
        },
      },
      editor,
    });

    // Create tippy popup
    linkPopupRef.current = tippy(document.body, {
      getReferenceClientRect: () =>
        virtualElement.getBoundingClientRect() as DOMRect,
      appendTo: () => document.body,
      content: component.element,
      showOnCreate: true,
      interactive: true,
      trigger: "manual",
      placement: "bottom-start",
      offset: [0, 8],
      onDestroy: () => {
        component.destroy();
      },
    });
  }, [editor]);

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
        // Copy image to assets folder and get relative path (assets/filename.ext)
        const relativePath = await invoke<string>("copy_image_to_assets", {
          sourcePath: selected as string,
        });

        // Get notes folder and construct absolute path using Tauri's join
        const notesFolder = await invoke<string>("get_notes_folder");
        const absolutePath = await join(notesFolder, relativePath);

        // Convert to Tauri asset URL
        const assetUrl = convertFileSrc(absolutePath);

        // Insert image with asset URL
        editor.chain().focus().setImage({ src: assetUrl }).run();
      } catch (error) {
        console.error("Failed to add image:", error);
      }
    }
  }, [editor]);

  // Keyboard shortcuts for bold/italic (customizable).
  useEffect(() => {
    const boldShortcut = parseShortcut(shortcuts.bold);
    const italicShortcut = parseShortcut(shortcuts.italic);
    const defaultBoldShortcut = parseShortcut(DEFAULT_SHORTCUTS.bold);
    const defaultItalicShortcut = parseShortcut(DEFAULT_SHORTCUTS.italic);
    const boldChanged = shortcuts.bold !== DEFAULT_SHORTCUTS.bold;
    const italicChanged = shortcuts.italic !== DEFAULT_SHORTCUTS.italic;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInEditor = target.closest(".ProseMirror");
      if (!isInEditor || !editor) return;

      const matchesBold =
        boldShortcut && matchesParsedShortcut(e, boldShortcut);
      const matchesItalic =
        italicShortcut && matchesParsedShortcut(e, italicShortcut);

      if (matchesBold) {
        e.preventDefault();
        e.stopPropagation();
        editor.chain().focus().toggleBold().run();
        return;
      }

      if (matchesItalic) {
        e.preventDefault();
        e.stopPropagation();
        editor.chain().focus().toggleItalic().run();
        return;
      }

      // Block TipTap's built-in defaults when user has remapped these shortcuts.
      const pressedDefaultBold =
        defaultBoldShortcut && matchesParsedShortcut(e, defaultBoldShortcut);
      const pressedDefaultItalic =
        defaultItalicShortcut &&
        matchesParsedShortcut(e, defaultItalicShortcut);

      if ((boldChanged && pressedDefaultBold) || (italicChanged && pressedDefaultItalic)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [editor, shortcuts.bold, shortcuts.italic]);

  // Keyboard shortcut for add/edit link (only when editor is focused)
  useEffect(() => {
    const addOrEditLinkShortcut = parseShortcut(shortcuts.addOrEditLink);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        !addOrEditLinkShortcut ||
        !matchesParsedShortcut(e, addOrEditLinkShortcut)
      ) {
        return;
      }

      // Only handle if we're in the editor
      const target = e.target as HTMLElement;
      const isInEditor = target.closest(".ProseMirror");
      if (isInEditor && editor) {
        e.preventDefault();
        handleAddLink();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [editor, handleAddLink, shortcuts.addOrEditLink]);

  // Keyboard shortcut for copy-as menu
  useEffect(() => {
    const copyAsShortcut = parseShortcut(shortcuts.copyAs);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (copyAsShortcut && matchesParsedShortcut(e, copyAsShortcut)) {
        e.preventDefault();
        setCopyMenuOpen(true);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [shortcuts.copyAs]);

  // Shortcut to open in-note search (works when document/editor area is focused)
  useEffect(() => {
    const findInNoteShortcut = parseShortcut(shortcuts.findInNote);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!findInNoteShortcut || !matchesParsedShortcut(e, findInNoteShortcut)) {
        return;
      }

      if (!currentNote || !editor) return;

      const target = e.target as HTMLElement;
      const tagName = target.tagName.toLowerCase();

      // Don't intercept if user is in an input/textarea (except the editor itself)
      if (
        (tagName === "input" || tagName === "textarea") &&
        !target.closest(".ProseMirror")
      ) {
        return;
      }

      // Don't intercept if in sidebar
      if (target.closest('[class*="sidebar"]')) {
        return;
      }

      // Open search for the editor
      e.preventDefault();
      setSearchOpen(true);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [editor, currentNote, shortcuts.findInNote]);

  // Clear search on note switch
  useEffect(() => {
    if (currentNote?.id) {
      setSearchOpen(false);
      setSearchQuery("");
      setSearchMatches([]);
      setCurrentMatchIndex(0);
      // Clear decorations
      if (editor) {
        updateSearchDecorations([], 0, editor);
      }
    }
  }, [currentNote?.id, editor, updateSearchDecorations]);

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
      const plainText = editor.getText();
      await invoke("copy_to_clipboard", { text: plainText });
      toast.success("Copied as plain text");
    } catch (error) {
      console.error("Failed to copy plain text:", error);
      toast.error("Failed to copy");
    }
  }, [editor]);

  const handleCopyHtml = useCallback(async () => {
    if (!editor) return;
    try {
      const html = editor.getHTML();
      await invoke("copy_to_clipboard", { text: html });
      toast.success("Copied as HTML");
    } catch (error) {
      console.error("Failed to copy HTML:", error);
      toast.error("Failed to copy");
    }
  }, [editor]);

  const createNoteShortcutLabel = getShortcutDisplayText(shortcuts.createNote);
  const toggleSidebarShortcutLabel = getShortcutDisplayText(shortcuts.toggleSidebar);
  const reloadNoteShortcutLabel = getShortcutDisplayText(shortcuts.reloadCurrentNote);
  const boldShortcutLabel = getShortcutDisplayText(shortcuts.bold);
  const italicShortcutLabel = getShortcutDisplayText(shortcuts.italic);
  const findInNoteShortcutLabel = getShortcutDisplayText(shortcuts.findInNote);
  const copyAsShortcutLabel = getShortcutDisplayText(shortcuts.copyAs);
  const addOrEditLinkShortcutLabel = getShortcutDisplayText(shortcuts.addOrEditLink);

  if (!currentNote) {
    return (
      <div className="flex-1 flex flex-col bg-bg">
        {/* Drag region */}
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
            <h1 className="text-2xl text-text font-serif mb-1 tracking-[-0.01em] ">
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
              <span className="text-text-muted ml-1">{createNoteShortcutLabel}</span>
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
                  ? `Hide sidebar (${toggleSidebarShortcutLabel})`
                  : `Show sidebar (${toggleSidebarShortcutLabel})`
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
              content={`External changes detected (${reloadNoteShortcutLabel} to refresh)`}
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
          {currentNote && (
            <Tooltip content={isPinned ? "Unpin note" : "Pin note"}>
              <IconButton
                onClick={async () => {
                  if (!currentNote) return;
                  try {
                    if (isPinned) {
                      await unpinNote(currentNote.id);
                      toast.success("Note unpinned");
                    } else {
                      await pinNote(currentNote.id);
                      toast.success("Note pinned");
                    }
                    // Reload settings to update isPinned state
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
          )}
          {currentNote && (
            <Tooltip content={`Find in note (${findInNoteShortcutLabel})`}>
              <IconButton onClick={() => setSearchOpen(true)}>
                <SearchIcon className="w-4.25 h-4.25 stroke-[1.6]" />
              </IconButton>
            </Tooltip>
          )}
          <DropdownMenu.Root open={copyMenuOpen} onOpenChange={setCopyMenuOpen}>
            <Tooltip content={`Copy as... (${copyAsShortcutLabel})`}>
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
                onCloseAutoFocus={(e) => {
                  // Prevent focus returning to trigger button
                  e.preventDefault();
                }}
                onKeyDown={(e) => {
                  // Stop arrow keys from bubbling to note list navigation
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

      {/* Format Bar */}
      <FormatBar
        editor={editor}
        onAddLink={handleAddLink}
        onAddImage={handleAddImage}
        boldShortcutLabel={boldShortcutLabel}
        italicShortcutLabel={italicShortcutLabel}
        addLinkShortcutLabel={addOrEditLinkShortcutLabel}
      />

      {/* TipTap Editor */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden relative"
      >
        {searchOpen && (
          <div className="sticky top-2 z-10 animate-in fade-in slide-in-from-top-4 duration-200 pointer-events-none pr-2 flex justify-end">
            <div className="pointer-events-auto">
              <SearchToolbar
                query={searchQuery}
                onChange={handleSearchChange}
                onNext={goToNextMatch}
                onPrevious={goToPreviousMatch}
                onClose={() => {
                  setSearchOpen(false);
                  setSearchQuery("");
                  setSearchMatches([]);
                  setCurrentMatchIndex(0);
                  // Clear decorations and refocus editor
                  if (editor) {
                    updateSearchDecorations([], 0, editor);
                    editor.commands.focus();
                  }
                }}
                currentMatch={
                  searchMatches.length === 0 ? 0 : currentMatchIndex + 1
                }
                totalMatches={searchMatches.length}
              />
            </div>
          </div>
        )}
        <div
          className="h-full"
          onContextMenu={async (e) => {
            if (!editor?.isActive("table")) return;

            e.preventDefault();

            try {
              // Get the position at the click coordinates
              const clickPos = editor.view.posAtCoords({
                left: e.clientX,
                top: e.clientY,
              });

              if (!clickPos) return;

              // Set the selection to the clicked position
              editor.chain().focus().setTextSelection(clickPos.pos).run();

              // Now work with the updated selection
              const { state } = editor;
              const { selection } = state;
              const { $anchor } = selection;

              // Find the table cell/header node
              let cellDepth = $anchor.depth;
              while (
                cellDepth > 0 &&
                state.doc.resolve($anchor.pos).node(cellDepth).type.name !==
                  "tableCell" &&
                state.doc.resolve($anchor.pos).node(cellDepth).type.name !==
                  "tableHeader"
              ) {
                cellDepth--;
              }

              // Guard: if we didn't find a table cell, bail out
              if (cellDepth <= 0) return;

              const resolvedNode = state.doc.resolve($anchor.pos).node(cellDepth);
              if (
                resolvedNode.type.name !== "tableCell" &&
                resolvedNode.type.name !== "tableHeader"
              ) {
                return;
              }

              // Get the cell position
              const cellPos = $anchor.before(cellDepth);

              // Check if we're in the first column (index 0 in parent row)
              const rowNode = state.doc.resolve(cellPos).node(cellDepth - 1);
              let cellIndex = 0;
              rowNode.forEach((_node, offset) => {
                if (offset < cellPos - $anchor.before(cellDepth - 1) - 1) {
                  cellIndex++;
                }
              });
              const isFirstColumn = cellIndex === 0;

              // Check if we're in the first row (index 0 in parent table)
              const tableNode = state.doc.resolve(cellPos).node(cellDepth - 2);
              let rowIndex = 0;
              tableNode.forEach((_node, offset) => {
                if (
                  offset <
                  $anchor.before(cellDepth - 1) -
                    $anchor.before(cellDepth - 2) -
                    1
                ) {
                  rowIndex++;
                }
              });
              const isFirstRow = rowIndex === 0;

              const menuItems = [];

              // Only show "Add Column Before" if not in first column
              if (!isFirstColumn) {
                menuItems.push(
                  await MenuItem.new({
                    text: "Add Column Before",
                    action: () => editor.chain().focus().addColumnBefore().run(),
                  }),
                );
              }
              menuItems.push(
                await MenuItem.new({
                  text: "Add Column After",
                  action: () => editor.chain().focus().addColumnAfter().run(),
                }),
              );
              menuItems.push(
                await MenuItem.new({
                  text: "Delete Column",
                  action: () => editor.chain().focus().deleteColumn().run(),
                }),
              );
              menuItems.push(await PredefinedMenuItem.new({ item: "Separator" }));

              // Only show "Add Row Above" if not in first row
              if (!isFirstRow) {
                menuItems.push(
                  await MenuItem.new({
                    text: "Add Row Above",
                    action: () => editor.chain().focus().addRowBefore().run(),
                  }),
                );
              }
              menuItems.push(
                await MenuItem.new({
                  text: "Add Row Below",
                  action: () => editor.chain().focus().addRowAfter().run(),
                }),
              );
              menuItems.push(
                await MenuItem.new({
                  text: "Delete Row",
                  action: () => editor.chain().focus().deleteRow().run(),
                }),
              );
              menuItems.push(await PredefinedMenuItem.new({ item: "Separator" }));
              menuItems.push(
                await MenuItem.new({
                  text: "Toggle Header Row",
                  action: () => editor.chain().focus().toggleHeaderRow().run(),
                }),
              );
              menuItems.push(
                await MenuItem.new({
                  text: "Toggle Header Column",
                  action: () => editor.chain().focus().toggleHeaderColumn().run(),
                }),
              );
              menuItems.push(await PredefinedMenuItem.new({ item: "Separator" }));
              menuItems.push(
                await MenuItem.new({
                  text: "Delete Table",
                  action: () => editor.chain().focus().deleteTable().run(),
                }),
              );

              const menu = await Menu.new({ items: menuItems });

              await menu.popup();
            } catch (err) {
              console.error("Table context menu error:", err);
            }
          }}
        >
          <EditorContent editor={editor} className="h-full text-text" />
        </div>
      </div>
    </div>
  );
}
