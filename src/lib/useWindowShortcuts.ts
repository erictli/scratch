import { useEffect } from "react";
import { toast } from "sonner";
import { useTheme } from "../context/ThemeContext";
import { resolveWindowShortcut } from "./windowShortcuts";

interface UseWindowShortcutsOptions {
  onOpenPreferences: () => void | Promise<void>;
}

export function useWindowShortcuts({
  onOpenPreferences,
}: UseWindowShortcutsOptions): void {
  const { interfaceZoom, setInterfaceZoom } = useTheme();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const action = resolveWindowShortcut(event);
      if (!action) return;
      event.preventDefault();

      if (action === "preferences") {
        void Promise.resolve(onOpenPreferences()).catch((error) => {
          toast.error(
            `Failed to open Preferences: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
        return;
      }

      if (action === "zoom-reset") {
        setInterfaceZoom(1);
        toast("Zoom 100%", { id: "zoom", duration: 1500 });
        return;
      }

      const delta = action === "zoom-in" ? 0.05 : -0.05;
      const next = Math.round(
        Math.min(Math.max(interfaceZoom + delta, 0.7), 1.5) * 20,
      ) / 20;
      setInterfaceZoom(next);
      toast(`Zoom ${Math.round(next * 100)}%`, {
        id: "zoom",
        duration: 1500,
      });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [interfaceZoom, onOpenPreferences, setInterfaceZoom]);
}
