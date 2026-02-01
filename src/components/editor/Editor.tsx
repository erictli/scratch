import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import {
  useEditor,
  EditorContent,
  type Editor as TiptapEditor,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Markdown } from "@tiptap/markdown";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useNotes } from "../../context/NotesContext";
import { Wikilink } from "./extensions/Wikilink";
import { createWikilinkSuggestion } from "./extensions/wikilinkSuggestion";
import { ToolbarButton, Tooltip, Input } from "../ui";
import {
  BoldIcon,
  ItalicIcon,
  StrikethroughIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ListIcon,
  ListOrderedIcon,
  CheckSquareIcon,
  QuoteIcon,
  CodeIcon,
  InlineCodeIcon,
  MinusIcon,
  LinkIcon,
  ImageIcon,
  SpinnerIcon,
  CheckIcon,
  CopyIcon,
  ChevronDownIcon,
  WikilinkIcon,
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

interface FormatBarProps {
  editor: TiptapEditor | null;
  onAddLink: () => void;
  onAddImage: () => void;
  onAddWikilink: () => void;
}

// FormatBar must re-render with parent to reflect editor.isActive() state changes
// (editor instance is mutable, so memo would cause stale active states)
function FormatBar({
  editor,
  onAddLink,
  onAddImage,
  onAddWikilink,
}: FormatBarProps) {
  if (!editor) return null;

  return (
    <div className="mx-4 my-2 flex items-center gap-0.5 px-3 py-1.5 rounded-lg bg-bg-muted overflow-x-auto">
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive("bold")}
        title="Bold (⌘B)"
      >
        <BoldIcon />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive("italic")}
        title="Italic (⌘I)"
      >
        <ItalicIcon />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        isActive={editor.isActive("strike")}
        title="Strikethrough"
      >
        <StrikethroughIcon />
      </ToolbarButton>

      <div className="w-px h-5 bg-bg-emphasis mx-1" />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        isActive={editor.isActive("heading", { level: 1 })}
        title="Heading 1"
      >
        <Heading1Icon />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        isActive={editor.isActive("heading", { level: 2 })}
        title="Heading 2"
      >
        <Heading2Icon />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        isActive={editor.isActive("heading", { level: 3 })}
        title="Heading 3"
      >
        <Heading3Icon />
      </ToolbarButton>

      <div className="w-px h-5 bg-bg-emphasis mx-1" />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        isActive={editor.isActive("bulletList")}
        title="Bullet List"
      >
        <ListIcon />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        isActive={editor.isActive("orderedList")}
        title="Numbered List"
      >
        <ListOrderedIcon />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        isActive={editor.isActive("taskList")}
        title="Task List"
      >
        <CheckSquareIcon />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        isActive={editor.isActive("blockquote")}
        title="Blockquote"
      >
        <QuoteIcon />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCode().run()}
        isActive={editor.isActive("code")}
        title="Inline Code"
      >
        <InlineCodeIcon />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        isActive={editor.isActive("codeBlock")}
        title="Code Block"
      >
        <CodeIcon />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        isActive={false}
        title="Horizontal Rule"
      >
        <MinusIcon />
      </ToolbarButton>

      <div className="w-px h-5 bg-bg-emphasis mx-1" />

      <ToolbarButton
        onClick={onAddLink}
        isActive={editor.isActive("link")}
        title="Add Link (⌘K)"
      >
        <LinkIcon />
      </ToolbarButton>
      <ToolbarButton onClick={onAddImage} isActive={false} title="Add Image">
        <ImageIcon />
      </ToolbarButton>
      <ToolbarButton
        onClick={onAddWikilink}
        isActive={false}
        title="Add Wikilink"
      >
        <WikilinkIcon />
      </ToolbarButton>
    </div>
  );
}

