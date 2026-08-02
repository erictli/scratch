import { useEffect, useRef } from "react";
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
  const interfaceZoomRef = useRef(interfaceZoom);
  const openPreferencesRef = useRef(onOpenPreferences);
  interfaceZoomRef.current = interfaceZoom;
  openPreferencesRef.current = onOpenPreferences;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const action = resolveWindowShortcut(event);
      if (!action) return;
      event.preventDefault();

      if (action === "preferences") {
        void openPreferencesRef.current();
        return;
      }

      if (action === "zoom-reset") {
        setInterfaceZoom(1);
        toast("Zoom 100%", { id: "zoom", duration: 1500 });
        return;
      }

      const delta = action === "zoom-in" ? 0.05 : -0.05;
      const next = Math.round(
        Math.min(Math.max(interfaceZoomRef.current + delta, 0.7), 1.5) * 20,
      ) / 20;
      setInterfaceZoom(next);
      toast(`Zoom ${Math.round(next * 100)}%`, {
        id: "zoom",
        duration: 1500,
      });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setInterfaceZoom]);
}
