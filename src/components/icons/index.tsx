// Icons - Drop in SVG paths from https://lucide.dev
// Each icon is a simple functional component that accepts className

interface IconProps {
  className?: string;
}

export function PlusIcon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M12 5l0 14" />
      <path d="M5 12l14 0" />
    </svg>
  );
}

export function XIcon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M18 6l-12 12" />
      <path d="M6 6l12 12" />
    </svg>
  );
}

export function SpinnerIcon({
  className = "w-4.5 h-4.5 animate-spin",
}: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M12 6l0 -3" />
      <path d="M16.25 7.75l2.15 -2.15" />
      <path d="M18 12l3 0" />
      <path d="M16.25 16.25l2.15 2.15" />
      <path d="M12 18l0 3" />
      <path d="M7.75 16.25l-2.15 2.15" />
      <path d="M6 12l-3 0" />
      <path d="M7.75 7.75l-2.15 -2.15" />
    </svg>
  );
}

// Format bar icons
export function BoldIcon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M7 5h6a3.5 3.5 0 0 1 0 7h-6l0 -7" />
      <path d="M13 12h1a3.5 3.5 0 0 1 0 7h-7v-7" />
    </svg>
  );
}

export function ItalicIcon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M11 5l6 0" />
      <path d="M7 19l6 0" />
      <path d="M14 5l-4 14" />
    </svg>
  );
}

export function StrikethroughIcon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M5 12l14 0" />
      <path d="M16 6.5a4 2 0 0 0 -4 -1.5h-1a3.5 3.5 0 0 0 0 7h2a3.5 3.5 0 0 1 0 7h-1.5a4 2 0 0 1 -4 -1.5" />
    </svg>
  );
}

export function Heading1Icon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M19 18v-8l-2 2" />
      <path d="M4 6v12" />
      <path d="M12 6v12" />
      <path d="M11 18h2" />
      <path d="M3 18h2" />
      <path d="M4 12h8" />
      <path d="M3 6h2" />
      <path d="M11 6h2" />
    </svg>
  );
}

export function Heading2Icon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M17 12a2 2 0 1 1 4 0c0 .591 -.417 1.318 -.816 1.858l-3.184 4.143l4 0" />
      <path d="M4 6v12" />
      <path d="M12 6v12" />
      <path d="M11 18h2" />
      <path d="M3 18h2" />
      <path d="M4 12h8" />
      <path d="M3 6h2" />
      <path d="M11 6h2" />
    </svg>
  );
}

export function Heading3Icon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M19 14a2 2 0 1 0 -2 -2" />
      <path d="M17 16a2 2 0 1 0 2 -2" />
      <path d="M4 6v12" />
      <path d="M12 6v12" />
      <path d="M11 18h2" />
      <path d="M3 18h2" />
      <path d="M4 12h8" />
      <path d="M3 6h2" />
      <path d="M11 6h2" />
    </svg>
  );
}

export function Heading4Icon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M20 18v-8l-4 6h5" />
      <path d="M4 6v12" />
      <path d="M12 6v12" />
      <path d="M11 18h2" />
      <path d="M3 18h2" />
      <path d="M4 12h8" />
      <path d="M3 6h2" />
      <path d="M11 6h2" />
    </svg>
  );
}

export function ListIcon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M9 6l11 0" />
      <path d="M9 12l11 0" />
      <path d="M9 18l11 0" />
      <path d="M5 6l0 .01" />
      <path d="M5 12l0 .01" />
      <path d="M5 18l0 .01" />
    </svg>
  );
}

export function ListOrderedIcon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M11 6h9" />
      <path d="M11 12h9" />
      <path d="M12 18h8" />
      <path d="M4 16a2 2 0 1 1 4 0c0 .591 -.5 1 -1 1.5l-3 2.5h4" />
      <path d="M6 10v-6l-2 2" />
    </svg>
  );
}

export function QuoteIcon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M6 15h15" />
      <path d="M21 19h-15" />
      <path d="M15 11h6" />
      <path d="M21 7h-6" />
      <path d="M9 9h1a1 1 0 1 1 -1 1v-2.5a2 2 0 0 1 2 -2" />
      <path d="M3 9h1a1 1 0 1 1 -1 1v-2.5a2 2 0 0 1 2 -2" />
    </svg>
  );
}

export function CodeIcon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M14.5 4h2.5a3 3 0 0 1 3 3v10a3 3 0 0 1 -3 3h-10a3 3 0 0 1 -3 -3v-5" />
      <path d="M6 5l-2 2l2 2" />
      <path d="M10 9l2 -2l-2 -2" />
    </svg>
  );
}

export function LinkIcon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M9 15l6 -6" />
      <path d="M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464" />
      <path d="M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463" />
    </svg>
  );
}

export function LinkOffIcon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M9 15l3 -3m2 -2l1 -1" />
      <path d="M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464" />
      <path d="M3 3l18 18" />
      <path d="M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463" />
    </svg>
  );
}

export function ImageIcon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M15 8h.01" />
      <path d="M3 6a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-12" />
      <path d="M3 16l5 -5c.928 -.893 2.072 -.893 3 0l5 5" />
      <path d="M14 14l1 -1c.928 -.893 2.072 -.893 3 0l3 3" />
    </svg>
  );
}

export function InlineCodeIcon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M7 8l-4 4l4 4" />
      <path d="M17 8l4 4l-4 4" />
      <path d="M14 4l-4 16" />
    </svg>
  );
}

