import { useEffect, useRef, useState } from "react";
import type { WorkspaceInfo } from "../../services/notes";
import {
  CheckIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  FolderPlusIcon,
  MinusIcon,
  MoreVerticalIcon,
} from "../icons";

interface WorkspaceMenuProps {
  workspaces: WorkspaceInfo[];
  currentWorkspacePath: string | null;
  onSwitchWorkspace: (path: string) => void;
  onAddWorkspace: () => void;
  onRemoveWorkspace: (path: string) => void;
}

export function WorkspaceMenu({
  workspaces,
  currentWorkspacePath,
  onSwitchWorkspace,
  onAddWorkspace,
  onRemoveWorkspace,
}: WorkspaceMenuProps) {
  const [open, setOpen] = useState(false);
  const [actionMenuPath, setActionMenuPath] = useState<string | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const actionTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const currentWorkspace = workspaces.find((workspace) => workspace.isCurrent);
  const currentPathSegments =
    currentWorkspacePath?.split(/[\\/]/).filter(Boolean) ?? [];
  const currentWorkspaceName = currentWorkspace?.name ??
    currentPathSegments[currentPathSegments.length - 1] ??
    "Select Space";

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target)) {
        setActionMenuPath(null);
        setOpen(false);
        return;
      }

      if (
        actionMenuPath &&
        !actionMenuRef.current?.contains(target) &&
        !actionTriggerRefs.current.get(actionMenuPath)?.contains(target)
      ) {
        setActionMenuPath(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (actionMenuPath) {
        const actionTrigger = actionTriggerRefs.current.get(actionMenuPath);
        setActionMenuPath(null);
        actionTrigger?.focus();
        return;
      }
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [actionMenuPath, open]);

  return (
    <section
      ref={rootRef}
      className="relative border-b border-border px-2 pb-2 shrink-0"
    >
      <div className="flex items-center min-h-8">
        <button
          ref={triggerRef}
          type="button"
          aria-label="Switch workspace"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => {
            setActionMenuPath(null);
            setOpen((value) => !value);
          }}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold text-text hover:bg-bg-muted transition-colors"
        >
          <span className="truncate">
            {currentWorkspaceName}
          </span>
          <ChevronDownIcon
            className={`h-3.5 w-3.5 shrink-0 stroke-[1.7] transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {open && (
        <div
          role="menu"
          aria-label="Workspaces"
          className="absolute left-2 right-2 top-full z-50 mt-1 rounded-xl border border-border bg-bg p-1.5 shadow-xl"
        >
          {workspaces.length === 0 ? (
            <div className="px-2.5 py-3 text-xs text-text-muted">
              No folders in list
            </div>
          ) : (
            workspaces.map((workspace, index) => (
              <div
                key={workspace.path}
                role="none"
                className={`group relative flex min-h-10 w-full items-center rounded-lg transition-colors ${
                  workspace.isCurrent
                    ? "bg-bg-muted text-text"
                    : "text-text-muted hover:bg-bg-muted hover:text-text"
                }`}
              >
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={workspace.isCurrent}
                  data-workspace-path={workspace.path}
                  title={workspace.path}
                  onClick={() => {
                    setActionMenuPath(null);
                    setOpen(false);
                    if (!workspace.isCurrent) onSwitchWorkspace(workspace.path);
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2 self-stretch px-2.5 text-left text-sm"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{workspace.name}</span>
                    {workspace.isDefault && (
                      <span className="block text-[10px] text-text-muted">Default space</span>
                    )}
                  </span>
                  {workspace.isOpen && !workspace.isCurrent && (
                    <ExternalLinkIcon className="h-3.5 w-3.5 stroke-[1.5] opacity-60" />
                  )}
                  {workspace.isCurrent && (
                    <CheckIcon className="h-4 w-4 shrink-0 stroke-[1.8]" />
                  )}
                </button>
                <button
                  ref={(node) => {
                    if (node) actionTriggerRefs.current.set(workspace.path, node);
                    else actionTriggerRefs.current.delete(workspace.path);
                  }}
                  type="button"
                  role="menuitem"
                  aria-label={`Actions for ${workspace.name}`}
                  aria-haspopup="menu"
                  aria-expanded={actionMenuPath === workspace.path}
                  aria-controls={`workspace-actions-${index}`}
                  title={`Actions for ${workspace.name}`}
                  onClick={() => {
                    setActionMenuPath((path) =>
                      path === workspace.path ? null : workspace.path,
                    );
                  }}
                  className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted opacity-70 transition-colors hover:bg-bg hover:text-text focus-visible:opacity-100"
                >
                  <MoreVerticalIcon className="h-4 w-4 stroke-[1.6]" />
                </button>
                {actionMenuPath === workspace.path && (
                  <div
                    ref={actionMenuRef}
                    id={`workspace-actions-${index}`}
                    role="menu"
                    aria-label={`Actions for ${workspace.name}`}
                    className="absolute right-1 top-9 z-[60] min-w-48 rounded-xl border border-border bg-bg p-1.5 shadow-xl"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      aria-label={`Remove ${workspace.name} from List`}
                      onClick={() => {
                        setActionMenuPath(null);
                        onRemoveWorkspace(workspace.path);
                      }}
                      className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm text-text transition-colors hover:bg-bg-muted"
                    >
                      <MinusIcon className="h-4 w-4 shrink-0 stroke-[1.6]" />
                      <span className="min-w-0">
                        <span className="block font-medium">Remove from List</span>
                        <span className="block text-[10px] text-text-muted">
                          Files stay on disk
                        </span>
                      </span>
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
          <div role="separator" className="my-1 h-px bg-border" />
          <button
            type="button"
            role="menuitem"
            aria-label="Add Folder"
            onClick={() => {
              setOpen(false);
              onAddWorkspace();
            }}
            className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm text-text-muted transition-colors hover:bg-bg-muted hover:text-text"
          >
            <FolderPlusIcon className="h-4 w-4 shrink-0 stroke-[1.6]" />
            <span>Add Folder</span>
          </button>
        </div>
      )}
    </section>
  );
}