export function Editor() {
  const { currentNote, saveNote, selectNote, createNote, notes } =
    useNotes();
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const linkInputRef = useRef<HTMLInputElement>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const isLoadingRef = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef(notes);
  const editorRef = useRef<TiptapEditor | null>(null);

  // Keep notesRef updated with latest notes
  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  // Create wikilink suggestion config that reads from ref (stable function)
  const wikilinkSuggestion = useMemo(
    () =>
      createWikilinkSuggestion({
        getNotes: () => notesRef.current,
      }),
    [],
  );

  // Build a map of note titles to IDs for wikilink navigation
  const noteTitleToId = useMemo(() => {
    const map: Record<string, string> = {};
    for (const note of notes) {
      const titleLower = note.title.toLowerCase();
      map[titleLower] = note.id;
    }
    return map;
  }, [notes]);

  // Handle wikilink navigation
  const handleWikilinkNavigate = useCallback(
    (noteId: string) => {
      selectNote(noteId);
    },
    [selectNote],
  );

  // Handle wikilink creation
  const handleWikilinkCreate = useCallback(
    async (title: string) => {
      // Check if note with this title exists
      const titleLower = title.toLowerCase();
      const existingId = noteTitleToId[titleLower];
      if (existingId) {
        selectNote(existingId);
      } else {
        // Create new note
        await createNote();
      }
    },
    [noteTitleToId, selectNote, createNote],
  );

  // Get markdown from editor
  const getMarkdown = useCallback(
    (editorInstance: ReturnType<typeof useEditor>) => {
      if (!editorInstance) return "";
      const manager = editorInstance.storage.markdown?.manager;
      if (manager) {
        return manager.serialize(editorInstance.getJSON());
      }
      // Fallback to plain text
      return editorInstance.getText();
    },
    [],
  );

  // Auto-save with debounce
  const debouncedSave = useCallback(
    async (newContent: string) => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = window.setTimeout(async () => {
        setIsSaving(true);
        try {
          // Track what we're saving to distinguish from external changes
          lastSavedContentRef.current = newContent;
          await saveNote(newContent);
          setIsDirty(false);
        } finally {
          setIsSaving(false);
        }
      }, 1000);
    },
    [saveNote],
  );

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
        inline: true,
        allowBase64: false,
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Markdown.configure({}),
      Wikilink.configure({
        onNavigate: handleWikilinkNavigate,
        onCreate: handleWikilinkCreate,
        suggestion: wikilinkSuggestion,
      }),
    ],
    editorProps: {
      attributes: {
        class:
          "prose prose-lg dark:prose-invert max-w-none focus:outline-none min-h-full px-8 pt-4 pb-32",
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
      // Handle markdown paste
      handlePaste: (_view, event) => {
        const text = event.clipboardData?.getData("text/plain");
        if (!text) return false;

        // Check if text looks like markdown (has common markdown patterns)
        const markdownPatterns = /^#{1,6}\s|^\s*[-*+]\s|^\s*\d+\.\s|^\s*>\s|```|^\s*\[.*\]\(.*\)|^\s*!\[|\*\*.*\*\*|__.*__|~~.*~~|^\s*[-*_]{3,}\s*$/m;
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
    onUpdate: ({ editor: editorInstance }) => {
      if (isLoadingRef.current) return;
      setIsDirty(true);
      const markdown = getMarkdown(editorInstance);
      debouncedSave(markdown);
    },
    // Prevent flash of unstyled content during initial render
    immediatelyRender: false,
  });

  // Track which note's content is currently loaded in the editor
  const loadedNoteIdRef = useRef<string | null>(null);
  // Track the modified timestamp of the loaded content
  const loadedModifiedRef = useRef<number | null>(null);
  // Track content we last saved (to detect external vs our own changes)
  const lastSavedContentRef = useRef<string | null>(null);

  // Load note content when the current note changes
  useEffect(() => {
    // Skip if no note or editor
    if (!currentNote || !editor) {
      return;
    }

    const isSameNote = currentNote.id === loadedNoteIdRef.current;
    const isOurSave = currentNote.content === lastSavedContentRef.current;
    const isExternalChange = isSameNote &&
      currentNote.modified !== loadedModifiedRef.current &&
      !isOurSave;

    // Skip if same note and not an external change
    if (isSameNote && !isExternalChange) {
      // Still update the modified ref if it changed (our own save)
      loadedModifiedRef.current = currentNote.modified;
      return;
    }

    // If it's our own save with a rename (ID changed but content matches), just update refs
    if (isOurSave && !isSameNote) {
      loadedNoteIdRef.current = currentNote.id;
      loadedModifiedRef.current = currentNote.modified;
      return;
    }

    const isNewNote = loadedNoteIdRef.current === null;
    const wasEmpty = !isNewNote && !isExternalChange && currentNote.content?.trim() === "";
    const loadingNoteId = currentNote.id;

    loadedNoteIdRef.current = loadingNoteId;
    loadedModifiedRef.current = currentNote.modified;

    isLoadingRef.current = true;

    // For external changes, just update content without scrolling/blurring
    if (isExternalChange) {
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
      setIsDirty(false);
      isLoadingRef.current = false;
      return;
    }

    // Scroll to top when switching notes
    scrollContainerRef.current?.scrollTo(0, 0);

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

    setIsDirty(false);

    // Capture note ID to check in RAF callback - prevents race condition
    // if user switches notes quickly before RAF fires
    requestAnimationFrame(() => {
      // Bail if a different note started loading
      if (loadedNoteIdRef.current !== loadingNoteId) {
        return;
      }

      isLoadingRef.current = false;

      // For brand new empty notes, focus and select all so user can start typing
      if ((isNewNote || wasEmpty) && currentNote.content.trim() === "") {
        editor.commands.focus("start");
        editor.commands.selectAll();
      }
      // For existing notes, don't auto-focus - let user click where they want
    });
  }, [currentNote, editor]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Link handlers
  const handleAddLink = useCallback(() => {
    if (!editor) return;
    // Get existing link URL if cursor is on a link
    const existingUrl = editor.getAttributes("link").href || "";
    setLinkUrl(existingUrl);
    setShowLinkInput(true);
    requestAnimationFrame(() => linkInputRef.current?.focus());
  }, [editor]);

  const handleLinkSubmit = useCallback(() => {
    if (!editor) return;
    if (linkUrl.trim()) {
      editor.chain().focus().setLink({ href: linkUrl.trim() }).run();
    } else {
      editor.chain().focus().unsetLink().run();
    }
    setShowLinkInput(false);
    setLinkUrl("");
  }, [editor, linkUrl]);

  const handleLinkCancel = useCallback(() => {
    setShowLinkInput(false);
    setLinkUrl("");
    editor?.commands.focus();
  }, [editor]);

  // Image handler
  const handleAddImage = useCallback(async () => {
    if (!editor) return;
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"],
        },
      ],
    });
    if (selected) {
      const src = convertFileSrc(selected as string);
      editor.chain().focus().setImage({ src }).run();
    }
  }, [editor]);

  // Keyboard shortcut for Cmd+K to add link
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        handleAddLink();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleAddLink]);

  // Copy handlers
  const handleCopyMarkdown = useCallback(async () => {
    if (!editor) return;
    try {
      const markdown = getMarkdown(editor);
      await invoke("copy_to_clipboard", { text: markdown });
    } catch (error) {
      console.error("Failed to copy markdown:", error);
    }
  }, [editor, getMarkdown]);

  const handleCopyPlainText = useCallback(async () => {
    if (!editor) return;
    try {
      const plainText = editor.getText();
      await invoke("copy_to_clipboard", { text: plainText });
    } catch (error) {
      console.error("Failed to copy plain text:", error);
    }
  }, [editor]);

  const handleCopyHtml = useCallback(async () => {
    if (!editor) return;
    try {
      const html = editor.getHTML();
      await invoke("copy_to_clipboard", { text: html });
    } catch (error) {
      console.error("Failed to copy HTML:", error);
    }
  }, [editor]);

  // Wikilink handler - insert [[ to trigger suggestion
  const handleAddWikilink = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().insertContent("[[").run();
  }, [editor]);

  if (!currentNote) {
    return (
      <div className="flex-1 flex flex-col bg-bg">
        {/* Drag region */}
        <div className="h-10 shrink-0" data-tauri-drag-region />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-text-muted">
            <img
              src="/note-dark.png"
              alt="Note"
              className="w-36 h-auto mx-auto mb-4 invert dark:invert-0"
            />
            <p>Select a note or create a new one</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-bg overflow-hidden">
      {/* Drag region with date and save status */}
      <div
        className="h-10 shrink-0 flex items-end justify-between px-4 pb-1"
        data-tauri-drag-region
      >
        <span className="text-xs text-text-muted">
          {formatDateTime(currentNote.modified)}
        </span>
        <div className="titlebar-no-drag flex items-center gap-2">
          <DropdownMenu.Root>
            <Tooltip content="Copy as...">
              <DropdownMenu.Trigger asChild>
                <button className="flex items-center gap-0.5 text-text-muted hover:text-text transition-colors">
                  <CopyIcon className="w-3.5 h-3.5" />
                  <ChevronDownIcon className="w-3 h-3" />
                </button>
              </DropdownMenu.Trigger>
            </Tooltip>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="min-w-[140px] bg-bg border border-border rounded-md shadow-lg py-1 z-50"
                sideOffset={5}
                align="end"
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
          {isSaving || isDirty ? (
            <Tooltip content={isSaving ? "Saving..." : "Unsaved changes"}>
              <SpinnerIcon className="w-3.5 h-3.5 text-text-muted animate-spin" />
            </Tooltip>
          ) : (
            <Tooltip content="All changes saved">
              <CheckIcon className="w-3.5 h-3.5 text-text-muted" />
            </Tooltip>
          )}
        </div>
      </div>

      {/* Format Bar */}
      <FormatBar
        editor={editor}
        onAddLink={handleAddLink}
        onAddImage={handleAddImage}
        onAddWikilink={handleAddWikilink}
      />

      {/* Link Input */}
      {showLinkInput && (
        <div className="mx-4 mb-2 flex items-center gap-2">
          <Input
            ref={linkInputRef}
            type="url"
            placeholder="Enter URL..."
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleLinkSubmit();
              } else if (e.key === "Escape") {
                handleLinkCancel();
              }
            }}
            className="flex-1"
          />
          <ToolbarButton
            onClick={handleLinkSubmit}
            isActive={false}
            title="Apply link"
          >
            <CheckIcon />
          </ToolbarButton>
        </div>
      )}

      {/* TipTap Editor */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden"
      >
        <EditorContent editor={editor} className="h-full text-text" />
      </div>
    </div>
  );
}
