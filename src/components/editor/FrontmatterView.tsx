import { useEffect, useMemo, useState } from "react";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";

interface FrontmatterField {
  key: string;
  kind: "scalar" | "list";
  values: string[];
}

const preferredFieldOrder = ["aliases", "tags", "created", "updated"];

function parseInlineList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.replace(/^['"]|['"]$/g, ""));
}

function parseFrontmatterText(text: string): FrontmatterField[] {
  const fields: FrontmatterField[] = [];
  const lines = text.split(/\r?\n/);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const match = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!match) {
      i += 1;
      continue;
    }

    const key = match[1];
    const value = match[2].trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      fields.push({
        key,
        kind: "list",
        values: parseInlineList(value.slice(1, -1)),
      });
      i += 1;
      continue;
    }

    if (!value) {
      const values: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const listMatch = lines[j].match(/^\s*-\s*(.+)\s*$/);
        if (!listMatch) break;
        values.push(listMatch[1].trim().replace(/^['"]|['"]$/g, ""));
        j += 1;
      }
      if (values.length > 0) {
        fields.push({ key, kind: "list", values });
        i = j;
        continue;
      }
      fields.push({ key, kind: "scalar", values: [""] });
      i += 1;
      continue;
    }

    fields.push({
      key,
      kind: "scalar",
      values: [value.replace(/^['"]|['"]$/g, "")],
    });
    i += 1;
  }

  const orderIndex = (fieldKey: string) => {
    const idx = preferredFieldOrder.indexOf(fieldKey.toLowerCase());
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
  };
  fields.sort((a, b) => {
    const byOrder = orderIndex(a.key) - orderIndex(b.key);
    return byOrder !== 0 ? byOrder : a.key.localeCompare(b.key);
  });
  return fields;
}

function encodeYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '""';
  if (/[:#\[\]\{\},&*!|>'"%@`]/.test(trimmed) || /^\s|\s$/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function serializeFrontmatter(fields: FrontmatterField[]): string {
  const normalized = fields
    .map((field) => ({
      ...field,
      key: field.key.trim(),
      values: field.values.map((v) => v.trim()).filter(Boolean),
    }))
    .filter((field) => field.key.length > 0);

  const lines: string[] = [];
  for (const field of normalized) {
    if (field.kind === "list") {
      if (field.values.length === 0) {
        lines.push(`${field.key}: []`);
      } else {
        lines.push(`${field.key}:`);
        for (const value of field.values) {
          lines.push(`  - ${encodeYamlScalar(value)}`);
        }
      }
      continue;
    }

    lines.push(`${field.key}: ${encodeYamlScalar(field.values[0] ?? "")}`);
  }

  return lines.join("\n");
}

function toCsv(values: string[]): string {
  return values.join(", ");
}

function fromCsv(input: string): string[] {
  return input
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function FrontmatterView({ editor, node, getPos }: ReactNodeViewProps) {
  const [fields, setFields] = useState<FrontmatterField[]>(() =>
    parseFrontmatterText(node.textContent || ""),
  );
  const [showRaw, setShowRaw] = useState(false);
  const [rawYaml, setRawYaml] = useState(node.textContent || "");

  useEffect(() => {
    const parsed = parseFrontmatterText(node.textContent || "");
    setFields(parsed);
    setRawYaml(node.textContent || "");
  }, [node.textContent]);

  const hasTags = useMemo(
    () =>
      fields.find((field) => field.key.toLowerCase() === "tags" && field.kind === "list")
        ?.values || [],
    [fields],
  );

  const replaceNodeText = (nextYaml: string) => {
    const pos = typeof getPos === "function" ? getPos() : null;
    if (typeof pos !== "number") return;

    const frontmatterType = editor.schema.nodes.frontmatter;
    const content = nextYaml ? [editor.schema.text(nextYaml)] : [];
    const nextNode = frontmatterType.create(node.attrs, content);
    const tr = editor.state.tr.replaceWith(pos, pos + node.nodeSize, nextNode);
    editor.view.dispatch(tr);
  };

  const updateFields = (nextFields: FrontmatterField[]) => {
    setFields(nextFields);
    const yaml = serializeFrontmatter(nextFields);
    setRawYaml(yaml);
    replaceNodeText(yaml);
  };

  return (
    <NodeViewWrapper className="frontmatter-card not-prose" contentEditable={false}>
      <div className="frontmatter-card-header">
        <div className="frontmatter-card-title">Metadata</div>
        <button
          className="frontmatter-toggle-btn"
          onClick={() => setShowRaw((v) => !v)}
          type="button"
        >
          {showRaw ? "Hide Raw YAML" : "Show Raw YAML"}
        </button>
      </div>

      <div className="frontmatter-fields">
        {fields.map((field, idx) => {
          const csvValue = toCsv(field.values);
          const isTagLike = field.key.toLowerCase() === "tags";
          return (
            <div key={`${field.key}-${idx}`} className="frontmatter-row">
              <input
                className="frontmatter-key"
                value={field.key}
                onChange={(e) => {
                  const next = [...fields];
                  next[idx] = { ...field, key: e.target.value };
                  updateFields(next);
                }}
                placeholder="key"
              />
              <input
                className="frontmatter-value"
                value={csvValue}
                onChange={(e) => {
                  const next = [...fields];
                  next[idx] = {
                    ...field,
                    values: field.kind === "list" ? fromCsv(e.target.value) : [e.target.value],
                  };
                  updateFields(next);
                }}
                placeholder={field.kind === "list" ? "item1, item2" : "value"}
              />
              <button
                className="frontmatter-remove-btn"
                type="button"
                onClick={() => {
                  const next = fields.filter((_, i) => i !== idx);
                  updateFields(next);
                }}
              >
                Remove
              </button>
              {isTagLike && field.values.length > 0 && (
                <div className="frontmatter-tag-list">
                  {field.values.map((tag) => (
                    <span key={tag} className="frontmatter-tag-chip">
                      #{tag.replace(/^#/, "")}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="frontmatter-actions">
        <button
          className="frontmatter-add-btn"
          type="button"
          onClick={() =>
            updateFields([
              ...fields,
              { key: `field${fields.length + 1}`, kind: "scalar", values: [""] },
            ])
          }
        >
          Add Field
        </button>
        {hasTags.length > 0 && (
          <span className="frontmatter-tag-summary">{hasTags.length} tags</span>
        )}
      </div>

      {showRaw && (
        <textarea
          className="frontmatter-raw"
          value={rawYaml}
          onChange={(e) => {
            const value = e.target.value;
            setRawYaml(value);
            setFields(parseFrontmatterText(value));
            replaceNodeText(value);
          }}
          rows={8}
          spellCheck={false}
        />
      )}
    </NodeViewWrapper>
  );
}
