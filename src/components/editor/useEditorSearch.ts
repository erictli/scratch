import { useEffect, useRef, useCallback, useState } from "react";
import { type Editor as TiptapEditor } from "@tiptap/react";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { searchHighlightPluginKey } from "./SearchHighlightExtension";

interface UseEditorSearchOptions {
  editor: TiptapEditor | null;
  currentNoteId: string | undefined;
}

interface UseEditorSearchReturn {
  searchOpen: boolean;
  searchQuery: string;
  searchMatches: Array<{ from: number; to: number }>;
  currentMatchIndex: number;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  handleSearchChange: (query: string) => void;
  goToNextMatch: () => void;
  goToPreviousMatch: () => void;
  openEditorSearch: () => void;
  closeSearch: () => void;
}

export function useEditorSearch({
  editor,
  currentNoteId,
}: UseEditorSearchOptions): UseEditorSearchReturn {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatches, setSearchMatches] = useState<
    Array<{ from: number; to: number }>
  >([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Find all matches for search query (case-insensitive)
  const findMatches = useCallback(
    (query: string, editorInstance: TiptapEditor | null) => {
      if (!editorInstance || !query.trim()) return [];

      const doc = editorInstance.state.doc;
      const lowerQuery = query.toLowerCase();
      const matches: Array<{ from: number; to: number }> = [];

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

        matches.forEach((match, index) => {
          const isActive = index === currentIndex;
          decorations.push(
            Decoration.inline(match.from, match.to, {
              class: isActive
                ? "bg-yellow-300/50 dark:bg-yellow-400/40"
                : "bg-yellow-300/25 dark:bg-yellow-400/20",
            }),
          );
        });

        const decorationSet = DecorationSet.create(state.doc, decorations);

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

  // Search navigation
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

  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  // Debounced search effect
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchMatches([]);
      setCurrentMatchIndex(0);
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
      updateSearchDecorations(matches, 0, editor);
    }, 150);

    return () => clearTimeout(timer);
  }, [searchQuery, editor, findMatches, updateSearchDecorations]);

  // Open and focus editor search
  const openEditorSearch = useCallback(() => {
    setSearchOpen(true);
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
  }, []);

  // Close search and clear decorations
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchMatches([]);
    setCurrentMatchIndex(0);
    if (editor) {
      updateSearchDecorations([], 0, editor);
      editor.commands.focus();
    }
  }, [editor, updateSearchDecorations]);

  // Cmd+F to open search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        e.key.toLowerCase() === "f"
      ) {
        if (!currentNoteId || !editor) return;

        const target = e.target as HTMLElement;
        const tagName = target.tagName.toLowerCase();

        if (
          (tagName === "input" || tagName === "textarea") &&
          !target.closest(".ProseMirror")
        ) {
          return;
        }

        if (target.closest('[class*="sidebar"]')) {
          return;
        }

        e.preventDefault();
        openEditorSearch();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [editor, currentNoteId, openEditorSearch]);

  // Clear search on note switch
  useEffect(() => {
    if (currentNoteId) {
      setSearchOpen(false);
      setSearchQuery("");
      setSearchMatches([]);
      setCurrentMatchIndex(0);
      if (editor) {
        updateSearchDecorations([], 0, editor);
      }
    }
  }, [currentNoteId, editor, updateSearchDecorations]);

  return {
    searchOpen,
    searchQuery,
    searchMatches,
    currentMatchIndex,
    searchInputRef,
    handleSearchChange,
    goToNextMatch,
    goToPreviousMatch,
    openEditorSearch,
    closeSearch,
  };
}
