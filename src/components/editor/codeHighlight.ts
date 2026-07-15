import hljs from "highlight.js/lib/core";
import { LANGUAGE_MODULES } from "./lowlight";

// Register the same language modules used for in-editor code blocks (see lowlight.ts)
// against highlight.js core directly, for the read-only view of plain-text/code notes.
for (const [names, module] of LANGUAGE_MODULES) {
  const [primary, ...aliases] = names;
  hljs.registerLanguage(primary, module);
  if (aliases.length > 0) {
    hljs.registerAliases(aliases, { languageName: primary });
  }
}

// A handful of file extensions map to a different highlight.js language name
// than the extension itself (the rest fall through to `extension` unchanged,
// since lowlight.ts already registers those exact short names/aliases).
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  h: "c",
  patch: "diff",
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Returns syntax-highlighted HTML for the given code, or escaped plain text on failure. */
export function highlightCode(code: string, extension: string): string {
  const language = EXTENSION_TO_LANGUAGE[extension.toLowerCase()] ?? extension.toLowerCase();
  if (hljs.getLanguage(language)) {
    try {
      return hljs.highlight(code, { language }).value;
    } catch {
      // Fall through to plain escaped text below.
    }
  }
  return escapeHtml(code);
}
