import { describe, expect, it, vi } from "vitest";
import { recreateDeletedStandaloneDraft } from "./standaloneRecreation";

describe("recreateDeletedStandaloneDraft", () => {
  it("returns the saved file snapshot after create-only recreation", async () => {
    const recreate = vi.fn(async () => ({
      status: "saved" as const,
      file: {
        path: "/tmp/Deleted.md",
        content: "# Deleted\n\nLocal draft",
        title: "Deleted",
        modified: 2,
        revision: "created-revision",
      },
    }));

    const file = await recreateDeletedStandaloneDraft(
      "/tmp/Deleted.md",
      "# Deleted\n\nLocal draft",
      recreate,
    );

    expect(file.revision).toBe("created-revision");
    expect(recreate).toHaveBeenCalledWith(
      "/tmp/Deleted.md",
      "# Deleted\n\nLocal draft",
    );
  });

  it("rejects a concurrent recreation so the conflict UI and recovery remain", async () => {
    const recreate = vi.fn(async () => ({
      status: "conflict" as const,
      current: {
        content: "# Deleted\n\nRecreated elsewhere",
        revision: "concurrent-revision",
      },
    }));

    await expect(
      recreateDeletedStandaloneDraft(
        "/tmp/Deleted.md",
        "# Deleted\n\nLocal draft",
        recreate,
      ),
    ).rejects.toThrow("source path was recreated elsewhere");
  });
});
