import { useState } from "react";
import { type Editor as TiptapEditor } from "@tiptap/react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { mod, alt, shift, isMac } from "../../lib/platform";
import { cn } from "../../lib/utils";
import { ToolbarButton, Tooltip } from "../ui";
import {
  BoldIcon,
  ItalicIcon,
  StrikethroughIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  Heading4Icon,
  ListIcon,
  ListOrderedIcon,
  CheckSquareIcon,
  QuoteIcon,
  CodeIcon,
  InlineCodeIcon,
  BlockMathIcon,
  SeparatorIcon,
  LinkIcon,
  BracketsIcon,
  ImageIcon,
  TableIcon,
} from "../icons";

// GridPicker component for table insertion
interface GridPickerProps {
  onSelect: (rows: number, cols: number) => void;
}

function GridPicker({ onSelect }: GridPickerProps) {
  const [hovered, setHovered] = useState({ row: 3, col: 3 });

  return (
    <>
      <div className="grid grid-cols-5 gap-1">
        {Array.from({ length: 25 }).map((_, i) => {
          const row = Math.floor(i / 5) + 1;
          const col = (i % 5) + 1;
          const isHighlighted = row <= hovered.row && col <= hovered.col;

          return (
            <div
              key={i}
              className={cn(
                "w-5.5 h-5.5 border rounded cursor-pointer transition-colors",
                isHighlighted
                  ? "bg-accent/20 border-accent/50"
                  : "border-border hover:border-accent/50",
              )}
              onMouseEnter={() => setHovered({ row, col })}
              onClick={() => onSelect(row, col)}
            />
          );
        })}
      </div>
      <p className="text-xs text-center mt-2 text-text-muted">
        {hovered.row} × {hovered.col} table
      </p>
    </>
  );
}

interface FormatBarProps {
  editor: TiptapEditor | null;
  onAddLink: () => void;
  onAddBlockMath: () => void;
  onAddImage: () => void;
}

// FormatBar must re-render with parent to reflect editor.isActive() state changes
// (editor instance is mutable, so memo would cause stale active states)
export function FormatBar({
  editor,
  onAddLink,
  onAddBlockMath,
  onAddImage,
}: FormatBarProps) {
  const [tableMenuOpen, setTableMenuOpen] = useState(false);

  if (!editor) return null;

  return (
    <div className="flex items-center gap-1 px-3 pb-2 border-b border-border overflow-x-auto scrollbar-none">
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive("bold")}
        title={`Bold (${mod}${isMac ? "" : "+"}B)`}
      >
        <BoldIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive("italic")}
        title={`Italic (${mod}${isMac ? "" : "+"}I)`}
      >
        <ItalicIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        isActive={editor.isActive("strike")}
        title={`Strikethrough (${mod}${isMac ? "" : "+"}${shift}${isMac ? "" : "+"}S)`}
      >
        <StrikethroughIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>

      <div className="w-px h-4.5 border-l border-border mx-2" />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        isActive={editor.isActive("heading", { level: 1 })}
        title={`Heading 1 (${mod}${isMac ? "" : "+"}${alt}${isMac ? "" : "+"}1)`}
      >
        <Heading1Icon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        isActive={editor.isActive("heading", { level: 2 })}
        title={`Heading 2 (${mod}${isMac ? "" : "+"}${alt}${isMac ? "" : "+"}2)`}
      >
        <Heading2Icon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        isActive={editor.isActive("heading", { level: 3 })}
        title={`Heading 3 (${mod}${isMac ? "" : "+"}${alt}${isMac ? "" : "+"}3)`}
      >
        <Heading3Icon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
        isActive={editor.isActive("heading", { level: 4 })}
        title={`Heading 4 (${mod}${isMac ? "" : "+"}${alt}${isMac ? "" : "+"}4)`}
      >
        <Heading4Icon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>

      <div className="w-px h-4.5 border-l border-border mx-2" />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        isActive={editor.isActive("bulletList")}
        title={`Bullet List (${mod}${isMac ? "" : "+"}${shift}${isMac ? "" : "+"}8)`}
      >
        <ListIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        isActive={editor.isActive("orderedList")}
        title={`Numbered List (${mod}${isMac ? "" : "+"}${shift}${isMac ? "" : "+"}7)`}
      >
        <ListOrderedIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        isActive={editor.isActive("taskList")}
        title="Task List"
      >
        <CheckSquareIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        isActive={editor.isActive("blockquote")}
        title={`Blockquote (${mod}${isMac ? "" : "+"}${shift}${isMac ? "" : "+"}B)`}
      >
        <QuoteIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCode().run()}
        isActive={editor.isActive("code")}
        title={`Inline Code (${mod}${isMac ? "" : "+"}E)`}
      >
        <InlineCodeIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        isActive={editor.isActive("codeBlock")}
        title={`Code Block (${mod}${isMac ? "" : "+"}${alt}${isMac ? "" : "+"}C)`}
      >
        <CodeIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={onAddBlockMath}
        isActive={editor.isActive("blockMath")}
        title="Block Math"
      >
        <BlockMathIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        isActive={false}
        title="Horizontal Rule"
      >
        <SeparatorIcon />
      </ToolbarButton>

      <div className="w-px h-4.5 border-l border-border mx-2" />

      <ToolbarButton
        onClick={onAddLink}
        isActive={editor.isActive("link")}
        title={`Add Link (${mod}${isMac ? "" : "+"}K)`}
      >
        <LinkIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().insertContent("[[").run()}
        isActive={false}
        title="Insert Wikilink"
      >
        <BracketsIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton onClick={onAddImage} isActive={false} title="Add Image">
        <ImageIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <DropdownMenu.Root open={tableMenuOpen} onOpenChange={setTableMenuOpen}>
        <Tooltip content="Insert Table">
          <DropdownMenu.Trigger asChild>
            <ToolbarButton isActive={editor.isActive("table")}>
              <TableIcon className="w-4.5 h-4.5 stroke-[1.5]" />
            </ToolbarButton>
          </DropdownMenu.Trigger>
        </Tooltip>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="p-2.5 bg-bg border border-border rounded-md shadow-lg z-50"
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <GridPicker
              onSelect={(rows, cols) => {
                editor
                  .chain()
                  .focus()
                  .insertTable({
                    rows,
                    cols,
                    withHeaderRow: true,
                  })
                  .run();
                setTableMenuOpen(false);
              }}
            />
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