export function SeparatorIcon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M3 12l0 .01" />
      <path d="M7 12l10 0" />
      <path d="M21 12l0 .01" />
    </svg>
  );
}

export function CheckSquareIcon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M13 5h8" />
      <path d="M13 9h5" />
      <path d="M13 15h8" />
      <path d="M13 19h5" />
      <path d="M3 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4" />
      <path d="M3 15a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4" />
    </svg>
  );
}

export function CircleCheckIcon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" />
      <path d="M9 12l2 2l4 -4" />
    </svg>
  );
}

export function CheckIcon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M5 12l5 5l10 -10" />
    </svg>
  );
}

export function ArrowLeftIcon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M5 12l14 0" />
      <path d="M5 12l6 6" />
      <path d="M5 12l6 -6" />
    </svg>
  );
}

export function ArrowRightIcon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M5 12l14 0" />
      <path d="M13 18l6 -6" />
      <path d="M13 6l6 6" />
    </svg>
  );
}

export function SettingsIcon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M12 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" />
      <path d="M4 6l8 0" />
      <path d="M16 6l4 0" />
      <path d="M6 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" />
      <path d="M4 12l2 0" />
      <path d="M10 12l10 0" />
      <path d="M15 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" />
      <path d="M4 18l11 0" />
      <path d="M19 18l1 0" />
    </svg>
  );
}

export function SwatchIcon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M19 3h-4a2 2 0 0 0 -2 2v12a4 4 0 0 0 8 0v-12a2 2 0 0 0 -2 -2" />
      <path d="M13 7.35l-2 -2a2 2 0 0 0 -2.828 0l-2.828 2.828a2 2 0 0 0 0 2.828l9 9" />
      <path d="M7.3 13h-2.3a2 2 0 0 0 -2 2v4a2 2 0 0 0 2 2h12" />
      <path d="M17 17l0 .01" />
    </svg>
  );
}

export function FolderIcon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M5 19l2.757 -7.351a1 1 0 0 1 .936 -.649h12.307a1 1 0 0 1 .986 1.164l-.996 5.211a2 2 0 0 1 -1.964 1.625h-14.026a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2h4l3 3h7a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

export function CopyIcon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M7 9.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667l0 -8.666" />
      <path d="M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1" />
    </svg>
  );
}

export function ChevronDownIcon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M6 9l6 6l6 -6" />
    </svg>
  );
}

export function GitBranchIcon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M5 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" />
      <path d="M5 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" />
      <path d="M15 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" />
      <path d="M7 8l0 8" />
      <path d="M9 18h6a2 2 0 0 0 2 -2v-5" />
      <path d="M14 14l3 -3l3 3" />
    </svg>
  );
}

export function GitBranchDeletedIcon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M5 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" />
      <path d="M5 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" />
      <path d="M7 8v8" />
      <path d="M9 18h6a2 2 0 0 0 2 -2v-5" />
      <path d="M14 14l3 -3l3 3" />
      <path d="M15 4l4 4" />
      <path d="M15 8l4 -4" />
    </svg>
  );
}

export function GitCommitIcon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" />
      <path d="M12 3l0 6" />
      <path d="M12 15l0 6" />
    </svg>
  );
}

export function UploadIcon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M12 18.004h-5.343c-2.572 -.004 -4.657 -2.011 -4.657 -4.487c0 -2.475 2.085 -4.482 4.657 -4.482c.393 -1.762 1.794 -3.2 3.675 -3.773c1.88 -.572 3.956 -.193 5.444 1c1.488 1.19 2.162 3.007 1.77 4.769h.99c1.38 0 2.57 .811 3.128 1.986" />
      <path d="M19 22v-6" />
      <path d="M22 19l-3 -3l-3 3" />
    </svg>
  );
}

export function CloudCheckIcon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M11 18.004h-4.343c-2.572 -.004 -4.657 -2.011 -4.657 -4.487c0 -2.475 2.085 -4.482 4.657 -4.482c.393 -1.762 1.794 -3.2 3.675 -3.773c1.88 -.572 3.956 -.193 5.444 1c1.488 1.19 2.162 3.007 1.77 4.769h.99c1.388 0 2.585 .82 3.138 2.007" />
      <path d="M15 19l2 2l4 -4" />
    </svg>
  );
}

export function PanelLeftIcon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12" />
      <path d="M9 4v1" />
      <path d="M9 9v1" />
      <path d="M9 14v1" />
      <path d="M9 19v1" />
    </svg>
  );
}

export function SearchIcon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" />
      <path d="M21 21l-6 -6" />
    </svg>
  );
}

export function SearchOffIcon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M5.039 5.062a7 7 0 0 0 9.91 9.89m1.584 -2.434a7 7 0 0 0 -9.038 -9.057" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

export function ExternalLinkIcon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6" />
      <path d="M11 13l9 -9" />
      <path d="M15 4h5v5" />
    </svg>
  );
}

export function NoteIcon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14" />
      <path d="M9 13h-2" />
      <path d="M13 10h-6" />
      <path d="M11 7h-4" />
    </svg>
  );
}

export function AddNoteIcon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M19 10h-14" />
      <path d="M5 6h14" />
      <path d="M14 14h-9" />
      <path d="M5 18h6" />
      <path d="M18 15v6" />
      <path d="M15 18h6" />
    </svg>
  );
}

export function TrashIcon({ className = "w-4.5 h-4.5" }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M4 7l16 0" />
      <path d="M10 11l0 6" />
      <path d="M14 11l0 6" />
      <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12" />
      <path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3" />
    </svg>
  );
}
