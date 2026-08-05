import { Editor } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import {
  getImageOpenTarget,
  handleImageDoubleClick,
} from "./imageInteractions";

describe("image interactions", () => {
  it("keeps Tauri asset URLs opaque for backend validation", () => {
    expect(
      getImageOpenTarget(
        "asset://localhost/%2FUsers%2Fmael%2FNotes%2Fassets%2Fphoto.png",
      ),
    ).toEqual({
      kind: "local-asset",
      source:
        "asset://localhost/%2FUsers%2Fmael%2FNotes%2Fassets%2Fphoto.png",
    });
    expect(
      getImageOpenTarget(
        "http://asset.localhost/%2FUsers%2Fmael%2FNotes%2Fassets%2Fphoto.png",
      ),
    ).toEqual({
      kind: "local-asset",
      source:
        "http://asset.localhost/%2FUsers%2Fmael%2FNotes%2Fassets%2Fphoto.png",
    });
  });

  it("keeps ordinary HTTP and HTTPS images as external URLs", () => {
    expect(getImageOpenTarget("https://example.com/photo.png")).toEqual({
      kind: "external-url",
      value: "https://example.com/photo.png",
    });
    expect(getImageOpenTarget("http://example.com/photo.png")).toEqual({
      kind: "external-url",
      value: "http://example.com/photo.png",
    });
  });

  it("rejects unsupported URL schemes", () => {
    expect(getImageOpenTarget("file:///etc/passwd")).toBeNull();
    expect(getImageOpenTarget("javascript:alert(1)")).toBeNull();
  });

  it("prevents native double-click selection on an editor image", () => {
    const editor = new Editor({
      extensions: [StarterKit, Image.configure({ inline: false })],
      content: '<p>Before</p><img src="asset://localhost/assets/photo.png">',
    });
    const image = editor.view.dom.querySelector("img");
    if (!image) throw new Error("Missing image element");
    const event = new MouseEvent("dblclick", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "target", { value: image });

    try {
      editor.commands.setNodeSelection(editor.state.doc.child(0).nodeSize);
      expect(handleImageDoubleClick(editor.view, event)).toBe(true);
      expect(event.defaultPrevented).toBe(true);
    } finally {
      editor.destroy();
    }
  });

  it("ends an image double-click on a normal text cursor", () => {
    const editor = new Editor({
      extensions: [StarterKit, Image.configure({ inline: false })],
      content: '<p>Before</p><img src="asset://localhost/assets/photo.png"><p>After</p>',
    });
    const image = editor.view.dom.querySelector("img");
    if (!image) throw new Error("Missing image element");
    const event = new MouseEvent("dblclick", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "target", { value: image });

    try {
      const imagePosition = editor.state.doc.child(0).nodeSize;
      editor.commands.setNodeSelection(imagePosition);
      expect(editor.state.selection).toBeInstanceOf(NodeSelection);

      expect(handleImageDoubleClick(editor.view, event)).toBe(true);
      expect(editor.state.selection).toBeInstanceOf(TextSelection);
      expect(editor.state.selection.empty).toBe(true);
      expect(editor.state.selection.from).toBeGreaterThan(imagePosition);
    } finally {
      editor.destroy();
    }
  });
});
