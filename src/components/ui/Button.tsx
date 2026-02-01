import * as React from "react";
import { cn } from "../../lib/utils";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "secondary" | "ghost" | "outline" | "link";
  size?: "default" | "sm" | "lg" | "icon" | "icon-sm";
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    return (
      <button
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2",
          "disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
          // Variants
          variant === "default" &&
            "bg-bg-emphasis text-text hover:bg-bg-muted rounded-md",
          variant === "secondary" &&
            "bg-bg-muted text-text hover:bg-bg-emphasis rounded-md",
          variant === "ghost" &&
            "hover:bg-bg-muted text-text-muted hover:text-text rounded-md",
          variant === "outline" &&
            "border border-border bg-transparent hover:bg-bg-muted rounded-md",
          variant === "link" &&
            "text-text-muted hover:text-text underline-offset-4 hover:underline",
          // Sizes
          size === "default" && "h-10 px-4 py-2",
          size === "sm" && "h-9 px-3 text-sm",
          size === "lg" && "h-11 px-8",
          size === "icon" && "h-10 w-10",
          size === "icon-sm" && "h-8 w-8",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button };
