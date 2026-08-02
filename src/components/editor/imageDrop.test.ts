import { describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import StarterKit from "@tiptap/starter-kit";
import {
  filterSupportedImagePaths,
  importDroppedImagePaths,
  physicalToLogicalPoint,
  resolveBlockDropTarget,
  resolveEditorBlockDropTarget,
  resolveImageDropPosition,
} from "./imageDrop";

describe("image drag and drop adapter", () => {
  it("keeps only image paths accepted by the Scratch backend", () => {
    expect(
      filterSupportedImagePaths([
        "/tmp/photo.PNG",
        "/tmp/diagram.svg",
        "/tmp/archive.png.zip",
        "/tmp/note.md",
        "C:\\Temp\\scan.TIFF",
        "/tmp/no-extension",
      ]),
    ).toEqual([
      "/tmp/photo.PNG",
      "/tmp/diagram.svg",
      "C:\\Temp\\scan.TIFF",
    ]);
  });

  it("converts Tauri physical drop coordinates to browser logical pixels", () => {
    expect(physicalToLogicalPoint({ x: 840, y: 520 }, 2)).toEqual({
      x: 420,
      y: 260,
    });
    expect(physicalToLogicalPoint({ x: 105, y: 51 }, 1.5)).toEqual({
      x: 70,
      y: 34,
    });
  });

  it("inserts only when the native drop point is inside the editor", () => {
    const editorRect = { left: 200, top: 100, right: 900, bottom: 700 };
    const posAtCoords = vi.fn(() => ({ pos: 27 }));

    expect(
      resolveImageDropPosition(
        { x: 450, y: 240 },
        editorRect,
        posAtCoords,
        8,
      ),
    ).toBe(27);
    expect(posAtCoords).toHaveBeenCalledWith({ left: 450, top: 240 });

    expect(
      resolveImageDropPosition(
        { x: 120, y: 240 },
        editorRect,
        posAtCoords,
        8,
      ),
    ).toBeNull();
  });

  it("uses the current selection when posAtCoords cannot resolve an editor gap", () => {
    expect(
      resolveImageDropPosition(
        { x: 300, y: 200 },
        { left: 0, top: 0, right: 600, bottom: 500 },
        () => null,
        19,
      ),
    ).toBe(19);
  });

  it("keeps dropped images after the leading note title", () => {
    expect(
      resolveImageDropPosition(
        { x: 300, y: 120 },
        { left: 0, top: 0, right: 600, bottom: 500 },
        () => ({ pos: 0 }),
        0,
        14,
      ),
    ).toBe(14);

    expect(
      resolveImageDropPosition(
        { x: 300, y: 450 },
        { left: 0, top: 0, right: 600, bottom: 500 },
        () => ({ pos: 42 }),
        0,
        14,
      ),
    ).toBe(42);
  });

  it("snaps an image drop to the closest boundary between text blocks", () => {
    const blocks = [
      { before: 0, after: 12, top: 100, bottom: 140 },
      { before: 12, after: 30, top: 160, bottom: 190 },
      { before: 30, after: 50, top: 210, bottom: 240 },
    ];
    const editorRect = { left: 200, top: 80, right: 900, bottom: 500 };

    expect(
      resolveBlockDropTarget(
        { x: 450, y: 151 },
        editorRect,
        blocks,
        18,
        12,
      ),
    ).toEqual({ position: 12, top: 150 });
    expect(
      resolveBlockDropTarget(
        { x: 450, y: 202 },
        editorRect,
        blocks,
        18,
        12,
      ),
    ).toEqual({ position: 30, top: 200 });
    expect(
      resolveBlockDropTarget(
        { x: 450, y: 238 },
        editorRect,
        blocks,
        18,
        12,
      ),
    ).toEqual({ position: 50, top: 240 });
  });

  it("accepts a drop after the last paragraph anywhere in the document body", () => {
    expect(
      resolveEditorBlockDropTarget(
        { x: 1080, y: 620 },
        { left: 240, top: 80, right: 960, bottom: 260 },
        { left: 0, top: 80, right: 1200, bottom: 800 },
        [
          { before: 0, after: 12, top: 100, bottom: 140 },
          { before: 12, after: 36, top: 165, bottom: 220 },
        ],
        20,
        12,
      ),
    ).toEqual({ position: 36, top: 220 });
  });

  it("accepts a drop below the last paragraph after the document is scrolled", () => {
    expect(
      resolveEditorBlockDropTarget(
        { x: 428, y: 744 },
        { left: 384, top: -1592, right: 1152, bottom: 800 },
        { left: 256, top: -1592, right: 1280, bottom: -873 },
        [
          { before: 0, after: 12, top: -1560, bottom: -840 },
          { before: 12, after: 36, top: 680, bottom: 704 },
        ],
        20,
        12,
      ),
    ).toEqual({ position: 36, top: 704 });
  });

  it("copies supported images sequentially and inserts them in drop order", async () => {
    const copyImageToAssets = vi
      .fn<(path: string) => Promise<string>>()
      .mockImplementation(async (path) => `assets/${path.split("/").pop()}`);
    const resolveAssetUrl = vi
      .fn<(relativePath: string) => Promise<string>>()
      .mockImplementation(async (relativePath) => `asset://${relativePath}`);
    const insertImage = vi.fn<(src: string, position: number) => void>();

    const result = await importDroppedImagePaths(
      ["/tmp/first.png", "/tmp/ignore.txt", "/tmp/second.webp"],
      12,
      { copyImageToAssets, resolveAssetUrl, insertImage },
    );

    expect(result).toEqual({ imported: 2, failed: 0 });
    expect(copyImageToAssets.mock.calls).toEqual([
      ["/tmp/first.png"],
      ["/tmp/second.webp"],
    ]);
    expect(insertImage.mock.calls).toEqual([
      ["asset://assets/first.png", 12],
      ["asset://assets/second.webp", 13],
    ]);
  });

  it("creates a rendered Tiptap image node from the imported asset URL", async () => {
    const editor = new Editor({
      extensions: [StarterKit, Image.configure({ allowBase64: false })],
      content: "<p>Drop target</p>",
    });

    const result = await importDroppedImagePaths(
      ["/tmp/rendered.png"],
      0,
      {
        copyImageToAssets: async () => "assets/rendered.png",
        resolveAssetUrl: async () =>
          "asset://localhost/notes/assets/rendered.png",
        insertImage: (src, position) => {
          const inserted = editor.commands.insertContentAt(position, {
            type: "image",
            attrs: { src },
          });
          if (!inserted) throw new Error("image insertion failed");
        },
      },
    );

    expect(result).toEqual({ imported: 1, failed: 0 });
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: "image",
      attrs: { src: "asset://localhost/notes/assets/rendered.png" },
    });
    expect(editor.view.dom.querySelector("img")?.getAttribute("src")).toBe(
      "asset://localhost/notes/assets/rendered.png",
    );

    editor.destroy();
  });

  it("inserts an image block after a body paragraph", async () => {
    const editor = new Editor({
      extensions: [StarterKit, Image.configure({ allowBase64: false })],
      content: "<h1>Title</h1><p>First paragraph</p><p>Second paragraph</p>",
    });
    const titleSize = editor.state.doc.child(0).nodeSize;
    const firstParagraphSize = editor.state.doc.child(1).nodeSize;
    const afterFirstParagraph = titleSize + firstParagraphSize;

    const result = await importDroppedImagePaths(
      ["/tmp/after-paragraph.png"],
      afterFirstParagraph,
      {
        copyImageToAssets: async () => "assets/after-paragraph.png",
        resolveAssetUrl: async (relativePath) => `asset://${relativePath}`,
        insertImage: (src, position) => {
          const inserted = editor.commands.insertContentAt(position, {
            type: "image",
            attrs: { src },
          });
          if (!inserted) throw new Error("image insertion failed");
        },
      },
    );

    expect(result).toEqual({ imported: 1, failed: 0 });
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual([
      "heading",
      "paragraph",
      "image",
      "paragraph",
    ]);

    editor.destroy();
  });

  it("inserts an image after the last body paragraph", async () => {
    const editor = new Editor({
      extensions: [StarterKit, Image.configure({ allowBase64: false })],
      content: "<h1>Title</h1><p>Last paragraph</p>",
    });

    const result = await importDroppedImagePaths(
      ["/tmp/after-last-paragraph.png"],
      editor.state.doc.content.size,
      {
        copyImageToAssets: async () => "assets/after-last-paragraph.png",
        resolveAssetUrl: async (relativePath) => `asset://${relativePath}`,
        insertImage: (src, position) => {
          const inserted = editor.commands.insertContentAt(position, {
            type: "image",
            attrs: { src },
          });
          if (!inserted) throw new Error("image insertion failed");
        },
      },
    );

    expect(result).toEqual({ imported: 1, failed: 0 });
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual([
      "heading",
      "paragraph",
      "image",
      "paragraph",
    ]);

    editor.destroy();
  });

  it("continues importing later images when one copy fails", async () => {
    const onError = vi.fn();
    const insertImage = vi.fn<(src: string, position: number) => void>();

    const result = await importDroppedImagePaths(
      ["/tmp/broken.png", "/tmp/good.jpg"],
      4,
      {
        copyImageToAssets: async (path) => {
          if (path.endsWith("broken.png")) throw new Error("copy failed");
          return "assets/good.jpg";
        },
        resolveAssetUrl: async (relativePath) => `asset://${relativePath}`,
        insertImage,
        onError,
      },
    );

    expect(result).toEqual({ imported: 1, failed: 1 });
    expect(insertImage).toHaveBeenCalledWith("asset://assets/good.jpg", 4);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toBe("/tmp/broken.png");
  });
});
