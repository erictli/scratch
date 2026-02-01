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
import { Markdown } from "@tiptap/markdown";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useNotes } from "../../context/NotesContext";
import { LinkEditor } from "./LinkEditor";
import { Button, IconButton, ToolbarButton, Tooltip } from "../ui";
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
  MinusIcon,
  LinkIcon,
  ImageIcon,
  SpinnerIcon,
  CheckIcon,
  CopyIcon,
  ChevronDownIcon,
  PanelLeftIcon,
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

// FormatBar must re-render with parent to reflect editor.isActive() state changes
// (editor instance is mutable, so memo would cause stale active states)
function FormatBar({
  editor,
  onAddLink,
  onAddImage,
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
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
        isActive={editor.isActive("heading", { level: 4 })}
        title="Heading 4"
      >
        <Heading4Icon />
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
    </div>
  );
}

interface EditorProps {
  onToggleSidebar?: () => void;
  sidebarVisible?: boolean;
}

export function Editor({ onToggleSidebar, sidebarVisible }: EditorProps) {
  const { currentNote, saveNote, createNote } = useNotes();
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const saveTimeoutRef = useRef<number | null>(null);
  const linkPopupRef = useRef<TippyInstance | null>(null);
  const isLoadingRef = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<TiptapEditor | null>(null);
  const currentNoteIdRef = useRef<string | null>(null);

  // Keep ref in sync with current note ID
  currentNoteIdRef.current = currentNote?.id ?? null;

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

      // Capture the note ID now (before the timeout)
      const savingNoteId = currentNote?.id;

      saveTimeoutRef.current = window.setTimeout(async () => {
        // Guard: only save if still on the same note
        if (savingNoteId && currentNoteIdRef.current !== savingNoteId) {
          return;
        }

        setIsSaving(true);
        try {
          // Track what we're saving to distinguish from external changes
          if (savingNoteId) {
            lastSaveRef.current = { noteId: savingNoteId, content: newContent };
          }
          await saveNote(newContent);
          setIsDirty(false);
        } finally {
          setIsSaving(false);
        }
      }, 1000);
    },
    [saveNote, currentNote?.id],
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
    ],
    editorProps: {
      attributes: {
        class:
          "prose prose-lg dark:prose-invert max-w-3xl mx-auto focus:outline-none min-h-full px-8 pt-12 pb-32",
      },
      // Handle cmd/ctrl+click to open links
      handleClick: (_view, _pos, event) => {
        // Only handle cmd/ctrl+click
        if (!event.metaKey && !event.ctrlKey) return false;

        const target = event.target as HTMLElement;
        const link = target.closest("a");
        if (link) {
          const href = link.getAttribute("href");
          if (href) {
            event.preventDefault();
            window.open(href, "_blank", "noopener,noreferrer");
            return true;
          }
        }
        return false;
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
  // Track the last save (note ID and content) to detect our own saves vs external changes
  const lastSaveRef = useRef<{ noteId: string; content: string } | null>(null);

  // Load note content when the current note changes
  useEffect(() => {
    // Skip if no note or editor
    if (!currentNote || !editor) {
      return;
    }

    const isSameNote = currentNote.id === loadedNoteIdRef.current;
    const lastSave = lastSaveRef.current;
    // Check if this update is from our own save (same note we saved, content matches)
    const isOurSave = lastSave &&
      (lastSave.noteId === currentNote.id || lastSave.noteId === loadedNoteIdRef.current) &&
      lastSave.content === currentNote.content;
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
    // This happens when the title changes and the file gets renamed
    if (isOurSave && !isSameNote && lastSave?.noteId === loadedNoteIdRef.current) {
      loadedNoteIdRef.current = currentNote.id;
      loadedModifiedRef.current = currentNote.modified;
      lastSaveRef.current = null; // Clear after handling rename
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      if (linkPopupRef.current) {
        linkPopupRef.current.destroy();
      }
    };
  }, []);

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

    // Create a virtual element at the selection for tippy to anchor to
    const virtualElement = {
      getBoundingClientRect: () => {
        // Try to get accurate bounds using DOM Range
        const startPos = editor.view.domAtPos(from);
        const endPos = editor.view.domAtPos(to);

        if (startPos && endPos) {
          const range = document.createRange();
          range.setStart(startPos.node, startPos.offset);
          range.setEnd(endPos.node, endPos.offset);
          return range.getBoundingClientRect();
        }

        // Fallback to coordsAtPos for collapsed selections
        const coords = editor.view.coordsAtPos(from);
        return {
          width: 0,
          height: coords.bottom - coords.top,
          top: coords.top,
          left: coords.left,
          right: coords.left,
          bottom: coords.bottom,
          x: coords.left,
          y: coords.top,
        };
      },
    };

    // Create the link editor component
    const component = new ReactRenderer(LinkEditor, {
      props: {
        initialUrl: existingUrl,
        onSubmit: (url: string) => {
          if (url.trim()) {
            editor
              .chain()
              .focus()
              .extendMarkRange("link")
              .setLink({ href: url.trim() })
              .run();
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
      getReferenceClientRect: () => virtualElement.getBoundingClientRect() as DOMRect,
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

  if (!currentNote) {
    return (
      <div className="flex-1 flex flex-col bg-bg">
        {/* Drag region */}
        <div className="h-10 shrink-0 flex items-end px-4 pb-1" data-tauri-drag-region>
          {onToggleSidebar && (
            <IconButton
              onClick={onToggleSidebar}
              title={sidebarVisible ? "Hide sidebar (⌘\\)" : "Show sidebar (⌘\\)"}
              className="titlebar-no-drag"
            >
              <PanelLeftIcon className="w-4 h-4" />
            </IconButton>
          )}
        </div>
        <div className="flex-1 flex items-center justify-center pb-6">
          <div className="text-center text-text-muted">
            <img
              src="/note-dark.png"
              alt="Note"
              className="w-48 h-auto mx-auto mb-2 invert dark:invert-0"
            />
            <h1
            className="text-2xl text-text font-serif mb-1 tracking-[-0.01em] "
          >
            A blank page awaits
          </h1>
            <p>Pick up where you left off, or start something new</p>
            <Button
              onClick={createNote}
              variant="secondary"
              size="sm"
              className="mt-4"
            >
              New Note <span className="text-text-muted ml-1">⌘N</span>
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
        className="h-10 shrink-0 flex items-end justify-between px-4 pb-1"
        data-tauri-drag-region
      >
        <div className="titlebar-no-drag flex items-center gap-3">
          {onToggleSidebar && (
            <IconButton
              onClick={onToggleSidebar}
              title={sidebarVisible ? "Hide sidebar (⌘\\)" : "Show sidebar (⌘\\)"}
            >
              <PanelLeftIcon className="w-4 h-4" />
            </IconButton>
          )}
          <span className="text-xs text-text-muted">
            {formatDateTime(currentNote.modified)}
          </span>
        </div>
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
      />

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
