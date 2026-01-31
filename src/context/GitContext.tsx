import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";
import * as gitService from "../services/git";
import type { GitStatus } from "../services/git";
import { useNotesData } from "./NotesContext";

interface GitContextValue {
  // State
  status: GitStatus | null;
  isLoading: boolean;
  isCommitting: boolean;
  isPushing: boolean;
  gitAvailable: boolean;
  lastError: string | null;

  // Actions
  refreshStatus: () => Promise<void>;
  initRepo: () => Promise<boolean>;
  commit: (message: string) => Promise<boolean>;
  push: () => Promise<boolean>;
  clearError: () => void;
}

const GitContext = createContext<GitContextValue | null>(null);

export function GitProvider({ children }: { children: ReactNode }) {
  const { notesFolder } = useNotesData();
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [gitAvailable, setGitAvailable] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!notesFolder) return;

    setIsLoading(true);
    try {
      const newStatus = await gitService.getGitStatus();
      setStatus(newStatus);
      if (newStatus.error) {
        setLastError(newStatus.error);
      }
    } catch (err) {
      setLastError(err instanceof Error ? err.message : "Failed to get git status");
    } finally {
      setIsLoading(false);
    }
  }, [notesFolder]);

  const initRepo = useCallback(async () => {
    try {
      await gitService.initGitRepo();
      await refreshStatus();
      return true;
    } catch (err) {
      setLastError(err instanceof Error ? err.message : "Failed to initialize git");
      return false;
    }
  }, [refreshStatus]);

  const commit = useCallback(async (message: string) => {
    setIsCommitting(true);
    try {
      const result = await gitService.gitCommit(message);
      if (result.error) {
        setLastError(result.error);
        return false;
      }
      await refreshStatus();
      return true;
    } catch (err) {
      setLastError(err instanceof Error ? err.message : "Failed to commit");
      return false;
    } finally {
      setIsCommitting(false);
    }
  }, [refreshStatus]);

  const push = useCallback(async () => {
    setIsPushing(true);
    try {
      const result = await gitService.gitPush();
      if (result.error) {
        setLastError(result.error);
        return false;
      }
      await refreshStatus();
      return true;
    } catch (err) {
      setLastError(err instanceof Error ? err.message : "Failed to push");
      return false;
    } finally {
      setIsPushing(false);
    }
  }, [refreshStatus]);

  const clearError = useCallback(() => {
    setLastError(null);
  }, []);

  // Check git availability on mount
  useEffect(() => {
    gitService.isGitAvailable().then(setGitAvailable);
  }, []);

  // Refresh status when folder changes
  useEffect(() => {
    if (notesFolder && gitAvailable) {
      refreshStatus();
    }
  }, [notesFolder, gitAvailable, refreshStatus]);

  // Refresh status on file changes (debounced via existing file watcher)
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let debounceTimer: number | undefined;

    listen("file-change", () => {
      // Debounce git status refresh to avoid excessive calls
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = window.setTimeout(() => {
        refreshStatus();
      }, 1000);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [refreshStatus]);

  const value = useMemo<GitContextValue>(
    () => ({
      status,
      isLoading,
      isCommitting,
      isPushing,
      gitAvailable,
      lastError,
      refreshStatus,
      initRepo,
      commit,
      push,
      clearError,
    }),
    [
      status,
      isLoading,
      isCommitting,
      isPushing,
      gitAvailable,
      lastError,
      refreshStatus,
      initRepo,
      commit,
      push,
      clearError,
    ]
  );

  return <GitContext.Provider value={value}>{children}</GitContext.Provider>;
}

export function useGit() {
  const context = useContext(GitContext);
  if (!context) {
    throw new Error("useGit must be used within a GitProvider");
  }
  return context;
}
