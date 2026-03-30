import { describe, expect, test } from "bun:test";
import { computeDiffStats } from "./diffStats";

describe("computeDiffStats", () => {
  test("treats empty content as zero lines", () => {
    expect(computeDiffStats("", "")).toEqual({
      added: 0,
      removed: 0,
      changed: 0,
    });
  });

  test("reports pure additions without phantom changed lines", () => {
    expect(computeDiffStats("", "hello\nworld")).toEqual({
      added: 2,
      removed: 0,
      changed: 0,
    });
  });

  test("ignores trailing whitespace-only formatting noise", () => {
    expect(computeDiffStats("hello  \n\n", "hello")).toEqual({
      added: 0,
      removed: 0,
      changed: 0,
    });
  });
});
