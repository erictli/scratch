import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AiProvider } from "./ai";

// Providers that emit structured events we can render as a live timeline.
// OpenCode and Ollama emit plain prose, so they fall back to a spinner.
export const STREAMING_PROVIDERS: ReadonlyArray<AiProvider> = ["claude", "codex"];

export function supportsStreaming(provider: AiProvider): boolean {
  return STREAMING_PROVIDERS.includes(provider);
}

export type AiStreamEvent =
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; detail: string }
  | { kind: "done"; text: string };

interface AiStreamLine {
  run_id: string;
  line: string;
}

// Tool details render on a single line, and shell commands often span several.
function oneLine(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function basename(path: unknown): string {
  return typeof path === "string" ? path.split("/").pop() || path : "";
}

// Turn a tool call into a short human label, e.g. Read → "note.md".
function describeClaudeTool(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "Read":
    case "Write":
    case "Edit":
    case "NotebookEdit":
      return basename(input.file_path);
    case "Bash":
      return oneLine(input.command);
    case "Glob":
    case "Grep":
      return typeof input.pattern === "string" ? input.pattern : "";
    case "WebFetch":
      return typeof input.url === "string" ? input.url : "";
    case "Task":
      return typeof input.description === "string" ? input.description : "";
    default:
      return "";
  }
}

function parseClaudeLine(payload: Record<string, unknown>): AiStreamEvent[] {
  const events: AiStreamEvent[] = [];

  if (payload.type === "assistant") {
    const message = payload.message as { content?: unknown } | undefined;
    const content = Array.isArray(message?.content) ? message.content : [];
    for (const raw of content) {
      const block = raw as Record<string, unknown>;
      if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
        events.push({ kind: "text", text: block.text });
      } else if (block.type === "tool_use" && typeof block.name === "string") {
        const input = (block.input ?? {}) as Record<string, unknown>;
        events.push({
          kind: "tool",
          name: block.name,
          detail: describeClaudeTool(block.name, input),
        });
      }
    }
  } else if (payload.type === "result") {
    events.push({
      kind: "done",
      text: typeof payload.result === "string" ? payload.result : "",
    });
  }

  return events;
}

function parseCodexLine(payload: Record<string, unknown>): AiStreamEvent[] {
  const item = payload.item as Record<string, unknown> | undefined;

  if (payload.type === "item.started" && item?.type === "command_execution") {
    return [
      {
        kind: "tool",
        name: "Shell",
        detail: oneLine(item.command),
      },
    ];
  }

  if (payload.type === "item.completed" && item?.type === "agent_message") {
    const text = typeof item.text === "string" ? item.text.trim() : "";
    return text ? [{ kind: "text", text }] : [];
  }

  return [];
}

export function parseStreamLine(provider: AiProvider, line: string): AiStreamEvent[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return [];

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(trimmed);
  } catch {
    return [];
  }

  if (provider === "claude") return parseClaudeLine(payload);
  if (provider === "codex") return parseCodexLine(payload);
  return [];
}

// The CLIs emit JSONL on stdout when streaming, but callers (and the response
// toast) want prose. Recover the agent's final message from the raw output.
export function extractFinalText(provider: AiProvider, output: string): string {
  if (!supportsStreaming(provider)) return output;

  const lines = output.split("\n");
  let lastMessage = "";

  for (const line of lines) {
    for (const event of parseStreamLine(provider, line)) {
      if (event.kind === "done" && event.text.trim()) return event.text;
      if (event.kind === "text") lastMessage = event.text;
    }
  }

  // No terminal event (killed, timed out, or unparsable) — fall back to the
  // last prose we saw, then to the raw output so nothing is silently lost.
  return lastMessage || (lines.some((l) => l.trim().startsWith("{")) ? "" : output);
}

export function onAiStreamLine(
  runId: string,
  handler: (line: string) => void,
): Promise<UnlistenFn> {
  return listen<AiStreamLine>("ai-stream-line", (event) => {
    if (event.payload.run_id === runId) handler(event.payload.line);
  });
}
