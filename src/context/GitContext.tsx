import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
  isPulling: boolean;
  isAddingRemote: boolean;
  gitAvailable: boolean;
  lastError: string | null;

  // Actions
  refreshStatus: () => Promise<void>;
  initRepo: () => Promise<boolean>;
  commit: (message: string) => Promise<boolean>;
  push: () => Promise<boolean>;
  pull: () => Promise<boolean>;
  addRemote: (url: string) => Promise<boolean>;
  pushWithUpstream: () => Promise<boolean>;
  clearError: () => void;
}

const GitContext = createContext<GitContextValue | null>(null);

export function GitProvider({ children }: { children: ReactNode }) {
  const { notesFolder } = useNotesData();
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [isAddingRemote, setIsAddingRemote] = useState(false);
  const [gitAvailable, setGitAvailable] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // Use refs to avoid dependency cycles
  const hasLoadedRef = useRef(false);
  const refreshInFlightRef = useRef(false);

  const refreshStatus = useCallback(async () => {
    if (!notesFolder) return;

    // Prevent concurrent refreshes from piling up
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;

    // Only show loading spinner on the very first load
    const isInitialLoad = !hasLoadedRef.current;
    if (isInitialLoad) {
      setIsLoading(true);
    }

    try {
      const newStatus = await gitService.getGitStatus();
      hasLoadedRef.current = true;
      setStatus(newStatus);
      if (newStatus.error) {
        setLastError(newStatus.error);
      }
    } catch (err) {
      setLastError(err instanceof Error ? err.message : "Failed to get git status");
    } finally {
      refreshInFlightRef.current = false;
      if (isInitialLoad) {
        setIsLoading(false);
      }
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

  const pull = useCallback(async () => {
    setIsPulling(true);
    try {
      const result = await gitService.gitPull();
      if (result.error) {
        setLastError(result.error);
        return false;
      }
      await refreshStatus();
      return true;
    } catch (err) {
      setLastError(err instanceof Error ? err.message : "Failed to pull");
      return false;
    } finally {
      setIsPulling(false);
    }
  }, [refreshStatus]);

  const addRemote = useCallback(async (url: string) => {
    setIsAddingRemote(true);
    try {
      const result = await gitService.addRemote(url);
      if (result.error) {
        setLastError(result.error);
        return false;
      }
      await refreshStatus();
      return true;
    } catch (err) {
      setLastError(err instanceof Error ? err.message : "Failed to add remote");
      return false;
    } finally {
      setIsAddingRemote(false);
    }
  }, [refreshStatus]);

  const pushWithUpstream = useCallback(async () => {
    setIsPushing(true);
    try {
      const result = await gitService.pushWithUpstream();
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

  // Keep a stable ref so the file-change listener doesn't need to re-register
  const refreshStatusRef = useRef(refreshStatus);
  refreshStatusRef.current = refreshStatus;

  // Refresh status when folder changes
  useEffect(() => {
    if (notesFolder && gitAvailable) {
      refreshStatus();
    }
  }, [notesFolder, gitAvailable, refreshStatus]);

  // Poll remote for changes periodically (every 60s) when a remote is configured
  // Fetch is separated from status to keep status checks fast and offline-friendly
  useEffect(() => {
    if (!notesFolder || !gitAvailable || !status?.hasRemote) return;

    const interval = window.setInterval(async () => {
      await gitService.gitFetch().catch(() => {});
      refreshStatusRef.current();
    }, 60_000);

    return () => clearInterval(interval);
  }, [notesFolder, gitAvailable, status?.hasRemote]);

  // Refresh status on file changes (debounced via existing file watcher)
  // Uses a ref so the listener is registered only once
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let debounceTimer: number | undefined;

    listen("file-change", () => {
      // Debounce git status refresh to avoid excessive calls
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = window.setTimeout(() => {
        refreshStatusRef.current();
      }, 1000);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, []);

  const value = useMemo<GitContextValue>(
    () => ({
      status,
      isLoading,
      isCommitting,
      isPushing,
      isPulling,
      isAddingRemote,
      gitAvailable,
      lastError,
      refreshStatus,
      initRepo,
      commit,
      push,
      pull,
      addRemote,
      pushWithUpstream,
      clearError,
    }),
    [
      status,
      isLoading,
      isCommitting,
      isPushing,
      isPulling,
      isAddingRemote,
      gitAvailable,
      lastError,
      refreshStatus,
      initRepo,
      commit,
      push,
      pull,
      addRemote,
      pushWithUpstream,
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
