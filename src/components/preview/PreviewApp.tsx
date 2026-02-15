import { useState, useCallback, useRef, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { Editor, type PreviewModeData } from "../editor/Editor";
import * as filesService from "../../services/files";

interface PreviewAppProps {
  filePath: string;
}

export function PreviewApp({ filePath }: PreviewAppProps) {
  const [content, setContent] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [modified, setModified] = useState(0);
  const [hasExternalChanges, setHasExternalChanges] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [focusMode, setFocusMode] = useState(false);
  const recentlySavedRef = useRef(false);

  // Load file on mount
  useEffect(() => {
    filesService
      .readFileDirect(filePath)
      .then((result) => {
        setContent(result.content);
        setTitle(result.title);
        setModified(result.modified);
      })
      .catch((error) => {
        console.error("Failed to load file:", error);
        toast.error(`Failed to load file: ${error}`);
      });
  }, [filePath]);

  // Listen for window focus to detect external changes
  useEffect(() => {
    const handleFocus = async () => {
      if (recentlySavedRef.current) {
        recentlySavedRef.current = false;
        return;
      }
      try {
        const result = await filesService.readFileDirect(filePath);
        if (result.modified !== modified && content !== null) {
          setHasExternalChanges(true);
        }
      } catch {
        // File may have been deleted
      }
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [filePath, modified, content]);

  const save = useCallback(
    async (newContent: string) => {
      try {
        recentlySavedRef.current = true;
        const result = await filesService.saveFileDirect(filePath, newContent);
        setModified(result.modified);
        setTitle(result.title);
        setHasExternalChanges(false);
      } catch (error) {
        console.error("Failed to save file:", error);
        toast.error(`Failed to save: ${error}`);
      }
    },
    [filePath],
  );

  const reload = useCallback(async () => {
    try {
      const result = await filesService.readFileDirect(filePath);
      setContent(result.content);
      setTitle(result.title);
      setModified(result.modified);
      setHasExternalChanges(false);
      setReloadVersion((v) => v + 1);
    } catch (error) {
      console.error("Failed to reload file:", error);
      toast.error(`Failed to reload: ${error}`);
    }
  }, [filePath]);

  // Listen for preview-file-change events
  useEffect(() => {
    const unlisten = listen<string>("preview-file-change", () => {
      setHasExternalChanges(true);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Keyboard shortcuts for preview mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const modKey = e.metaKey || e.ctrlKey;

      // Cmd+Shift+Enter: Toggle focus mode
      if (modKey && e.shiftKey && e.key === "Enter") {
        e.preventDefault();
        setFocusMode((prev) => !prev);
        return;
      }

      // Cmd+Shift+M: Toggle markdown source mode
      if (modKey && e.shiftKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("toggle-source-mode"));
        return;
      }

      // Cmd+R: Reload file from disk
      if (modKey && e.key === "r") {
        e.preventDefault();
        reload();
        return;
      }

      // Escape: Exit focus mode
      if (e.key === "Escape" && focusMode) {
        e.preventDefault();
        setFocusMode(false);
        return;
      }

      // Trap Tab to prevent focus leaving editor
      if (e.key === "Tab") {
        e.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [focusMode, reload]);

  const previewData: PreviewModeData = {
    content,
    title,
    filePath,
    modified,
    hasExternalChanges,
    reloadVersion,
    save,
    reload,
  };

  return (
    <div className="h-screen flex flex-col bg-bg text-text">
      <Editor focusMode={focusMode} previewMode={previewData} />
    </div>
  );
}
