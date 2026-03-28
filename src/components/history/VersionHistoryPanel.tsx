import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "../../lib/utils";
import {
  type FileVersion,
  getFileAtCommit,
  getFileHistory,
} from "../../services/git";
import { XIcon, SpinnerIcon } from "../icons";
import { Button } from "../ui/Button";
import noHistoryCat from "../../assets/no-history-cat.png";

interface VersionHistoryPanelProps {
  noteId: string;
  currentContent: string;
  refreshKey?: number;
  onPreview: (content: string | null) => void;
  onRestore: (content: string) => void;
  onClose: () => void;
}

interface DiffStats {
  added: number;
  removed: number;
  changed: number;
}

function computeDiffStats(oldText: string, newText: string): DiffStats {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  // Simple LCS-based diff to count added/removed/changed lines
  const oldSet = new Map<string, number[]>();
  oldLines.forEach((line, i) => {
    const arr = oldSet.get(line) || [];
    arr.push(i);
    oldSet.set(line, arr);
  });

  const newSet = new Map<string, number[]>();
  newLines.forEach((line, i) => {
    const arr = newSet.get(line) || [];
    arr.push(i);
    newSet.set(line, arr);
  });

  // Count lines unique to each side
  let matchedOld = 0;
  let matchedNew = 0;

  for (const [line, oldPositions] of oldSet) {
    const newPositions = newSet.get(line);
    if (newPositions) {
      const matched = Math.min(oldPositions.length, newPositions.length);
      matchedOld += matched;
      matchedNew += matched;
    }
  }

  const removed = oldLines.length - matchedOld;
  const added = newLines.length - matchedNew;
  const changed = Math.min(removed, added);

  return {
    added: added - changed,
    removed: removed - changed,
    changed,
  };
}

function formatVersionDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const startOfYesterday = new Date(startOfToday.getTime() - 86400000);

  const time = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  if (date >= startOfToday) {
    return `Today ${time}`;
  }
  if (date >= startOfYesterday) {
    return `Yesterday ${time}`;
  }

  const dateStr = date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== now.getFullYear() && { year: "numeric" }),
  });
  return `${dateStr} ${time}`;
}

