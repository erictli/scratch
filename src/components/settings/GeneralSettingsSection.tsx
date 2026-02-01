import { open } from "@tauri-apps/plugin-dialog";
import { useNotes } from "../../context/NotesContext";
import { useTheme } from "../../context/ThemeContext";
import { Button } from "../ui";
import { FolderIcon } from "../icons";

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
        <h2 className="text-sm font-medium text-text-muted mb-4">
          Notes Folder
        </h2>
        <div className="bg-bg-secondary rounded-lg border border-border p-4 space-y-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-md bg-bg-muted">
              <FolderIcon className="w-5 h-5 text-text-muted" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-text font-medium">Storage Location</p>
              <p
                className="text-sm text-text-muted truncate"
                title={notesFolder || undefined}
              >
                {formatPath(notesFolder)}
              </p>
            </div>
          </div>
          <Button onClick={handleChangeFolder} variant="outline" size="sm">
            Change Folder
          </Button>
        </div>
        <p className="mt-3 text-xs text-text-muted">
          Your notes are stored as markdown files in this folder. Changing the
          folder will load notes from the new location.
        </p>
      </section>
    </div>
  );
}
