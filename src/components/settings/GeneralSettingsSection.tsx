import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useNotes } from "../../context/NotesContext";
import { useTheme } from "../../context/ThemeContext";
import { Button } from "../ui";
import { FolderIcon, ExternalLinkIcon } from "../icons";

export function GeneralSettingsSection() {
  const { notesFolder, setNotesFolder } = useNotes();
  const { reloadSettings } = useTheme();

  const handleChangeFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose Notes Folder",
        defaultPath: notesFolder || undefined,
      });

      if (selected && typeof selected === "string") {
        await setNotesFolder(selected);
        // Reload theme/font settings from the new folder's .scratch/settings.json
        await reloadSettings();
      }
    } catch (err) {
      console.error("Failed to select folder:", err);
    }
  };

  const handleOpenFolder = async () => {
    if (!notesFolder) return;
    try {
      await revealItemInDir(notesFolder);
    } catch (err) {
      console.error("Failed to open folder:", err);
    }
  };

  // Format path for display - truncate middle if too long
  const formatPath = (path: string | null): string => {
    if (!path) return "Not set";
    const maxLength = 50;
    if (path.length <= maxLength) return path;

    // Show start and end of path
    const start = path.slice(0, 20);
    const end = path.slice(-25);
    return `${start}...${end}`;
  };

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-xl font-medium">Folder Location</h2>
        <p className="text-sm text-text-muted mb-3">
          Your notes are stored as markdown files in this folder
        </p>
        <div className="flex items-center gap-3 p-2.5 rounded-lg bg-bg-secondary border border-border mb-3">
          <div className="p-2 rounded-md bg-bg-muted">
            <FolderIcon className="w-4.5 h-4.5 stroke-[1.5] text-text-muted" />
          </div>
          <p
            className="text-sm text-text-muted truncate"
            title={notesFolder || undefined}
          >
            {formatPath(notesFolder)}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button onClick={handleChangeFolder} variant="secondary" size="md">
            Change Folder
          </Button>
          {notesFolder && (
            <Button
              onClick={handleOpenFolder}
              variant="ghost"
              size="md"
              className="gap-1.5"
            >
              <ExternalLinkIcon className="w-4 h-4" />
              Open in Finder
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
