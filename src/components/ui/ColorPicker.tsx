import { useState, useRef, useEffect, useCallback } from "react";
import { RgbaColorPicker } from "react-colorful";
import { cn } from "../../lib/utils";

interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

// Parse any CSS color string into {r, g, b, a}
function parseColor(cssColor: string): RgbaColor {
  // rgba(r, g, b, a)
  const rgbaMatch = cssColor.match(
    /^rgba\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\s*\)$/,
  );
  if (rgbaMatch) {
    return {
      r: Math.round(Number(rgbaMatch[1])),
      g: Math.round(Number(rgbaMatch[2])),
      b: Math.round(Number(rgbaMatch[3])),
      a: Number(rgbaMatch[4]),
    };
  }
  // rgb(r, g, b)
  const rgbMatch = cssColor.match(
    /^rgb\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\s*\)$/,
  );
  if (rgbMatch) {
    return {
      r: Math.round(Number(rgbMatch[1])),
      g: Math.round(Number(rgbMatch[2])),
      b: Math.round(Number(rgbMatch[3])),
      a: 1,
    };
  }
  // hex
  if (/^#[0-9a-f]{3,8}$/i.test(cssColor)) {
    let hex = cssColor.slice(1);
    if (hex.length === 3) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
    };
  }
  // Fallback: use canvas
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return { r: 0, g: 0, b: 0, a: 1 };
  ctx.fillStyle = cssColor;
  const normalized = ctx.fillStyle;
  if (normalized.startsWith("#")) return parseColor(normalized);
  const match = normalized.match(/(\d+)/g);
  if (match && match.length >= 3) {
    return {
      r: Number(match[0]),
      g: Number(match[1]),
      b: Number(match[2]),
      a: 1,
    };
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}

// Convert {r, g, b, a} to a CSS string
function rgbaToString({ r, g, b, a }: RgbaColor): string {
  if (a >= 1) {
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  }
  return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 100) / 100})`;
}

// Extract hex portion (without #) from rgba
function rgbaToHex({ r, g, b }: RgbaColor): string {
  return ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
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
  const parsed = parseColor(color);

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

  const handlePickerChange = useCallback(
    (rgba: RgbaColor) => {
      onChange(rgbaToString(rgba));
    },
    [onChange],
  );

  const handleHexInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 6);
      if (raw.length === 6) {
        const r = parseInt(raw.slice(0, 2), 16);
        const g = parseInt(raw.slice(2, 4), 16);
        const b = parseInt(raw.slice(4, 6), 16);
        onChange(rgbaToString({ r, g, b, a: parsed.a }));
      }
    },
    [onChange, parsed.a],
  );

  const handleOpacityInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = parseInt(e.target.value, 10);
      if (!Number.isFinite(val)) return;
      const clamped = Math.min(Math.max(val, 0), 100);
      onChange(rgbaToString({ ...parsed, a: clamped / 100 }));
    },
    [onChange, parsed],
  );

  return (
    <div className="relative">
      <button
        ref={swatchRef}
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-6.5 h-6.5 rounded-md border transition-colors cursor-pointer",
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
          <RgbaColorPicker color={parsed} onChange={handlePickerChange} />
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-text-muted font-mono">
                #
              </span>
              <input
                type="text"
                value={rgbaToHex(parsed).toUpperCase()}
                onChange={handleHexInput}
                className="w-full h-8 rounded-md border border-border bg-bg pl-5 pr-2 text-sm text-text font-mono uppercase focus:outline-none focus:border-accent"
                maxLength={7}
                spellCheck={false}
              />
            </div>
            <div className="relative w-16">
              <input
                type="number"
                min="0"
                max="100"
                value={Math.round(parsed.a * 100)}
                onChange={handleOpacityInput}
                className="w-full h-8 rounded-md border border-border bg-bg pl-2 pr-6 text-sm text-text font-mono text-center focus:outline-none focus:border-accent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-text-muted font-mono">
                %
              </span>
            </div>
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
