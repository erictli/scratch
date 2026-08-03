import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { NodeSelection, type EditorState } from "@tiptap/pm/state";
import { useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  BoldIcon,
  CheckIcon,
  CheckSquareIcon,
  ChevronDownIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  Heading4Icon,
  InlineCodeIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  PilcrowIcon,
  QuoteIcon,
  StrikethroughIcon,
} from "../../icons";
import {
  HIGHLIGHT_COLOR_OPTIONS,
  TEXT_COLOR_OPTIONS,
} from "./markdownMarks";

interface SelectionMenuProps {
  editor: Editor;
  onEditLink: () => void;
}

export function shouldShowSelectionMenu(
  editor: Editor,
  state: EditorState,
): boolean {
  return (
    !(state.selection instanceof NodeSelection) &&
    !state.selection.empty &&
    editor.isEditable &&
    !editor.isActive("codeBlock") &&
    !editor.isActive("frontmatter")
  );
}

interface MenuButtonProps {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function MenuButton({
  label,
  active = false,
  onClick,
  children,
}: MenuButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`notion-menu-button ${active ? "is-active" : ""}`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const BLOCK_STYLES = [
  { value: "text", label: "Text", shortLabel: "Text", icon: PilcrowIcon },
  { value: "h1", label: "Heading 1", shortLabel: "H1", icon: Heading1Icon },
  { value: "h2", label: "Heading 2", shortLabel: "H2", icon: Heading2Icon },
  { value: "h3", label: "Heading 3", shortLabel: "H3", icon: Heading3Icon },
  { value: "h4", label: "Heading 4", shortLabel: "H4", icon: Heading4Icon },
  {
    value: "bulletList",
    label: "Bulleted list",
    shortLabel: "Bullets",
    icon: ListIcon,
  },
  {
    value: "orderedList",
    label: "Numbered list",
    shortLabel: "Numbered",
    icon: ListOrderedIcon,
  },
  {
    value: "taskList",
    label: "Task list",
    shortLabel: "Tasks",
    icon: CheckSquareIcon,
  },
  { value: "quote", label: "Quote", shortLabel: "Quote", icon: QuoteIcon },
] as const;

type BlockStyle = (typeof BLOCK_STYLES)[number]["value"];

function getActiveBlockStyle(editor: Editor): BlockStyle {
  if (editor.isActive("taskList")) return "taskList";
  if (editor.isActive("bulletList")) return "bulletList";
  if (editor.isActive("orderedList")) return "orderedList";
  if (editor.isActive("blockquote")) return "quote";
  if (editor.isActive("heading", { level: 1 })) return "h1";
  if (editor.isActive("heading", { level: 2 })) return "h2";
  if (editor.isActive("heading", { level: 3 })) return "h3";
  if (editor.isActive("heading", { level: 4 })) return "h4";
  return "text";
}

function applyBlockStyle(editor: Editor, style: BlockStyle): void {
  const activeStyle = getActiveBlockStyle(editor);
  const chain = editor.chain().focus();

  if (activeStyle === style) {
    chain.run();
    return;
  }

  if (activeStyle === "bulletList") chain.toggleBulletList();
  if (activeStyle === "orderedList") chain.toggleOrderedList();
  if (activeStyle === "taskList") chain.toggleTaskList();
  if (activeStyle === "quote") chain.toggleBlockquote();

  if (style === "text") chain.setParagraph();
  if (style === "h1") chain.setHeading({ level: 1 });
  if (style === "h2") chain.setHeading({ level: 2 });
  if (style === "h3") chain.setHeading({ level: 3 });
  if (style === "h4") chain.setHeading({ level: 4 });
  if (style === "bulletList") chain.setParagraph().toggleBulletList();
  if (style === "orderedList") chain.setParagraph().toggleOrderedList();
  if (style === "taskList") chain.setParagraph().toggleTaskList();
  if (style === "quote") chain.setParagraph().toggleBlockquote();

  chain.run();
}

function BlockStyleMenu({
  editor,
  activeStyle,
  portalContainer,
}: {
  editor: Editor;
  activeStyle: BlockStyle;
  portalContainer: HTMLElement | null;
}) {
  const activeOption =
    BLOCK_STYLES.find((option) => option.value === activeStyle) ??
    BLOCK_STYLES[0];
  const ActiveIcon = activeOption.icon;

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="notion-menu-button notion-block-style-trigger"
          aria-label={`Block style: ${activeOption.shortLabel}`}
          title="Block style"
          onMouseDown={(event) => event.preventDefault()}
        >
          <ActiveIcon className="w-4 h-4 stroke-[1.6]" />
          <span>{activeOption.shortLabel}</span>
          <ChevronDownIcon className="w-3 h-3 stroke-[1.8] notion-block-style-chevron" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal container={portalContainer ?? undefined}>
        <DropdownMenu.Content
          className="notion-block-style-menu"
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {BLOCK_STYLES.map((option) => {
            const OptionIcon = option.icon;
            const isActive = option.value === activeStyle;

            return (
              <Fragment key={option.value}>
                {option.value === "bulletList" ? (
                  <DropdownMenu.Separator className="notion-block-style-separator" />
                ) : null}
                <DropdownMenu.Item
                  className={`notion-block-style-item ${isActive ? "is-active" : ""}`}
                  aria-label={`Set block style to ${option.label}`}
                  onSelect={() => applyBlockStyle(editor, option.value)}
                >
                  <OptionIcon className="w-4.5 h-4.5 stroke-[1.6]" />
                  <span>{option.label}</span>
                  {isActive ? (
                    <CheckIcon className="w-3.5 h-3.5 stroke-2" />
                  ) : (
                    <span aria-hidden="true" />
                  )}
                </DropdownMenu.Item>
              </Fragment>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function ColorMenu({
  editor,
  kind,
  activeColor,
  portalContainer,
}: {
  editor: Editor;
  kind: "text" | "highlight";
  activeColor: string | null;
  portalContainer: HTMLElement | null;
}) {
  const colors =
    kind === "text" ? TEXT_COLOR_OPTIONS : HIGHLIGHT_COLOR_OPTIONS;
  const activeOption = colors.find(({ value }) => value === activeColor);
  const getThemeStyle = (color: (typeof colors)[number]) =>
    ({
      "--notion-color-light": color.light,
      "--notion-color-dark": color.dark,
    }) as React.CSSProperties;

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="notion-menu-button notion-color-trigger"
          aria-label={kind === "text" ? "Text color" : "Highlight color"}
          title={kind === "text" ? "Text color" : "Highlight color"}
          onMouseDown={(event) => event.preventDefault()}
        >
          <span>{kind === "text" ? "A" : "H"}</span>
          <span
            className="notion-color-indicator"
            data-theme-color={activeOption ? "true" : undefined}
            style={
              activeOption
                ? getThemeStyle(activeOption)
                : {
                    backgroundColor:
                      kind === "text" ? "currentColor" : "#fde047",
                  }
            }
          />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal container={portalContainer ?? undefined}>
        <DropdownMenu.Content
          className="notion-color-menu"
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <DropdownMenu.Item
            className="notion-color-clear"
            onSelect={() => {
              if (kind === "text") {
                editor.chain().focus().unsetColor().run();
              } else {
                editor.chain().focus().unsetHighlight().run();
              }
            }}
          >
            Default
          </DropdownMenu.Item>
          <div className="notion-color-grid">
            {colors.map((color) => (
              <DropdownMenu.Item
                key={color.value}
                aria-label={`${kind} ${color.value}`}
                title={color.value}
                className={`notion-color-swatch ${activeColor === color.value ? "is-active" : ""}`}
                style={getThemeStyle(color)}
                onSelect={() => {
                  if (kind === "text") {
                    editor.chain().focus().setColor(color.value).run();
                  } else {
                    editor
                      .chain()
                      .focus()
                      .setHighlight({ color: color.value })
                      .run();
                  }
                }}
              />
            ))}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function SelectionMenu({ editor, onEditLink }: SelectionMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuElement, setMenuElement] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    setMenuElement(menuRef.current);
  }, []);
  const active = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => ({
      bold: currentEditor.isActive("bold"),
      italic: currentEditor.isActive("italic"),
      underline: currentEditor.isActive("underline"),
      strike: currentEditor.isActive("strike"),
      code: currentEditor.isActive("code"),
      subscript: currentEditor.isActive("subscript"),
      superscript: currentEditor.isActive("superscript"),
      link: currentEditor.isActive("link"),
      blockStyle: getActiveBlockStyle(currentEditor),
      textColor:
        (currentEditor.getAttributes("textStyle").color as string | undefined) ??
        null,
      highlightColor:
        (currentEditor.getAttributes("highlight").color as string | undefined) ??
        null,
    }),
  });

  return (
    <BubbleMenu
      ref={menuRef}
      editor={editor}
      pluginKey="scratch-selection-menu"
      updateDelay={80}
      options={{ placement: "bottom", offset: 8, flip: true }}
      shouldShow={({ state }) => shouldShowSelectionMenu(editor, state)}
      className="notion-selection-menu"
    >
      <div className="notion-selection-toolbar">
      <BlockStyleMenu
        editor={editor}
        activeStyle={active.blockStyle}
        portalContainer={menuElement}
      />
      <span className="notion-menu-separator" />
      <MenuButton
        label="Bold"
        active={active.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <BoldIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </MenuButton>
      <MenuButton
        label="Italic"
        active={active.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <ItalicIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </MenuButton>
      <MenuButton
        label="Underline"
        active={active.underline}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <u>U</u>
      </MenuButton>
      <MenuButton
        label="Strikethrough"
        active={active.strike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <StrikethroughIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </MenuButton>
      <MenuButton
        label="Inline code"
        active={active.code}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <InlineCodeIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </MenuButton>
      <MenuButton
        label="Clear formatting"
        onClick={() => editor.chain().focus().unsetAllMarks().run()}
      >
        Tx
      </MenuButton>
      <span className="notion-menu-separator" />
      <ColorMenu
        editor={editor}
        kind="text"
        activeColor={active.textColor}
        portalContainer={menuElement}
      />
      <ColorMenu
        editor={editor}
        kind="highlight"
        activeColor={active.highlightColor}
        portalContainer={menuElement}
      />
      <span className="notion-menu-separator" />
      <MenuButton
        label="Subscript"
        active={active.subscript}
        onClick={() => editor.chain().focus().toggleSubscript().run()}
      >
        X<sub>2</sub>
      </MenuButton>
      <MenuButton
        label="Superscript"
        active={active.superscript}
        onClick={() => editor.chain().focus().toggleSuperscript().run()}
      >
        X<sup>2</sup>
      </MenuButton>
      <MenuButton
        label={active.link ? "Edit link" : "Add link"}
        active={active.link}
        onClick={onEditLink}
      >
        <LinkIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </MenuButton>
      </div>
    </BubbleMenu>
  );
}
