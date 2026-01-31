import { open } from "@tauri-apps/plugin-dialog";
import { useNotes } from "../../context/NotesContext";
import { Button } from "../ui";
import { FolderIcon } from "../icons";

export function FolderPicker() {
  const { setNotesFolder } = useNotes();

  const handleSelectFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose Notes Folder",
      });

      if (selected && typeof selected === "string") {
        await setNotesFolder(selected);
      }
    } catch (err) {
      console.error("Failed to select folder:", err);
    }
  };

  return (
    <div className="h-full flex items-center justify-center bg-bg-secondary">
      <div className="text-center p-8 max-w-md">
        <div className="mb-6">
          <FolderIcon className="w-20 h-20 mx-auto text-text-muted" />
        </div>

        <h1 className="text-2xl font-medium text-text mb-2">
          Welcome to Scratch
        </h1>
        <p className="text-text-muted mb-6">
          Choose a folder to store your notes. Each note will be saved as a
          markdown file, making them portable and version-control friendly.
        </p>

        <Button onClick={handleSelectFolder} size="lg">
          Choose Notes Folder
        </Button>

        <p className="mt-4 text-xs text-text-muted">
          You can change this later in settings
        </p>
      </div>
    </div>
  );
}
