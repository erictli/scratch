import { invoke } from "@tauri-apps/api/core";

export type AiProvider = "claude" | "codex";

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
  prompt: string
): Promise<AiExecutionResult> {
  return invoke("ai_execute_claude", { filePath, prompt });
}

export async function checkCodexCli(): Promise<boolean> {
  return invoke("ai_check_codex_cli");
}

export async function executeCodexEdit(
  filePath: string,
  prompt: string
): Promise<AiExecutionResult> {
  return invoke("ai_execute_codex", { filePath, prompt });
}
