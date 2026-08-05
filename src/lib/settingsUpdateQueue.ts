import type { Settings } from "../types/note";

type LoadSettings = () => Promise<Settings>;
type SaveSettings = (settings: Settings) => Promise<void>;

export function createSettingsPatchQueue(
  loadSettings: LoadSettings,
  saveSettings: SaveSettings,
) {
  let queue: Promise<void> = Promise.resolve();

  return (patch: Partial<Settings>): Promise<void> => {
    const update = queue.then(async () => {
      const settings = await loadSettings();
      await saveSettings({ ...settings, ...patch });
    });

    queue = update.catch(() => undefined);
    return update;
  };
}