function DiffBadge({ stats }: { stats: DiffStats }) {
  if (stats.added === 0 && stats.removed === 0 && stats.changed === 0) {
    return (
      <span className="text-[10px] text-text-muted opacity-60">
        No changes
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1.5 mt-1">
      {stats.added > 0 && (
        <span className="text-[10px] font-medium text-green-600 dark:text-green-400">
          +{stats.added}
        </span>
      )}
      {stats.removed > 0 && (
        <span className="text-[10px] font-medium text-red-500 dark:text-red-400">
          −{stats.removed}
        </span>
      )}
      {stats.changed > 0 && (
        <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
          ~{stats.changed}
        </span>
      )}
    </div>
  );
}

export function VersionHistoryPanel({
  noteId,
  currentContent,
  refreshKey,
  onPreview,
  onRestore,
  onClose,
}: VersionHistoryPanelProps) {
  const [versions, setVersions] = useState<FileVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [selectedContent, setSelectedContent] = useState<string | null>(null);
  const [versionContents, setVersionContents] = useState<
    Map<string, string>
  >(new Map());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSelectedIndex(null);
    setSelectedContent(null);
    setVersionContents(new Map());
    onPreview(null);

    getFileHistory(`${noteId}.md`)
      .then((result) => {
        if (!cancelled) {
          setVersions(result);
          // Prefetch all version contents for diff stats
          for (const version of result) {
            getFileAtCommit(version.commit, version.filePath)
              .then((content) => {
                if (!cancelled) {
                  setVersionContents((prev) => {
                    const next = new Map(prev);
                    next.set(version.commit, content);
                    return next;
                  });
                }
              })
              .catch(() => {
                // Ignore — diff stats just won't show for this version
              });
          }
        }
      })
      .catch((err) => {
        console.error("Failed to load file history:", err);
        if (!cancelled) setVersions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, refreshKey]);

  // Compute diff stats: for each past version, compare it against the current (newest) version
  const diffStats = useMemo(() => {
    const stats = new Map<string, DiffStats>();
    if (versions.length < 2) return stats;

    const currentContent = versionContents.get(versions[0].commit);
    if (currentContent == null) return stats;

    for (let i = 1; i < versions.length; i++) {
      const version = versions[i];
      const content = versionContents.get(version.commit);
      if (content == null) continue;
      // Show what changed FROM this old version TO the current version
      stats.set(version.commit, computeDiffStats(content, currentContent));
    }
    return stats;
  }, [versions, versionContents]);

  const handleSelectVersion = useCallback(
    async (index: number) => {
      const version = versions[index];
      if (!version) return;

      setSelectedIndex(index);

      // Use cached content if available
      const cached = versionContents.get(version.commit);
      if (cached != null) {
        setSelectedContent(cached);
        onPreview(cached);
        return;
      }

      try {
        const content = await getFileAtCommit(version.commit, version.filePath);
        setSelectedContent(content);
        onPreview(content);
        setVersionContents((prev) => {
          const next = new Map(prev);
          next.set(version.commit, content);
          return next;
        });
      } catch (err) {
        console.error("Failed to load version content:", err);
        setSelectedContent(null);
        onPreview(null);
      }
    },
    [versions, versionContents, onPreview],
  );

  const handleRestore = useCallback(() => {
    if (selectedContent != null) {
      onRestore(selectedContent);
    }
  }, [selectedContent, onRestore]);

  const canRestore =
    selectedContent != null && selectedContent !== currentContent;

  return (
    <div className="w-72 h-full bg-bg-secondary border-l border-border flex flex-col shrink-0">
      {/* Header */}
      <div
        className="h-11 shrink-0 flex items-center justify-between px-4 border-b border-border"
        data-tauri-drag-region
      >
        <span className="text-sm font-medium text-text titlebar-no-drag">
          History
          {!loading && (
            <span className="text-text-muted font-normal ml-1">
              ({Math.max(0, versions.length - 1)})
            </span>
          )}
        </span>
        <button
          onClick={onClose}
          className="titlebar-no-drag h-6 w-6 flex items-center justify-center rounded hover:bg-bg-emphasis transition-colors text-text-muted hover:text-text"
        >
          <XIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Version list */}
      <div className="flex-1 overflow-y-auto p-1.5">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <SpinnerIcon className="w-5 h-5 text-text-muted animate-spin" />
          </div>
        ) : versions.length <= 1 ? (
          <div className="py-2 flex flex-col items-center text-center text-sm text-text-muted">
            <img
              src={noHistoryCat}
              alt=""
              className="w-16 h-16 opacity-70 dark:invert"
            />
            No previous versions
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {versions.slice(1).map((version, sliceIndex) => {
              const index = sliceIndex + 1; // offset for the skipped current version
              const stats = diffStats.get(version.commit);
              return (
                <button
                  key={version.commit}
                  onClick={() => handleSelectVersion(index)}
                  className={cn(
                    "w-full text-left px-4 py-2.5 transition-colors rounded-md",
                    "hover:bg-bg-muted",
                    selectedIndex === index
                      ? "bg-bg-muted ring-accent/50"
                      : "bg-transparent",
                  )}
                >
                  <div className="text-sm font-medium text-text truncate">
                    {version.message || "Untitled commit"}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-muted mt-0.5">
                      {formatVersionDate(version.date)}
                    </span>
                    {stats && <DiffBadge stats={stats} />}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 px-4 py-3 border-t border-border shrink-0">
        <Button variant="ghost" size="sm" onClick={onClose} className="flex-1">
          Close
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleRestore}
          disabled={!canRestore}
          className="flex-1"
        >
          Restore
        </Button>
      </div>
    </div>
  );
}
