import { invoke } from "@tauri-apps/api/core";

export interface CliStatus {
  supported: boolean;
  installed: boolean;
  path: string | null;
}

export async function getCliStatus(): Promise<CliStatus> {
  return invoke("get_cli_status");
}

export async function installCli(): Promise<string> {
  return invoke("install_cli");
}

export async function uninstallCli(): Promise<void> {
  return invoke("uninstall_cli");
}
