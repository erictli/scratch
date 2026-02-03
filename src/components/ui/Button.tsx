import * as React from "react";
import { cn } from "../../lib/utils";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "default" | "secondary" | "ghost" | "outline" | "link";
  size?: "xs" | "sm" | "md" | "lg" | "xl";
}

const buttonSizes = {
  xs: "h-6 px-2 text-xs", // 24px
  sm: "h-7 px-2.5 text-sm", // 28px
  md: "h-8 px-3 text-sm", // 32px
  lg: "h-9 px-4", // 36px
  xl: "h-10 px-5", // 40px
};

const buttonVariants = {
  primary: "bg-accent text-text-inverse hover:bg-accent/90 rounded-md",
  default: "bg-bg-muted text-text hover:bg-bg-emphasis rounded-md",
  secondary: "bg-bg-muted text-text hover:bg-bg-emphasis rounded-md",
  ghost: "hover:bg-bg-muted text-text-muted hover:text-text rounded-md",
  outline:
    "border border-border bg-transparent hover:bg-bg-muted text-text rounded-md",
  link: "text-text-muted hover:text-text underline-offset-4 hover:underline",
};

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "md", ...props }, ref) => {
    return (
      <button
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors",
          "focus-visible:outline focus-visible:outline-accent",
          "disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
          buttonSizes[size],
          buttonVariants[variant],
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
