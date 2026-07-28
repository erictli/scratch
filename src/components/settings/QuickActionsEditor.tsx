import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon, TrashIcon, PlusIcon } from "../icons";
import type { Settings } from "../../types/note";
import { DEFAULT_AI_PRESETS } from "../ai/presets";

interface Item {
  id: string;
  label: string;
  instruction: string;
}

interface Draft {
  id: string;
  label: string;
  instruction: string;
  isNew: boolean;
}

function newId() {
  return crypto.randomUUID();
}

interface FormProps {
  draft: Draft;
  onChange: (field: "label" | "instruction", value: string) => void;
  onCancel: () => void;
  onSave: () => void;
  onDelete?: () => void;
}

function PresetForm({ draft, onChange, onCancel, onSave, onDelete }: FormProps) {
  const valid = draft.label.trim() && draft.instruction.trim();
  return (
    <div className="p-4 rounded-[10px] border border-text/30 bg-bg space-y-3">
      <input
        autoFocus
        value={draft.label}
        onChange={(e) => onChange("label", e.target.value)}
        placeholder="Action name"
        className="w-full text-[15px] font-semibold bg-transparent outline-none text-text placeholder-text-muted/50"
      />
      <div>
        <div className="text-2xs font-semibold uppercase tracking-wide text-text-muted mb-1.5">
          Prompt sent to the model
        </div>
        <textarea
          value={draft.instruction}
          onChange={(e) => onChange("instruction", e.target.value)}
          placeholder="Describe what the AI should do with the selected text…"
          rows={3}
          className="w-full text-sm bg-bg-muted rounded-md px-3 py-2 outline-none text-text placeholder-text-muted/50 border border-border focus:border-text-muted resize-none transition-colors"
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-text-muted">
          The selected text is appended automatically.
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {!draft.isNew && onDelete && (
            <button
              onClick={onDelete}
              title="Delete"
              className="p-1.5 text-text-muted hover:text-red-500 transition-colors"
            >
              <TrashIcon className="w-4 h-4 stroke-[1.6]" />
            </button>
          )}
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={!valid}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-text text-bg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            {draft.isNew ? "Add action" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface RowProps {
  item: Item;
  draft: Draft | null;
  onEdit: () => void;
  onChange: (field: "label" | "instruction", value: string) => void;
  onCancel: () => void;
  onSave: () => void;
  onDelete: () => void;
}

function SortableRow({
  item,
  draft,
  onEdit,
  onChange,
  onCancel,
  onSave,
  onDelete,
}: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      {draft ? (
        <PresetForm
          draft={draft}
          onChange={onChange}
          onCancel={onCancel}
          onSave={onSave}
          onDelete={onDelete}
        />
      ) : (
        <div className="flex items-start gap-2 p-3 rounded-[10px] border border-border bg-bg">
          <button
            {...attributes}
            {...listeners}
            title="Drag to reorder"
            className="mt-0.5 shrink-0 cursor-grab touch-none text-text-muted/40 hover:text-text-muted"
          >
            <GripVerticalIcon className="w-4 h-4" />
          </button>
          <button onClick={onEdit} className="flex-1 min-w-0 text-left">
            <div className="text-sm font-medium truncate">
              {item.label || "Untitled action"}
            </div>
            <div className="text-xs text-text-muted truncate">
              {item.instruction || "No instruction yet"}
            </div>
          </button>
        </div>
      )}
    </div>
  );
}

export function QuickActionsEditor() {
  const [items, setItems] = useState<Item[]>([]);
  const [editing, setEditing] = useState<Draft | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  useEffect(() => {
    invoke<Settings>("get_settings")
      .then((s) => {
        const presets = s.aiSelectionPresets?.length
          ? s.aiSelectionPresets
          : DEFAULT_AI_PRESETS;
        setItems(presets.map((p) => ({ id: newId(), ...p })));
      })
      .catch(() =>
        setItems(DEFAULT_AI_PRESETS.map((p) => ({ id: newId(), ...p }))),
      );
  }, []);

  const persist = (next: Item[]) => {
    const presets = next.map(({ label, instruction }) => ({
      label,
      instruction,
    }));
    invoke<Settings>("get_settings")
      .then((s) =>
        invoke("update_settings", {
          newSettings: { ...s, aiSelectionPresets: presets },
        }),
      )
      .catch(() => {});
  };

  const changeDraft = (field: "label" | "instruction", value: string) =>
    setEditing((d) => (d ? { ...d, [field]: value } : d));

  const save = () => {
    if (!editing) return;
    const label = editing.label.trim();
    const instruction = editing.instruction.trim();
    if (!label || !instruction) return;
    const entry = { id: editing.id, label, instruction };
    setItems((prev) => {
      const next = editing.isNew
        ? [...prev, entry]
        : prev.map((it) => (it.id === entry.id ? entry : it));
      persist(next);
      return next;
    });
    setEditing(null);
  };

  const remove = (id: string) => {
    setItems((prev) => {
      const next = prev.filter((it) => it.id !== id);
      persist(next);
      return next;
    });
    setEditing(null);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setItems((prev) => {
      const next = arrayMove(
        prev,
        prev.findIndex((it) => it.id === active.id),
        prev.findIndex((it) => it.id === over.id),
      );
      persist(next);
      return next;
    });
  };

  return (
    <div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={items.map((it) => it.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-2">
            {items.map((it) => (
              <SortableRow
                key={it.id}
                item={it}
                draft={
                  editing && !editing.isNew && editing.id === it.id
                    ? editing
                    : null
                }
                onEdit={() =>
                  setEditing({
                    id: it.id,
                    label: it.label,
                    instruction: it.instruction,
                    isNew: false,
                  })
                }
                onChange={changeDraft}
                onCancel={() => setEditing(null)}
                onSave={save}
                onDelete={() => remove(it.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {editing?.isNew ? (
        <div className="mt-2.5">
          <PresetForm
            draft={editing}
            onChange={changeDraft}
            onCancel={() => setEditing(null)}
            onSave={save}
          />
        </div>
      ) : (
        <button
          onClick={() =>
            setEditing({ id: newId(), label: "", instruction: "", isNew: true })
          }
          className="mt-2.5 w-full flex items-center justify-center gap-1.5 py-2.5 text-sm text-text-muted hover:text-text border border-dashed border-border rounded-[10px] hover:bg-bg-muted transition-colors"
        >
          <PlusIcon className="w-4 h-4 stroke-[1.6]" />
          New quick action
        </button>
      )}
    </div>
  );
}
