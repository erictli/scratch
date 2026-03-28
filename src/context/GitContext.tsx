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
import * as notesService from "../services/notes";
import type { GitStatus } from "../services/git";
import { useNotesData } from "./NotesContext";

interface GitContextValue {
  // State
  status: GitStatus | null;
  isLoading: boolean;
  isCommitting: boolean;
  isPushing: boolean;
  isPulling: boolean;
  isSyncing: boolean;
  isAddingRemote: boolean;
  gitAvailable: boolean;
  gitEnabled: boolean;
  isUpdatingGitEnabled: boolean;
  lastError: string | null;

  // Actions
  setGitEnabled: (enabled: boolean) => Promise<boolean>;
  refreshStatus: () => Promise<void>;
  initRepo: () => Promise<boolean>;
  commit: (message: string) => Promise<boolean>;
  push: () => Promise<boolean>;
  pull: () => Promise<string | false>;
  sync: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>;
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
  const [isSyncing, setIsSyncing] = useState(false);
  const [isAddingRemote, setIsAddingRemote] = useState(false);
  const [gitAvailable, setGitAvailable] = useState(false);
  const [gitEnabled, setGitEnabledState] = useState(false);
  const [isUpdatingGitEnabled, setIsUpdatingGitEnabled] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // Use refs to avoid dependency cycles
  const hasLoadedRef = useRef(false);
  const refreshInFlightRef = useRef(false);
  const refreshRequestIdRef = useRef(0);
  const settingsReadRequestIdRef = useRef(0);
  const gitToggleRequestIdRef = useRef(0);
  const notesFolderRef = useRef(notesFolder);
  notesFolderRef.current = notesFolder;
  const gitEnabledRef = useRef(gitEnabled);
  gitEnabledRef.current = gitEnabled;

  const refreshStatus = useCallback(async () => {
    if (!notesFolder || !gitEnabled) return;

    // Prevent concurrent refreshes from piling up
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    const requestId = ++refreshRequestIdRef.current;
    const folderAtStart = notesFolder;
    const isStale = () =>
      requestId !== refreshRequestIdRef.current ||
      !gitEnabledRef.current ||
      notesFolderRef.current !== folderAtStart;

    // Only show loading spinner on the very first load
    const isInitialLoad = !hasLoadedRef.current;
    if (isInitialLoad) {
      setIsLoading(true);
    }

    try {
      const newStatus = await gitService.getGitStatus();

      if (isStale()) return;

      hasLoadedRef.current = true;
      setStatus(newStatus);
      if (newStatus.error) {
        setLastError(newStatus.error);
      }
    } catch (err) {
      if (isStale()) return;

      setLastError(err instanceof Error ? err.message : "Failed to get git status");
    } finally {
      refreshInFlightRef.current = false;
      if (isInitialLoad) {
        setIsLoading(false);
      }
    }
  }, [notesFolder, gitEnabled]);

  const setGitEnabled = useCallback(
    async (enabled: boolean) => {
      if (!notesFolder) return false;
      if (enabled === gitEnabled) return true;

      const requestId = ++gitToggleRequestIdRef.current;
      settingsReadRequestIdRef.current += 1;
      const folderAtStart = notesFolder;
      const isStale = () =>
        requestId !== gitToggleRequestIdRef.current ||
        notesFolderRef.current !== folderAtStart;
      const previous = gitEnabled;
      setGitEnabledState(enabled);
      setIsUpdatingGitEnabled(true);

      try {
        if (isStale()) return true;

        await notesService.updateGitEnabled(enabled, folderAtStart);

        if (isStale()) return true;

        return true;
      } catch (err) {
        if (isStale()) return true;

        setGitEnabledState(previous);
        setLastError(
          err instanceof Error ? err.message : "Failed to update git setting",
        );
        return false;
      } finally {
        if (requestId === gitToggleRequestIdRef.current) {
          setIsUpdatingGitEnabled(false);
        }
      }
    },
    [notesFolder, gitEnabled],
  );

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

  const pull = useCallback(async (): Promise<string | false> => {
    setIsPulling(true);
    try {
      const result = await gitService.gitPull();
      if (result.error) {
        setLastError(result.error);
        return false;
      }
      await refreshStatus();
      return result.message || "Pulled latest changes";
    } catch (err) {
      setLastError(err instanceof Error ? err.message : "Failed to pull");
      return false;
    } finally {
      setIsPulling(false);
    }
  }, [refreshStatus]);

