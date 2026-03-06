import { useCallback, useEffect, useRef, useState } from "react";
import { useNotesActions, useNotesData } from "../../context/NotesContext";
import { NoteList } from "../notes/NoteList";
import { Footer } from "./Footer";
import { IconButton, Input } from "../ui";
import {
  PlusIcon,
  XIcon,
  SearchIcon,
  SearchOffIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "../icons";
import { mod, shift, isMac } from "../../lib/platform";

interface SidebarProps {
  onOpenSettings?: () => void;
  openSearchSignal?: number;
  focusNoteListSignal?: number;
  toggleAllFoldersSignal?: number;
  onToggleAllFolders?: () => void;
}

export function Sidebar({
  onOpenSettings,
  openSearchSignal = 0,
  focusNoteListSignal = 0,
  toggleAllFoldersSignal = 0,
  onToggleAllFolders,
}: SidebarProps) {
  const { notes, searchQuery } = useNotesData();
  const { createNote, search, clearSearch } = useNotesActions();
  const [searchOpen, setSearchOpen] = useState(false);
  const [allFoldersExpanded, setAllFoldersExpanded] = useState(false);
  const [inputValue, setInputValue] = useState(searchQuery);
  const debounceRef = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Sync input with search query
  useEffect(() => {
    setInputValue(searchQuery);
  }, [searchQuery]);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setInputValue(value);

      // Debounce search
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = window.setTimeout(() => {
        search(value);
      }, 220);
    },
    [search]
  );

  const toggleSearch = useCallback(() => {
    setSearchOpen((prev) => !prev);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setInputValue("");
    clearSearch();
  }, [clearSearch]);

  // Auto-focus search input when opened
  useEffect(() => {
    if (searchOpen) {
      // Small delay to ensure the input is rendered
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    }
  }, [searchOpen]);

  useEffect(() => {
    if (openSearchSignal === 0) return;
    setSearchOpen(true);
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
  }, [openSearchSignal]);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (inputValue) {
          // First escape: clear search
          setInputValue("");
          clearSearch();
        } else {
          // Second escape: close search
          closeSearch();
        }
      }
    },
    [inputValue, clearSearch, closeSearch]
  );

  const handleClearSearch = useCallback(() => {
    setInputValue("");
    clearSearch();
  }, [clearSearch]);

  return (
    <div className="w-64 h-full bg-bg-secondary border-r border-border flex flex-col select-none">
      {/* Drag region */}
      <div className="h-11 shrink-0" data-tauri-drag-region></div>
      <div className="flex items-center justify-between pl-4 pr-3 pb-2 border-b border-border shrink-0">
        <div className="flex items-center gap-1">
          <div className="font-medium text-base">Notes</div>
          <div className="text-text-muted font-medium text-2xs min-w-4.75 h-4.75 flex items-center justify-center px-1 bg-bg-muted rounded-sm mt-0.5 pt-px">
            {notes.length}
          </div>
        </div>
        <div className="flex items-center gap-px">
          <IconButton
            onClick={onToggleAllFolders}
            title="Toggle Folder Tree"
          >
            <div className="flex flex-col leading-none -space-y-1">
              {allFoldersExpanded ? (
                <>
                  <ChevronDownIcon className="w-3.5 h-3.5 stroke-[2]" />
                  <ChevronUpIcon className="w-3.5 h-3.5 stroke-[1.6] text-text-muted" />
                </>
              ) : (
                <>
                  <ChevronUpIcon className="w-3.5 h-3.5 stroke-[2]" />
                  <ChevronDownIcon className="w-3.5 h-3.5 stroke-[1.6] text-text-muted" />
                </>
              )}
            </div>
          </IconButton>
          <IconButton
            onClick={toggleSearch}
            title={`Search Notes (${mod}${isMac ? "" : "+"}${shift}${isMac ? "" : "+"}F)`}
          >
            {searchOpen ? (
              <SearchOffIcon className="w-4.25 h-4.25 stroke-[1.5]" />
            ) : (
              <SearchIcon className="w-4.25 h-4.25 stroke-[1.5]" />
            )}
          </IconButton>
          <IconButton
            variant="ghost"
            onClick={createNote}
            title={`New Note (${mod}${isMac ? "" : "+"}N)`}
          >
            <PlusIcon className="w-5.25 h-5.25 stroke-[1.4]" />
          </IconButton>
        </div>
      </div>
      {/* Scrollable area with search and notes */}
      <div className="flex-1 overflow-y-auto">
        {/* Search - sticky at top */}
        {searchOpen && (
          <div className="sticky top-0 z-10 px-2 pt-2 bg-bg-secondary">
            <div className="relative">
              <Input
                ref={searchInputRef}
                type="text"
                value={inputValue}
                onChange={handleSearchChange}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search notes..."
                className="h-9 pr-8 text-sm"
              />
              {inputValue && (
                <button
                  onClick={handleClearSearch}
                  tabIndex={-1}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text"
                >
                  <XIcon className="w-4.5 h-4.5 stroke-[1.5]" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Note list */}
        <NoteList
          focusSignal={focusNoteListSignal}
          toggleAllFoldersSignal={toggleAllFoldersSignal}
          onFolderTreeStateChange={setAllFoldersExpanded}
        />
      </div>

      {/* Footer with git status, commit, and settings */}
      <Footer onOpenSettings={onOpenSettings} />
    </div>
  );
}
