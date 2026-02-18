export function plainTextFromMarkdown(markdown: string): string {
  let inCodeBlock = false;
  const lines = markdown.split(/\r?\n/);
  const plainLines = lines.map((line) => {
    let text = line;

    if (/^\s*(```|~~~)/.test(text)) {
      inCodeBlock = !inCodeBlock;
      return "";
    }

    if (inCodeBlock) {
      return text;
    }

    text = text.replace(/^\s{0,3}#{1,6}\s+/, "");
    text = text.replace(/^\s{0,3}>\s?/, "");
    text = text.replace(/^\s*([-*+]\s+|\d+\.\s+)/, "");
    text = text.replace(/^\s*([*-]){3,}\s*$/, "");

    text = text.replace(/!\[(.*?)\]\([^)]*\)/g, "$1");
    text = text.replace(/\[(.+?)\]\([^)]*\)/g, "$1");
    text = text.replace(/`([^`]+)`/g, "$1");
    text = text.replace(/\*\*(.+?)\*\*/g, "$1");
    text = text.replace(/(?<!\w)__(.+?)__(?!\w)/g, "$1");
    text = text.replace(/\*(.+?)\*/g, "$1");
    text = text.replace(/(?<!\w)_(.+?)_(?!\w)/g, "$1");
    text = text.replace(/~~(.+?)~~/g, "$1");

    return text;
  });

  return plainLines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}
