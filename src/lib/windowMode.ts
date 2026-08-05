export interface WindowMode {
  isPreview: boolean;
  isPreferences: boolean;
  previewFile: string | null;
}

export function getWindowMode(search: string): WindowMode {
  const params = new URLSearchParams(search);
  const mode = params.get("mode");
  const file = params.get("file");
  return {
    isPreview: mode === "preview" && !!file,
    isPreferences: mode === "preferences",
    previewFile: file,
  };
}
