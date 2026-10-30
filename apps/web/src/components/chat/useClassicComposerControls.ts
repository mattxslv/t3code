import { useClientSettings } from "~/hooks/useSettings";

export function useClassicComposerControls(): boolean {
  return useClientSettings(
    (settings) => settings.customizationsEnabled && settings.composerClassicControls,
  );
}
