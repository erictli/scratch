import { useCallback, useEffect, useState } from "react";
import { cn } from "../../lib/utils";
import {
  type FileVersion,
  getFileAtCommit,
  getFileHistory,
} from "../../services/git";
import { XIcon, SpinnerIcon } from "../icons";
import { Button } from "../ui/Button";

interface VersionHistoryPanelProps {
  noteId: string;
  currentContent: string;
  onPreview: (content: string | null) => void;
  onRestore: (content: string) => void;
  onClose: () => void;
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

export function VersionHistoryPanel({
  noteId,
  currentContent,
  onPreview,
  onRestore,
  onClose,
}: VersionHistoryPanelProps) {
  const [versions, setVersions] = useState<FileVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [selectedContent, setSelectedContent] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSelectedIndex(null);
    setSelectedContent(null);
    onPreview(null);

    const filePath = `${noteId}.md`;
    console.log("[VersionHistory] Loading history for:", { noteId, filePath });
    getFileHistory(filePath)
      .then((result) => {
        console.log("[VersionHistory] History result:", result.map(v => ({ commit: v.commit.slice(0, 8), message: v.message, date: v.date })));
        if (!cancelled) setVersions(result);
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
  }, [noteId]);

  const handleSelectVersion = useCallback(
    async (index: number) => {
      const version = versions[index];
      if (!version) return;

      setSelectedIndex(index);

      try {
        console.log("[VersionHistory] Fetching content:", { commit: version.commit.slice(0, 8), filePath: version.filePath, message: version.message });
        const content = await getFileAtCommit(version.commit, version.filePath);
        console.log("[VersionHistory] Content loaded, length:", content.length);
        setSelectedContent(content);
        onPreview(content);
      } catch (err) {
        console.error("[VersionHistory] Failed to load version content:", { commit: version.commit.slice(0, 8), filePath: version.filePath, error: err });
        setSelectedContent(null);
        onPreview(null);
      }
    },
    [versions, onPreview],
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
              ({versions.length})
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
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <SpinnerIcon className="w-5 h-5 text-text-muted animate-spin" />
          </div>
        ) : versions.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-text-muted">
            No versions found
          </div>
        ) : (
          <div className="py-1">
            {versions.map((version, index) => (
              <button
                key={version.commit}
                onClick={() => handleSelectVersion(index)}
                className={cn(
                  "w-full text-left px-4 py-2.5 transition-colors",
                  "hover:bg-bg-emphasis",
                  selectedIndex === index
                    ? "bg-bg-muted ring-accent/50"
                    : "bg-transparent",
                )}
              >
                <div className="text-sm font-medium text-text truncate">
                  {version.message || "Untitled commit"}
                </div>
                <div className="text-xs text-text-muted mt-0.5">
                  {formatVersionDate(version.date)}
                </div>
              </button>
            ))}
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
