import { describe, expect, test } from "bun:test";
import { applyHistoryCompareBase } from "./historyCompare";

describe("applyHistoryCompareBase", () => {
  test("restores editability when target snapshot is missing", () => {
    const calls: string[] = [];
    const editor = {
      setEditable(editable: boolean) {
        calls.push(`editable:${editable}`);
      },
      commands: {
        setContent() {
          calls.push("setContent");
        },
      },
    };

    const result = applyHistoryCompareBase(editor, null);

    expect(result).toBe(false);
    expect(calls).toEqual(["editable:false", "editable:true"]);
  });

  test("loads target content and stays read-only when snapshot exists", () => {
    const calls: string[] = [];
    const editor = {
      setEditable(editable: boolean) {
        calls.push(`editable:${editable}`);
      },
      commands: {
        setContent() {
          calls.push("setContent");
        },
      },
    };

    const result = applyHistoryCompareBase(editor, { type: "doc", content: [] });

    expect(result).toBe(true);
    expect(calls).toEqual(["editable:false", "setContent"]);
  });
});
