import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** Whether the window is in full screen, where macOS hides the traffic lights. */
export function useIsFullscreen(): boolean {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let cancelled = false;
    const sync = () => {
      appWindow
        .isFullscreen()
        .then((value) => {
          if (!cancelled) setIsFullscreen(value);
        })
        .catch(console.error);
    };

    sync();
    // Entering or leaving full screen resizes the window
    const unlisten = appWindow.onResized(sync);
    return () => {
      cancelled = true;
      unlisten.then((fn) => fn()).catch(console.error);
    };
  }, []);

  return isFullscreen;
}
