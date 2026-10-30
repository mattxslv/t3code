import { useAtomValue } from "@effect/atom-react";
import { composerUsageAccountsAtom } from "../../state/composerUsage";
import { composerUsageAccountLabel } from "../chat/composerUsageIndicators.logic";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";
import { SettingsRow } from "./settingsLayout";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { searchableSetting } from "./settingsSearch";

export function ComposerUsageSettings() {
  const accounts = useAtomValue(composerUsageAccountsAtom);
  const selected = useScopedSettings((settings) => settings.composerUsageAccounts);
  const updateSettings = useUpdateScopedSettings();
  return (
    <>
      {(["codex", "claudeAgent"] as const).map((driver) => {
        const candidates = accounts.filter((account) => account.driver === driver);
        const stored = selected[driver];
        const missing =
          stored !== undefined && !candidates.some((account) => account.key === stored);
        return (
          <SettingsRow
            {...searchableSetting(
              driver === "codex" ? "codex-composer-usage-account" : "claude-composer-usage-account",
            )}
            key={driver}
            description="Automatic uses the only available account. Multiple accounts require a selection; allowances are never combined."
            control={
              <Select
                value={stored ?? "automatic"}
                onValueChange={(value) => {
                  if (!value) return;
                  const next = { ...selected };
                  if (value === "automatic") delete next[driver];
                  else next[driver] = value;
                  updateSettings({ composerUsageAccounts: next });
                }}
              >
                <SelectTrigger aria-label={`${driver} composer usage account`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="automatic">Automatic (single account)</SelectItem>
                  {missing ? (
                    <SelectItem value={stored}>Selected account unavailable</SelectItem>
                  ) : null}
                  {candidates.map((account, index) => (
                    <SelectItem key={account.key} value={account.key}>
                      {composerUsageAccountLabel(account, index)}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
        );
      })}
    </>
  );
}
