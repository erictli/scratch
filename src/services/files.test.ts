import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { recreateFileDirect, saveFileDirect } from "./files";

describe("saveFileDirect", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("sends the revision loaded by the standalone editor", async () => {
    invokeMock.mockResolvedValueOnce({
      status: "saved",
      file: {
        path: "/tmp/External.md",
        content: "# External\n\nUpdated",
        title: "External",
        modified: 1,
        revision: "revision-2",
      },
    });

    await saveFileDirect(
      "/tmp/External.md",
      "# External\n\nUpdated",
      "revision-1",
    );

    expect(invokeMock).toHaveBeenCalledWith("save_file_direct", {
      path: "/tmp/External.md",
      content: "# External\n\nUpdated",
      expectedRevision: "revision-1",
    });
  });
});

describe("recreateFileDirect", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("requests a create-only recreation without an expected revision", async () => {
    invokeMock.mockResolvedValueOnce({
      status: "saved",
      file: {
        path: "/tmp/Deleted.md",
        content: "# Deleted\n\nRecovered draft",
        title: "Deleted",
        modified: 2,
        revision: "recreated-revision",
      },
    });

    const result = await recreateFileDirect(
      "/tmp/Deleted.md",
      "# Deleted\n\nRecovered draft",
    );

    expect(invokeMock).toHaveBeenCalledWith("recreate_file_direct", {
      path: "/tmp/Deleted.md",
      content: "# Deleted\n\nRecovered draft",
    });
    expect(result).toMatchObject({
      status: "saved",
      file: { revision: "recreated-revision" },
    });
  });
});
