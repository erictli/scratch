export interface WorkspaceSwitchSteps {
  flushCurrentDraft: () => Promise<void>;
  switchBackendWorkspace: (path: string) => Promise<string>;
  loadWorkspace: (path: string) => Promise<void>;
}

export async function runWorkspaceSwitch(
  requestedPath: string,
  steps: WorkspaceSwitchSteps,
): Promise<string> {
  await steps.flushCurrentDraft();
  const activePath = await steps.switchBackendWorkspace(requestedPath);
  await steps.loadWorkspace(activePath);
  return activePath;
}
