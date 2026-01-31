import { useEffect, useRef, useCallback, useState, useMemo, memo } from "react";
import { useEditor, EditorContent, type Editor as TiptapEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Markdown } from "@tiptap/markdown";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useNotes } from "../../context/NotesContext";
import { Wikilink } from "./extensions/Wikilink";
import { ToolbarButton, Tooltip, Input } from "../ui";
import {
  FileTextIcon,
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
}

// Memoized FormatBar to prevent re-renders on every keystroke
const FormatBar = memo(function FormatBar({ editor, onAddLink, onAddImage }: FormatBarProps) {
  if (!editor) return null;

  return (
    <div className="mx-4 my-2 flex items-center gap-0.5 px-3 py-1.5 rounded-lg bg-stone-100 dark:bg-stone-900 overflow-x-auto">
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

      <div className="w-px h-5 bg-stone-300 dark:bg-stone-700 mx-1" />

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

      <div className="w-px h-5 bg-stone-300 dark:bg-stone-700 mx-1" />

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

      <div className="w-px h-5 bg-stone-300 dark:bg-stone-700 mx-1" />

      <ToolbarButton
        onClick={onAddLink}
        isActive={editor.isActive("link")}
        title="Add Link (⌘K)"
      >
        <LinkIcon />
      </ToolbarButton>
      <ToolbarButton
        onClick={onAddImage}
        isActive={false}
        title="Add Image"
      >
        <ImageIcon />
      </ToolbarButton>
    </div>
  );
});

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
    [selectNote]
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
    [noteTitleToId, selectNote, createNote]
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
    []
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
          await saveNote(newContent);
          setIsDirty(false);
        } finally {
          setIsSaving(false);
        }
      }, 1000);
    },
    [saveNote]
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
          class: "text-blue-500 underline cursor-pointer",
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

  // Load note content when the current note changes
  useEffect(() => {
    // Skip if no note or editor
    if (!currentNote || !editor) {
      return;
    }

    // Only load content when we have a NEW note to load
    // (i.e., currentNote.id differs from what's already loaded)
    if (currentNote.id === loadedNoteIdRef.current) {
      return;
    }

    const isNewNote = loadedNoteIdRef.current === null;
    const wasEmpty = loadedNoteIdRef.current !== null && currentNote.content?.trim() === "";
    loadedNoteIdRef.current = currentNote.id;

    isLoadingRef.current = true;

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

    requestAnimationFrame(() => {
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
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] }],
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

  if (!currentNote) {
    return (
      <div className="flex-1 flex flex-col bg-white dark:bg-stone-950">
        {/* Drag region */}
        <div className="h-10 shrink-0" data-tauri-drag-region />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-stone-400 dark:text-stone-600">
            <FileTextIcon className="w-16 h-16 mx-auto mb-4" />
            <p>Select a note or create a new one</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-white dark:bg-stone-950 overflow-hidden">
      {/* Drag region with date and save status */}
      <div
        className="h-10 shrink-0 flex items-end justify-between px-4 pb-1"
        data-tauri-drag-region
      >
        <span className="text-xs text-stone-400 dark:text-stone-500">
          {formatDateTime(currentNote.modified)}
        </span>
        <div className="titlebar-no-drag">
          {isSaving || isDirty ? (
            <Tooltip content={isSaving ? "Saving..." : "Unsaved changes"}>
              <SpinnerIcon className="w-3.5 h-3.5 text-stone-400 animate-spin" />
            </Tooltip>
          ) : (
            <Tooltip content="All changes saved">
              <CheckIcon className="w-3.5 h-3.5 text-stone-400" />
            </Tooltip>
          )}
        </div>
      </div>

      {/* Format Bar */}
      <FormatBar editor={editor} onAddLink={handleAddLink} onAddImage={handleAddImage} />

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
          <ToolbarButton onClick={handleLinkSubmit} isActive={false} title="Apply link">
            <CheckIcon />
          </ToolbarButton>
        </div>
      )}

      {/* TipTap Editor */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto overflow-x-hidden">
        <EditorContent
          editor={editor}
          className="h-full text-stone-900 dark:text-stone-100"
        />
      </div>
    </div>
  );
}
