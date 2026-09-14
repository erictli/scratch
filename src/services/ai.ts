import { invoke } from "@tauri-apps/api/core";
import { extractFinalText } from "./aiStream";

export type AiProvider = "claude" | "codex" | "opencode" | "ollama";
export const AI_PROVIDER_ORDER: ReadonlyArray<AiProvider> = [
  "claude",
  "codex",
  "opencode",
  "ollama",
];

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  ollama: "Ollama",
};

/** One entry in a harness's model picker. An empty `id` runs the CLI's own default. */
export interface AiModelOption {
  id: string;
  label: string;
}

const DEFAULT_MODEL: AiModelOption = { id: "", label: "Default model" };

/**
 * Models offered per harness. These are suggestions, not a closed set — the
 * picker also accepts a custom identifier, so a model released after this list
 * was written is still reachable.
 */
export const AI_PROVIDER_MODELS: Record<
  AiProvider,
  ReadonlyArray<AiModelOption>
> = {
  // Aliases, per `claude --help`: they track the latest model of each family
  // and so don't go stale the way a pinned id does.
  claude: [
    { id: "haiku", label: "Haiku" },
    { id: "sonnet", label: "Sonnet" },
    { id: "opus", label: "Opus" },
    { id: "fable", label: "Fable" },
  ],
  codex: [
    { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
    { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
    { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
    { id: "gpt-6-astra", label: "GPT-6 Astra" },
  ],
  // OpenCode's model ids depend on the providers the user has configured, so
  // only its own default is offered — anything else goes through "Custom…".
  opencode: [DEFAULT_MODEL],
  ollama: [
    { id: "qwen3:8b", label: "qwen3:8b" },
    { id: "llama3.2", label: "llama3.2" },
    { id: "mistral", label: "mistral" },
  ],
};

/**
 * Notes are light work, so each harness starts on a small, fast model rather
 * than its own default; heavier models are one pick away.
 */
export const DEFAULT_AI_MODELS: Record<AiProvider, string> = {
  claude: "haiku",
  codex: "gpt-5.6-luna",
  opencode: "",
  ollama: "qwen3:8b",
};

/** Reasoning depth, where the harness exposes it. */
export type AiEffort = "low" | "medium" | "high" | "xhigh" | "max";

/** Note edits are light work, so every run uses medium; it isn't exposed in the UI. */
export const DEFAULT_AI_EFFORT: AiEffort = "medium";

/** Claude takes `--effort`, Codex `model_reasoning_effort`; the others have no equivalent. */
export function supportsEffort(provider: AiProvider): boolean {
  return provider === "claude" || provider === "codex";
}

/** Ollama has no default of its own — a model name is part of the command. */
export const OLLAMA_FALLBACK_MODEL = "qwen3:8b";

export interface AiExecutionResult {
  success: boolean;
  output: string;
  error: string | null;
}

export async function checkClaudeCli(): Promise<boolean> {
  return invoke("ai_check_claude_cli");
}

export async function executeClaudeEdit(
  filePath: string,
  prompt: string,
  runId?: string,
  model?: string,
  effort?: AiEffort
): Promise<AiExecutionResult> {
  const result = await invoke<AiExecutionResult>("ai_execute_claude", {
    filePath,
    prompt,
    runId,
    model,
    effort,
  });
  return { ...result, output: extractFinalText("claude", result.output) };
}

export async function checkCodexCli(): Promise<boolean> {
  return invoke("ai_check_codex_cli");
}

export async function executeCodexEdit(
  filePath: string,
  prompt: string,
  runId?: string,
  model?: string,
  effort?: AiEffort
): Promise<AiExecutionResult> {
  const result = await invoke<AiExecutionResult>("ai_execute_codex", {
    filePath,
    prompt,
    runId,
    model,
    effort,
  });
  return { ...result, output: extractFinalText("codex", result.output) };
}

export async function checkOpenCodeCli(): Promise<boolean> {
  return invoke("ai_check_opencode_cli");
}

export async function executeOpenCodeEdit(
  filePath: string,
  prompt: string,
  model?: string
): Promise<AiExecutionResult> {
  return invoke("ai_execute_opencode", { filePath, prompt, model });
}

export async function checkOllamaCli(): Promise<boolean> {
  return invoke("ai_check_ollama_cli");
}

const providerCheckers: Record<AiProvider, () => Promise<boolean>> = {
  claude: checkClaudeCli,
  codex: checkCodexCli,
  opencode: checkOpenCodeCli,
  ollama: checkOllamaCli,
};

export async function getAvailableAiProviders(): Promise<AiProvider[]> {
  const checks = await Promise.all(
    AI_PROVIDER_ORDER.map(async (provider) => {
      try {
        const installed = await providerCheckers[provider]();
        return installed ? provider : null;
      } catch {
        return null;
      }
    }),
  );

  return checks.filter((provider): provider is AiProvider => provider !== null);
}

export async function executeOllamaEdit(
  filePath: string,
  prompt: string,
  model: string
): Promise<AiExecutionResult> {
  return invoke("ai_execute_ollama", { filePath, prompt, model });
}
