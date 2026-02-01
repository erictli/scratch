import { invoke } from "@tauri-apps/api/core";

export interface GitStatus {
  isRepo: boolean;
  hasRemote: boolean;
  hasUpstream: boolean;
  remoteUrl: string | null;
  changedCount: number;
  aheadCount: number;
  currentBranch: string | null;
  error: string | null;
}

export interface GitResult {
  success: boolean;
  message: string | null;
  error: string | null;
}

export async function isGitAvailable(): Promise<boolean> {
  return invoke("git_is_available");
}

export async function getGitStatus(): Promise<GitStatus> {
  return invoke("git_get_status");
}

export async function initGitRepo(): Promise<void> {
  return invoke("git_init_repo");
}

export async function gitCommit(message: string): Promise<GitResult> {
  return invoke("git_commit", { message });
}

export async function gitPush(): Promise<GitResult> {
  return invoke("git_push");
}

export async function addRemote(url: string): Promise<GitResult> {
  return invoke("git_add_remote", { url });
}

export async function pushWithUpstream(): Promise<GitResult> {
  return invoke("git_push_with_upstream");
}
