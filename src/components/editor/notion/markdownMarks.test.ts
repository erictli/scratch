import { Editor } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import {
  HIGHLIGHT_COLOR_OPTIONS,
  ScratchColor,
  ScratchHighlight,
  ScratchSubscript,
  ScratchSuperscript,
  ScratchTextStyle,
  TEXT_COLOR_OPTIONS,
  isSafeEditorColor,
} from "./markdownMarks";

function createMarkdownEditor() {
  return new Editor({
    extensions: [
      StarterKit,
      ScratchTextStyle,
      ScratchColor,
      ScratchHighlight.configure({ multicolor: true }),
      ScratchSubscript,
      ScratchSuperscript,
      Markdown,
    ],
  });
}

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4,
    );
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [
    relativeLuminance(first),
    relativeLuminance(second),
  ].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("Scratch Markdown marks", () => {
  it.each([
    ["light", "#ffffff"],
    ["dark", "#161413"],
  ] as const)(
    "keeps every %s text color WCAG AA on editor and highlight surfaces",
    (theme, editorSurface) => {
      const textColors = [
        ...TEXT_COLOR_OPTIONS.map((color) => ({
          value: color.value,
          rendered: color[theme],
        })),
        {
          value: "default",
          rendered: theme === "light" ? "#1c1917" : "#fafaf9",
        },
      ];

      for (const textColor of textColors) {
        expect(
          contrastRatio(textColor.rendered, editorSurface),
          `${textColor.value} on ${theme} editor`,
        ).toBeGreaterThanOrEqual(4.5);

        for (const highlightColor of HIGHLIGHT_COLOR_OPTIONS) {
          expect(
            contrastRatio(textColor.rendered, highlightColor[theme]),
            `${textColor.value} on ${highlightColor.value} in ${theme}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    },
  );

  it("round-trips text color and plain or colored highlights", () => {
    const editor = createMarkdownEditor();

    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "red",
              marks: [{ type: "textStyle", attrs: { color: "#dc2626" } }],
            },
            { type: "text", text: " and " },
            {
              type: "text",
              text: "yellow",
              marks: [{ type: "highlight", attrs: { color: "#fde047" } }],
            },
            { type: "text", text: " and " },
            {
              type: "text",
              text: "plain",
              marks: [{ type: "highlight" }],
            },
          ],
        },
      ],
    });

    const markdown = editor.getMarkdown();
    const parsed = editor.storage.markdown.manager.parse(markdown);
    const content = parsed.content?.[0]?.content ?? [];

    expect(markdown).toContain('<span style="color: #dc2626">red</span>');
    expect(markdown).toContain(
      '<mark data-color="#fde047" style="background-color: #fde047; color: inherit">yellow</mark>',
    );
    expect(markdown).toContain("==plain==");
    expect(content[0]?.marks).toEqual([
      { type: "textStyle", attrs: { color: "#dc2626" } },
    ]);
    expect(content[2]?.marks).toEqual([
      { type: "highlight", attrs: { color: "#fde047" } },
    ]);
    expect(content[4]?.marks?.[0]?.type).toBe("highlight");
    expect(content[4]?.marks?.[0]?.attrs?.color ?? null).toBeNull();

    editor.destroy();
  });

  it("round-trips text color and highlight together on the same text", () => {
    const editor = createMarkdownEditor();

    editor.commands.setContent("<p>combined</p>");
    editor.commands.setTextSelection({ from: 1, to: 9 });
    editor.chain().setColor("#dc2626").setHighlight({ color: "#fde047" }).run();

    const markdown = editor.getMarkdown();
    const parsed = editor.storage.markdown.manager.parse(markdown);
    const marks = parsed.content?.[0]?.content?.[0]?.marks ?? [];

    expect(marks.map((mark) => mark.type)).toEqual(
      expect.arrayContaining(["textStyle", "highlight"]),
    );
    expect(markdown).toContain("#dc2626");
    expect(markdown).toContain("#fde047");

    editor.commands.setContent(markdown, { contentType: "markdown" });
    const reloadedText = editor.state.doc.child(0).child(0);
    expect(reloadedText.textContent).toBe("combined");
    expect(
      reloadedText.marks.find((mark) => mark.type.name === "textStyle")?.attrs
        .color,
    ).toBe("#dc2626");
    expect(
      reloadedText.marks.find((mark) => mark.type.name === "highlight")?.attrs
        .color,
    ).toBe("#fde047");
    expect(editor.getMarkdown()).toBe(markdown);

    editor.destroy();
  });

  it("exposes the highlight color as a safe theme token in the editor DOM", () => {
    const editor = createMarkdownEditor();

    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "highlighted",
              marks: [{ type: "highlight", attrs: { color: "#fde047" } }],
            },
          ],
        },
      ],
    });

    const mark = editor.view.dom.querySelector("mark");
    expect(mark?.style.getPropertyValue("--scratch-highlight-color-light")).toBe(
      "#fef9c3",
    );
    expect(mark?.style.getPropertyValue("--scratch-highlight-color-dark")).toBe(
      "#33301c",
    );

    editor.destroy();
  });

  it("renders canonical text color through light and dark theme tokens", () => {
    const editor = createMarkdownEditor();

    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "red",
              marks: [{ type: "textStyle", attrs: { color: "#dc2626" } }],
            },
          ],
        },
      ],
    });

    const coloredText = editor.view.dom.querySelector<HTMLElement>(
      '[data-text-color="#dc2626"]',
    );
    expect(coloredText?.style.getPropertyValue("--scratch-text-color-light")).toBe(
      "#b91c1c",
    );
    expect(coloredText?.style.getPropertyValue("--scratch-text-color-dark")).toBe(
      "#fca5a5",
    );

    editor.destroy();
  });

  it("rejects values that could inject arbitrary CSS", () => {
    expect(isSafeEditorColor("#dc2626")).toBe(true);
    expect(isSafeEditorColor("#DC2626")).toBe(true);
    expect(isSafeEditorColor("red")).toBe(false);
    expect(isSafeEditorColor("#fff; background:url(javascript:alert(1))")).toBe(
      false,
    );
  });

  it("drops an unsafe stored color instead of serializing it", () => {
    const editor = createMarkdownEditor();

    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "safe text",
              marks: [
                {
                  type: "textStyle",
                  attrs: { color: "red; background:url(javascript:alert(1))" },
                },
              ],
            },
          ],
        },
      ],
    });

    expect(editor.getMarkdown()).toBe("safe text");
    editor.destroy();
  });

  it("rejects an unsafe highlight color while parsing inline HTML", () => {
    const editor = createMarkdownEditor();
    const parsed = editor.storage.markdown.manager.parse(
      '<mark data-color="#fde047; background-image:url(https://example.invalid/x)">unsafe</mark>',
    );
    const mark = parsed.content?.[0]?.content?.[0]?.marks?.[0];
    const serialized = editor.storage.markdown.manager.serialize(parsed);

    expect(mark?.type).toBe("highlight");
    expect(mark?.attrs?.color ?? null).toBeNull();
    expect(serialized).not.toContain("example.invalid");
    editor.destroy();
  });

  it("round-trips subscript and superscript as safe inline HTML", () => {
    const editor = createMarkdownEditor();

    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "H" },
            { type: "text", text: "2", marks: [{ type: "subscript" }] },
            { type: "text", text: "O and x" },
            { type: "text", text: "2", marks: [{ type: "superscript" }] },
          ],
        },
      ],
    });

    const markdown = editor.getMarkdown();
    const parsed = editor.storage.markdown.manager.parse(markdown);
    const content = parsed.content?.[0]?.content ?? [];

    expect(markdown).toBe("H<sub>2</sub>O and x<sup>2</sup>");
    expect(content[1]?.marks?.[0]?.type).toBe("subscript");
    expect(content[3]?.marks?.[0]?.type).toBe("superscript");
    editor.destroy();
  });
});
