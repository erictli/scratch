import type { AttachmentKind } from "../../types/note";
import {
  FileIcon,
  FilePdfIcon,
  FileTextIcon,
  ImageIcon,
} from "../icons";

interface FileTypeIconProps {
  kind: AttachmentKind;
  className?: string;
}

export function FileTypeIcon({
  kind,
  className = "w-4 h-4 stroke-[1.6] opacity-50 shrink-0",
}: FileTypeIconProps) {
  if (kind === "image") return <ImageIcon className={className} />;
  if (kind === "pdf") return <FilePdfIcon className={className} />;
  if (kind === "text") return <FileTextIcon className={className} />;
  return <FileIcon className={className} />;
}
