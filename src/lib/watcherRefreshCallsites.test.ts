import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("watcher-driven refresh call sites", () => {
  it("handles settings refresh failures in the note list", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/notes/NoteList.tsx"),
      "utf8",
    );
    const refreshStart = source.indexOf("const refreshSettings");
    const refreshEnd = source.indexOf("useEffect", refreshStart);

    expect(refreshStart).toBeGreaterThan(-1);
    expect(refreshEnd).toBeGreaterThan(refreshStart);
    expect(source.slice(refreshStart, refreshEnd)).toContain(".catch(");
  });

  it("debounces note-list refreshes from file watcher events", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/context/NotesContext.tsx"),
      "utf8",
    );
    const listenerStart = source.indexOf('>("file-change"');
    const listenerEnd = source.indexOf("}).then", listenerStart);
    const listenerSource = source.slice(listenerStart, listenerEnd);

    expect(listenerStart).toBeGreaterThan(-1);
    expect(listenerEnd).toBeGreaterThan(listenerStart);
    expect(listenerSource).toContain("scheduleRefresh();");
    expect(listenerSource).not.toContain("void refreshNotes();");
  });
});