  const sync = useCallback(async (): Promise<{ ok: true; message: string } | { ok: false; error: string }> => {
    setIsSyncing(true);
    try {
      // Step 1: Pull from remote
      const pullResult = await gitService.gitPull();
      if (pullResult.error) {
        setLastError(pullResult.error);
        return { ok: false, error: pullResult.error };
      }
      const didPull = pullResult.message !== "Already up to date";

      // Step 2: Check if we need to push
      const freshStatus = await gitService.getGitStatus();
      let didPush = false;

      if (freshStatus.aheadCount > 0 && freshStatus.hasUpstream) {
        const pushResult = await gitService.gitPush();
        if (pushResult.error) {
          setLastError(pushResult.error);
          await refreshStatus();
          if (didPull) return { ok: false, error: `Pulled changes, but push failed: ${pushResult.error}` };
          return { ok: false, error: pushResult.error };
        }
        didPush = true;
      }

      await refreshStatus();

      if (didPull && didPush) return { ok: true, message: "Synced — pulled and pushed" };
      if (didPull) return { ok: true, message: "Pulled latest changes" };
      if (didPush) return { ok: true, message: "Pushed to remote" };
      return { ok: true, message: "Already up to date" };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Failed to sync";
      setLastError(error);
      return { ok: false, error };
    } finally {
      setIsSyncing(false);
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

  // Load per-folder git visibility setting
  // If explicitly set in settings, use that. Otherwise auto-detect: enable if the folder is a git repo.
  useEffect(() => {
    if (!notesFolder) {
      settingsReadRequestIdRef.current += 1;
      setGitEnabledState(false);
      setIsUpdatingGitEnabled(false);
      return;
    }

    let cancelled = false;
    const requestId = ++settingsReadRequestIdRef.current;

    (async () => {
      try {
        const settings = await notesService.getSettings();
        if (cancelled || requestId !== settingsReadRequestIdRef.current) return;

        if (settings.gitEnabled === true || settings.gitEnabled === false) {
          setGitEnabledState(settings.gitEnabled);
          return;
        }

        // Not explicitly set — auto-detect by checking if folder is a git repo
        const gitStatus = await gitService.getGitStatus();
        if (cancelled || requestId !== settingsReadRequestIdRef.current) return;
        setGitEnabledState(gitStatus.isRepo === true);
      } catch {
        if (cancelled || requestId !== settingsReadRequestIdRef.current) return;
        setGitEnabledState(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [notesFolder]);

  // Clear git-specific UI state when disabled
  useEffect(() => {
    if (gitEnabled) return;

    refreshRequestIdRef.current += 1;
    hasLoadedRef.current = false;
    refreshInFlightRef.current = false;
    setStatus(null);
    setIsLoading(false);
    setLastError(null);
  }, [gitEnabled]);

  // Keep stable refs so listeners/timers don't need to re-register
  const refreshStatusRef = useRef(refreshStatus);
  refreshStatusRef.current = refreshStatus;
  const isSyncingRef = useRef(false);
  isSyncingRef.current = isSyncing;

  // Refresh status when folder changes
  useEffect(() => {
    if (notesFolder && gitAvailable && gitEnabled) {
      refreshStatus();
    }
  }, [notesFolder, gitAvailable, gitEnabled, refreshStatus]);

  // Poll remote for changes periodically (every 60s) when a remote is configured
  // Fetch is separated from status to keep status checks fast and offline-friendly
  // Uses recursive setTimeout to prevent overlapping runs on slow networks
  useEffect(() => {
    if (!notesFolder || !gitAvailable || !gitEnabled || !status?.hasRemote) {
      return;
    }

    let cancelled = false;
    let timer: number;

    const poll = async () => {
      if (!isSyncingRef.current) {
        await gitService.gitFetch().catch(() => {});
        await refreshStatusRef.current();
      }
      if (!cancelled) {
        timer = window.setTimeout(poll, 60_000);
      }
    };

    timer = window.setTimeout(poll, 60_000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [notesFolder, gitAvailable, gitEnabled, status?.hasRemote]);

  // Refresh status on file changes (debounced via existing file watcher)
  // Uses a ref so the listener is registered only once
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let debounceTimer: number | undefined;

    listen("file-change", () => {
      if (!gitEnabledRef.current) return;

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
      isSyncing,
      isAddingRemote,
      gitAvailable,
      gitEnabled,
      isUpdatingGitEnabled,
      lastError,
      setGitEnabled,
      refreshStatus,
      initRepo,
      commit,
      push,
      pull,
      sync,
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
      isSyncing,
      isAddingRemote,
      gitAvailable,
      gitEnabled,
      isUpdatingGitEnabled,
      lastError,
      setGitEnabled,
      refreshStatus,
      initRepo,
      commit,
      push,
      pull,
      sync,
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

export function useOptionalGit() {
  return useContext(GitContext);
}
