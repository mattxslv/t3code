import type { ClientSettings } from "@t3tools/contracts/settings";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { Switch } from "../ui/switch";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { DividerColorControl } from "./DividerColorControl";
import { ComposerUsageSettings } from "./ComposerUsageSettings";
import { searchableSetting } from "./settingsSearch";

const TOGGLES = [
  [
    "panelControlsLeft",
    "Panel controls on the left",
    "Move the panel toolbar to the top-left and open project details beneath its button.",
  ],
  [
    "explorerOnLeft",
    "File explorer on the left",
    "Open file contents to the right of the file tree.",
  ],
  [
    "editorDividerCustomColorEnabled",
    "Custom editor divider",
    "Use the selected color for the editor and explorer resize divider.",
  ],
  [
    "fileHorizontalScrollbarEnabled",
    "Bottom file scrollbar",
    "Keep horizontal scrolling accessible at the bottom when word wrap is off.",
  ],
  [
    "composerClassicControls",
    "Classic composer controls",
    "Show model, effort, and access as separate menus on the left, with attach and send on the right.",
  ],
  [
    "composerUsageEnabled",
    "Composer usage indicator",
    "Show provider allowance in the chat toolbar.",
  ],
  [
    "composerUsageSelectedOnly",
    "Only show the selected provider",
    "Show Codex for Codex models and Claude for Claude models. Turn off to show both.",
  ],
  [
    "composerUsageDetailed",
    "Detailed usage bar",
    "Show the percentage, provider colors, striped remainder, and reset countdown inside the bar.",
  ],
] as const satisfies readonly (readonly [keyof ClientSettings, string, string])[];

export function CustomizationsSettings() {
  const settings = useScopedSettings();
  const update = useUpdateScopedSettings();
  return (
    <SettingsPageContainer>
      <SettingsSection id="customizations" title="Personal customizations">
        <SettingsRow
          {...searchableSetting("customizations-enabled")}
          description="Enable this fork's custom features. Turning this off restores upstream behavior without losing your choices. Saved on this device."
          control={
            <Switch
              checked={settings.customizationsEnabled}
              onCheckedChange={(checked) => update({ customizationsEnabled: Boolean(checked) })}
              aria-label="Enable personal customizations"
            />
          }
        />
        <fieldset
          disabled={!settings.customizationsEnabled}
          className="min-w-0 disabled:opacity-50"
        >
          <SettingsRow
            {...searchableSetting("workspace-layout")}
            description="Chat stays between the editor panel and project navigation."
            control={
              <Select
                disabled={!settings.customizationsEnabled}
                value={settings.workspaceLayout}
                onValueChange={(workspaceLayout) => {
                  if (workspaceLayout === "standard" || workspaceLayout === "reversed")
                    update({ workspaceLayout });
                }}
              >
                <SelectTrigger aria-label="Workspace layout">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="reversed">Editor left, navigation right</SelectItem>
                  <SelectItem value="standard">Navigation left, editor right</SelectItem>
                </SelectPopup>
              </Select>
            }
          />
          {TOGGLES.map(([key, title, description]) => (
            <SettingsRow
              {...searchableSetting(`custom-${key}`)}
              key={key}
              description={description}
              control={
                <Switch
                  disabled={!settings.customizationsEnabled}
                  checked={settings[key]}
                  onCheckedChange={(checked) => update({ [key]: Boolean(checked) })}
                  aria-label={title}
                />
              }
            />
          ))}
          <SettingsRow
            {...searchableSetting("editor-divider-color")}
            description="Choose a preset or enter a six-digit HEX color."
            control={
              <DividerColorControl
                disabled={!settings.customizationsEnabled}
                key={settings.editorDividerColor}
                value={settings.editorDividerColor}
                onChange={(editorDividerColor) => update({ editorDividerColor })}
              />
            }
          />
          <SettingsRow
            {...searchableSetting("composer-file-transfer-mode")}
            description="Paths reference files on the agent's local computer without uploading bytes. In a browser, use Copy as path if the original path is hidden. Use attachments for remote agents or screenshots without a file path."
            control={
              <Switch
                disabled={!settings.customizationsEnabled}
                checked={settings.composerFileTransferMode === "path"}
                onCheckedChange={(checked) =>
                  update({ composerFileTransferMode: checked ? "path" : "attachment" })
                }
                aria-label="Paste and drop file paths instead of attachments"
              />
            }
          />
          <ComposerUsageSettings disabled={!settings.customizationsEnabled} />
        </fieldset>
      </SettingsSection>
    </SettingsPageContainer>
  );
}
