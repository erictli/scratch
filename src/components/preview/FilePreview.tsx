import { useCallback, useEffect, useMemo, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import type { AttachmentMetadata } from "../../types/note";
import * as filesService from "../../services/files";
import { Button, IconButton } from "../ui";
import {
  CopyIcon,
  ExternalLinkIcon,
  ImageIcon,
  NoteIcon,
  PanelLeftIcon,
  RefreshCwIcon,
  SpinnerIcon,
} from "../icons";

interface FilePreviewProps {
  attachment: AttachmentMetadata;
  onToggleSidebar?: () => void;
  sidebarVisible?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function FilePreview({
  attachment,
  onToggleSidebar,
  sidebarVisible,
}: FilePreviewProps) {
  const [textContent, setTextContent] = useState<string | null>(null);
  const [isLoadingText, setIsLoadingText] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [imageError, setImageError] = useState(false);
  const assetUrl = useMemo(
    () => convertFileSrc(attachment.path),
    [attachment.path],
  );

  const loadText = useCallback(async () => {
    if (attachment.kind !== "text") return;
    setIsLoadingText(true);
    try {
      setTextContent(await filesService.readTextFile(attachment.path));
    } catch (error) {
      console.error("Failed to read text file:", error);
      toast.error(`Failed to read file: ${error}`);
      setTextContent("");
    } finally {
      setIsLoadingText(false);
    }
  }, [attachment.kind, attachment.path]);

  useEffect(() => {
    setTextContent(null);
    setImageError(false);
    loadText();
  }, [loadText, attachment.modified]);

  const handleReload = useCallback(() => {
    setReloadKey((key) => key + 1);
    setImageError(false);
    loadText();
  }, [loadText]);

  const handleCopyPath = useCallback(async () => {
    try {
      await invoke("copy_to_clipboard", { text: attachment.path });
      toast.success("Copied filepath");
    } catch {
      toast.error("Failed to copy filepath");
    }
  }, [attachment.path]);

  const handleReveal = useCallback(async () => {
    try {
      await invoke("open_in_file_manager", { path: attachment.path });
    } catch {
      toast.error("Failed to reveal file");
    }
  }, [attachment.path]);

  return (
    <div className="flex-1 min-w-0 h-full flex flex-col bg-bg text-text">
      <div
        className="h-10 shrink-0 flex items-end justify-between px-4 pb-1 border-b border-border"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {onToggleSidebar && (
            <IconButton
              onClick={onToggleSidebar}
              title={sidebarVisible ? "Hide Sidebar" : "Show Sidebar"}
            >
              <PanelLeftIcon className="w-4.25 h-4.25 stroke-[1.5]" />
            </IconButton>
          )}
          <div className="min-w-0">
            <div className="text-xs text-text-muted truncate">
              {formatBytes(attachment.size)} ·{" "}
              {formatDateTime(attachment.modified)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-px">
          <IconButton onClick={handleReload} title="Reload Preview">
            <RefreshCwIcon className="w-4.25 h-4.25 stroke-[1.5]" />
          </IconButton>
          <IconButton onClick={handleCopyPath} title="Copy Filepath">
            <CopyIcon className="w-4.25 h-4.25 stroke-[1.5]" />
          </IconButton>
          <IconButton onClick={handleReveal} title="Reveal in File Manager">
            <ExternalLinkIcon className="w-4.25 h-4.25 stroke-[1.5]" />
          </IconButton>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {attachment.kind === "image" && (
          <div className="h-full min-h-0 flex items-center justify-center p-6">
            {imageError ? (
              <div className="flex flex-col items-center justify-center gap-3 text-text-muted">
                <ImageIcon className="w-9 h-9 stroke-[1.4]" />
                <p className="text-sm">Failed to load image.</p>
                <Button onClick={handleReveal} variant="secondary" size="sm">
                  Reveal File
                </Button>
              </div>
            ) : (
              <img
                key={`${attachment.path}:${attachment.modified}:${reloadKey}`}
                src={`${assetUrl}?v=${attachment.modified}-${reloadKey}`}
                alt={attachment.name}
                className="max-w-full max-h-full object-contain rounded-md"
                onError={() => setImageError(true)}
              />
            )}
          </div>
        )}

        {attachment.kind === "pdf" && (
          <object
            key={`${attachment.path}:${attachment.modified}:${reloadKey}`}
            data={`${assetUrl}?v=${attachment.modified}-${reloadKey}`}
            type="application/pdf"
            className="w-full h-full min-h-[480px]"
          >
            <div className="h-full flex flex-col items-center justify-center gap-3 text-text-muted">
              <NoteIcon className="w-9 h-9 stroke-[1.4]" />
              <p className="text-sm">
                PDF preview is not available in this WebView.
              </p>
              <Button onClick={handleReveal} variant="secondary" size="sm">
                Reveal File
              </Button>
            </div>
          </object>
        )}

        {attachment.kind === "text" && (
          <div className="h-full min-h-0 p-6">
            {isLoadingText ? (
              <div className="h-full flex items-center justify-center text-text-muted">
                <SpinnerIcon className="w-5 h-5 animate-spin" />
              </div>
            ) : (
              <pre className="text-sm leading-6 whitespace-pre-wrap break-words font-mono text-text">
                {textContent}
              </pre>
            )}
          </div>
        )}

        {attachment.kind === "file" && (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-text-muted">
            <ImageIcon className="w-9 h-9 stroke-[1.4]" />
            <p className="text-sm">
              No preview is available for this file type.
            </p>
            <Button onClick={handleReveal} variant="secondary" size="sm">
              Reveal File
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
