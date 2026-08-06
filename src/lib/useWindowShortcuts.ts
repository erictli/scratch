import { useEffect, useLayoutEffect, useRef } from "react";
import { toast } from "sonner";
import { useTheme } from "../context/ThemeContext";
import { resolveWindowShortcut } from "./windowShortcuts";

interface UseWindowShortcutsOptions {
  onOpenPreferences: () => void | Promise<void>;
}

export function useWindowShortcuts({
  onOpenPreferences,
}: UseWindowShortcutsOptions): void {
  const { setInterfaceZoom } = useTheme();
  const openPreferencesRef = useRef(onOpenPreferences);

  useLayoutEffect(() => {
    openPreferencesRef.current = onOpenPreferences;
  }, [onOpenPreferences]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const action = resolveWindowShortcut(event);
      if (!action) return;
      event.preventDefault();

      if (action === "preferences") {
        void Promise.resolve(openPreferencesRef.current()).catch((error) => {
          console.error("Failed to open Preferences:", error);
          toast.error("Preferences could not be opened.");
        });
        return;
      }

      if (action === "zoom-reset") {
        setInterfaceZoom(1);
        toast("Zoom 100%", { id: "zoom", duration: 1500 });
        return;
      }

      const delta = action === "zoom-in" ? 0.05 : -0.05;
      setInterfaceZoom((previous) => {
        const next = Math.round(
          Math.min(Math.max(previous + delta, 0.7), 1.5) * 20,
        ) / 20;
        toast(`Zoom ${Math.round(next * 100)}%`, {
          id: "zoom",
          duration: 1500,
        });
        return next;
      });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setInterfaceZoom]);
}
