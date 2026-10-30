import {
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_UNIFIED_SETTINGS,
  type ClientSettings,
  type UnifiedSettings,
} from "@t3tools/contracts/settings";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import {
  __resetClientSettingsPersistenceForTests,
  __setClientSettingsForTests,
  getClientSettings,
} from "../../hooks/useSettings";
import { CustomizationsSettings } from "./CustomizationsSettings";
import "../../index.css";

const storage = vi.hoisted(() => ({ saved: null as ClientSettings | null }));
vi.mock("../../localApi", () => ({
  ensureLocalApi: () => ({
    persistence: {
      getClientSettings: async () => null,
      setClientSettings: async (settings: ClientSettings) => {
        storage.saved = settings;
      },
    },
  }),
  readLocalApi: () => null,
}));
vi.mock("./useScopedSettings", async () => {
  const { useClientSettings, updateClientSettings } = await import("../../hooks/useSettings");
  return {
    useScopedSettings: (selector?: (settings: UnifiedSettings) => unknown) =>
      useClientSettings((client) => {
        const settings = { ...DEFAULT_UNIFIED_SETTINGS, ...client };
        return selector ? selector(settings) : settings;
      }),
    useUpdateScopedSettings: () => updateClientSettings,
    useClearScopedSettings: () => () => {},
    useClearProjectOverrides: () => () => {},
  };
});

function setup() {
  storage.saved = null;
  __resetClientSettingsPersistenceForTests();
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  return { [Symbol.dispose]: () => __resetClientSettingsPersistenceForTests() };
}

it("persists individual choices and keeps them when the master switch disables and restores the group", async () => {
  using _settings = setup();
  await using screen = await render(<CustomizationsSettings />, {
    router: "/settings/customizations",
  });
  const usage = screen.getByRole("switch", { name: "Composer usage indicator", exact: true });
  const master = screen.getByRole("switch", {
    name: "Enable personal customizations",
    exact: true,
  });
  await userEvent.click(usage);
  await vi.waitFor(() => expect(storage.saved?.composerUsageEnabled).toBe(false));
  await userEvent.click(master);
  await expect.element(usage).toBeDisabled();
  await vi.waitFor(() => expect(storage.saved?.customizationsEnabled).toBe(false));
  expect(getClientSettings().workspaceLayout).toBe("reversed");
  expect(getClientSettings().composerUsageEnabled).toBe(false);
  await userEvent.click(master);
  await expect.element(usage).toBeEnabled();
  await expect.element(usage).not.toBeChecked();
  const paths = screen.getByRole("switch", {
    name: "Paste and drop file paths instead of attachments",
    exact: true,
  });
  await userEvent.click(paths);
  await vi.waitFor(() => expect(storage.saved?.composerFileTransferMode).toBe("attachment"));
});
