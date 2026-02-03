import { useTheme } from "../../context/ThemeContext";
import { Toaster as Sonner } from "sonner";

export function Toaster() {
  const { resolvedTheme } = useTheme();

  return (
    <Sonner
      theme={resolvedTheme as "light" | "dark"}
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            "group toast bg-bg border-border text-text shadow-lg rounded-lg w-full max-w-72",
          description: "text-text-muted",
          actionButton: "bg-accent text-white",
          cancelButton: "bg-bg-muted text-text",
          error: "!bg-bg !text-text !border-border",
          success: "!bg-bg !text-text !border-border",
          warning: "!bg-bg !text-text !border-border",
          info: "!bg-bg !text-text !border-border",
        },
      }}
    />
  );
}
