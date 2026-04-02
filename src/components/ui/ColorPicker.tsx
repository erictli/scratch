import { useState, useRef, useEffect, useCallback } from "react";
import { HexColorPicker, HexColorInput } from "react-colorful";
import { cn } from "../../lib/utils";

// Convert any CSS color string to a hex value for the picker
function toHex(cssColor: string): string {
  // Already hex
  if (/^#[0-9a-f]{3,8}$/i.test(cssColor)) {
    // Normalize 3-char to 6-char hex
    if (cssColor.length === 4) {
      return `#${cssColor[1]}${cssColor[1]}${cssColor[2]}${cssColor[2]}${cssColor[3]}${cssColor[3]}`;
    }
    return cssColor.slice(0, 7); // strip alpha channel if 8-char
  }
  // Use a canvas to convert rgb/rgba/named colors to hex
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return "#000000";
  ctx.fillStyle = cssColor;
  // ctx.fillStyle normalizes to hex or rgb()
  const normalized = ctx.fillStyle;
  if (normalized.startsWith("#")) return normalized;
  // Parse rgb(r, g, b) format
  const match = normalized.match(/(\d+)/g);
  if (match && match.length >= 3) {
    const [r, g, b] = match.map(Number);
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  }
  return "#000000";
}

interface ColorPickerProps {
  color: string;
  defaultColor: string;
  onChange: (color: string) => void;
  onReset: () => void;
}

export function ColorPicker({
  color,
  defaultColor,
  onChange,
  onReset,
}: ColorPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const swatchRef = useRef<HTMLButtonElement>(null);

  const isCustom = color !== defaultColor;

  // The hex value for the picker (converts rgba/rgb to hex if needed)
  const hexColor = toHex(color);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        swatchRef.current &&
        !swatchRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  const handleChange = useCallback(
    (newColor: string) => {
      onChange(newColor);
    },
    [onChange],
  );

  return (
    <div className="relative">
      <button
        ref={swatchRef}
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-8 h-8 rounded-md border transition-colors cursor-pointer",
          isOpen ? "border-accent" : "border-border hover:border-text-muted",
        )}
        style={{ backgroundColor: color }}
        aria-label="Pick color"
      />
      {isOpen && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-10 z-50 bg-bg border border-border rounded-lg shadow-lg p-3 flex flex-col gap-3"
        >
          <HexColorPicker color={hexColor} onChange={handleChange} />
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">#</span>
            <HexColorInput
              color={hexColor}
              onChange={handleChange}
              className="flex-1 h-8 rounded-md border border-border bg-bg px-2 text-sm text-text font-mono uppercase focus:outline-none focus:border-accent"
            />
          </div>
          {isCustom && (
            <button
              onClick={() => {
                onReset();
                setIsOpen(false);
              }}
              className="text-xs text-text-muted hover:text-text transition-colors cursor-pointer text-left"
            >
              Reset to default
            </button>
          )}
        </div>
      )}
    </div>
  );
}
