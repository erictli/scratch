import { createHighlighterCoreSync } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import type { HighlighterCore } from "shiki/core";

// Language grammar imports — static so Vite bundles only these 9 grammars
import bashGrammar from "shiki/dist/langs/bash.mjs";
import cssGrammar from "shiki/dist/langs/css.mjs";
import htmlGrammar from "shiki/dist/langs/html.mjs";
import jsGrammar from "shiki/dist/langs/javascript.mjs";
import jsonGrammar from "shiki/dist/langs/json.mjs";
import mdGrammar from "shiki/dist/langs/markdown.mjs";
import rustGrammar from "shiki/dist/langs/rust.mjs";
import tsxGrammar from "shiki/dist/langs/tsx.mjs";
import tsGrammar from "shiki/dist/langs/typescript.mjs";

// Theme imports — static so Vite bundles only these 2 themes
import githubLight from "shiki/dist/themes/github-light.mjs";
import githubDark from "shiki/dist/themes/github-dark.mjs";

// Language aliases (e.g. ```js -> javascript)
const LANG_ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  sh: "bash",
  shell: "bash",
  md: "markdown",
  htm: "html",
};

const SUPPORTED_LANGS = new Set([
  "bash",
  "css",
  "html",
  "javascript",
  "json",
  "markdown",
  "rust",
  "tsx",
  "typescript",
]);

/** Normalises a fenced code-block language tag to a Shiki lang id, or null for plain text. */
export function normalizeLanguage(lang: string | null | undefined): string | null {
  if (!lang) return null;
  const lower = lang.toLowerCase().trim();
  const resolved = LANG_ALIASES[lower] ?? lower;
  return SUPPORTED_LANGS.has(resolved) ? resolved : null;
}

// Synchronous singleton — created once at module load time
let _highlighter: HighlighterCore | null = null;

function getHighlighter(): HighlighterCore {
  if (!_highlighter) {
    _highlighter = createHighlighterCoreSync({
      engine: createJavaScriptRegexEngine(),
      themes: [githubLight, githubDark],
      langs: [
        bashGrammar,
        cssGrammar,
        htmlGrammar,
        jsGrammar,
        jsonGrammar,
        mdGrammar,
        rustGrammar,
        tsxGrammar,
        tsGrammar,
      ],
    });
  }
  return _highlighter;
}

// Kick off creation eagerly so it's ready before the first keystroke
let _ready = false;

export function initHighlighter(): void {
  if (!_ready) {
    _ready = true;
    getHighlighter(); // synchronous — runs immediately
  }
}

/** Returns the cached highlighter (always available after initHighlighter()). */
export function getHighlighterSync(): HighlighterCore | null {
  return _highlighter;
}

