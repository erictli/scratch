import { createLowlight } from "lowlight";
import type { LanguageFn } from "highlight.js";

// Import only common languages to keep bundle small
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import json from "highlight.js/lib/languages/json";
import sql from "highlight.js/lib/languages/sql";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";
import bash from "highlight.js/lib/languages/bash";
import markdown from "highlight.js/lib/languages/markdown";
import yaml from "highlight.js/lib/languages/yaml";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import cpp from "highlight.js/lib/languages/cpp";
import c from "highlight.js/lib/languages/c";
import swift from "highlight.js/lib/languages/swift";
import ruby from "highlight.js/lib/languages/ruby";
import php from "highlight.js/lib/languages/php";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";

// Shared language-module registry, reused by both the lowlight instance below
// (for in-editor code blocks) and codeHighlight.ts (for the plain-text/code note
// read view) so the two never drift out of sync.
export const LANGUAGE_MODULES: [string[], LanguageFn][] = [
  [["javascript", "js", "jsx"], javascript],
  [["typescript", "ts", "tsx"], typescript],
  [["python", "py"], python],
  [["rust", "rs"], rust],
  [["json"], json],
  [["sql"], sql],
  [["css"], css],
  [["html", "xml"], xml],
  [["bash", "sh", "shell", "zsh"], bash],
  [["markdown", "md"], markdown],
  [["yaml", "yml"], yaml],
  [["go", "golang"], go],
  [["java"], java],
  [["cpp"], cpp],
  [["c"], c],
  [["swift"], swift],
  [["ruby", "rb"], ruby],
  [["php"], php],
  [["diff"], diff],
  [["dockerfile", "docker"], dockerfile],
];

const lowlight = createLowlight();

for (const [names, module] of LANGUAGE_MODULES) {
  for (const name of names) {
    lowlight.register(name, module);
  }
}

export { lowlight };

export const SUPPORTED_LANGUAGES = [
  { value: "", label: "Plain text" },
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "python", label: "Python" },
  { value: "rust", label: "Rust" },
  { value: "json", label: "JSON" },
  { value: "sql", label: "SQL" },
  { value: "css", label: "CSS" },
  { value: "html", label: "HTML" },
  { value: "bash", label: "Bash" },
  { value: "markdown", label: "Markdown" },
  { value: "yaml", label: "YAML" },
  { value: "go", label: "Go" },
  { value: "java", label: "Java" },
  { value: "cpp", label: "C++" },
  { value: "c", label: "C" },
  { value: "swift", label: "Swift" },
  { value: "ruby", label: "Ruby" },
  { value: "php", label: "PHP" },
  { value: "diff", label: "Diff" },
  { value: "dockerfile", label: "Dockerfile" },
  { value: "mermaid", label: "Mermaid" },
];
