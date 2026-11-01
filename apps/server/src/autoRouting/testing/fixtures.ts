import {
  DEFAULT_AUTO_ROUTING_PREFERENCES,
  DEFAULT_AUTO_ROUTING_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type AutoRoutingPreferences,
  type AutoRoutingSettings,
  type ModelSelection,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";

import type { RouteInput, RouteThreadContext } from "../engine.ts";

export const NOW_MS = Date.parse("2026-11-01T12:00:00.000Z");
export const CLAUDE = ProviderInstanceId.make("claudeAgent");
export const CODEX = ProviderInstanceId.make("codex");
export const CURSOR = ProviderInstanceId.make("cursor");

const effort = (id: "effort" | "reasoningEffort") => ({
  optionDescriptors: [
    {
      id,
      label: "Reasoning",
      type: "select" as const,
      options: ["low", "medium", "high", "xhigh", "max"].map((level) => ({
        id: level,
        label: level,
        ...(level === "medium" ? { isDefault: true } : {}),
      })),
    },
  ],
});

const model = (
  slug: string,
  name: string,
  optionId: "effort" | "reasoningEffort",
  extra: Partial<ServerProviderModel> = {},
): ServerProviderModel => ({
  slug,
  name,
  isCustom: false,
  capabilities: effort(optionId),
  ...extra,
});

function makeProvider(
  overrides: Partial<ServerProvider> & Pick<ServerProvider, "instanceId" | "driver">,
): ServerProvider {
  return {
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated", type: "max" },
    checkedAt: "2026-11-01T11:59:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...overrides,
  };
}

export const claudeProvider = (overrides: Partial<ServerProvider> = {}) =>
  makeProvider({
    instanceId: CLAUDE,
    driver: ProviderDriverKind.make("claudeAgent"),
    auth: { status: "authenticated", type: "max", label: "Claude Max Subscription" },
    models: [
      model("claude-fable-5-1", "Claude Fable 5.1", "effort"),
      model("claude-opus-5-5", "Claude Opus 5.5", "effort"),
      model("claude-sonnet-5-5", "Claude Sonnet 5.5", "effort"),
      model("claude-haiku-5-5", "Claude Haiku 5.5", "effort"),
    ],
    ...overrides,
  });

export const codexProvider = (overrides: Partial<ServerProvider> = {}) =>
  makeProvider({
    instanceId: CODEX,
    driver: ProviderDriverKind.make("codex"),
    auth: { status: "authenticated", type: "chatgpt", label: "ChatGPT Pro Subscription" },
    models: [
      model("gpt-6-astra", "GPT-6 Astra", "reasoningEffort"),
      model("gpt-6.1-sol", "GPT-6.1 Sol", "reasoningEffort"),
      model("gpt-6-luna", "GPT-6 Luna", "reasoningEffort"),
      model("gpt-5.6-terra", "GPT-5.6 Terra", "reasoningEffort", { isLegacy: true }),
    ],
    ...overrides,
  });

export const cursorProvider = () =>
  makeProvider({
    instanceId: CURSOR,
    driver: ProviderDriverKind.make("cursor"),
    models: [model("composer-2", "Composer 2", "effort")],
  });

const defaultProviders = () => [claudeProvider(), codexProvider(), cursorProvider()];

export const selection = (
  instanceId: ProviderInstanceId,
  modelSlug: string,
  options?: ModelSelection["options"],
): ModelSelection => ({ instanceId, model: modelSlug, ...(options ? { options } : {}) });

export const idleThread = (overrides: Partial<RouteThreadContext> = {}): RouteThreadContext => ({
  currentSelection: selection(CLAUDE, "claude-sonnet-5-5"),
  started: true,
  supportsHandoff: true,
  activeWork: null,
  priorTurns: 2,
  previousComplexity: "moderate",
  lastOutcome: { type: "success" },
  escalationsUsed: 0,
  ...overrides,
});

export const routeInput = (
  overrides: Partial<RouteInput> & {
    readonly settingsPatch?: Partial<AutoRoutingSettings>;
    readonly preferencesPatch?: Partial<AutoRoutingPreferences>;
  } = {},
): RouteInput => {
  const { settingsPatch, preferencesPatch, ...rest } = overrides;
  return {
    text: "Fix the failing date parser test in src/date.ts",
    attachmentCount: 0,
    settings: { ...DEFAULT_AUTO_ROUTING_SETTINGS, ...settingsPatch },
    preferences: { ...DEFAULT_AUTO_ROUTING_PREFERENCES, ...preferencesPatch },
    providers: defaultProviders(),
    nowMs: NOW_MS,
    thread: null,
    requestedSelection: selection(CLAUDE, "claude-opus-5-5"),
    ...rest,
  };
};
