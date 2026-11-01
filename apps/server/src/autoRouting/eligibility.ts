import {
  type AutoRoutingModelRef,
  type AutoRoutingSettings,
  type AutoRoutingUsageObservation,
  isProviderAvailable,
  type ProviderInstanceId,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { exhaustedUsageWindow } from "@t3tools/shared/usageLimits";

import { type AutoRoutingModelProfile, resolveModelProfile } from "./modelCapabilities.ts";

/** Auto only ever routes between these drivers. */
const AUTO_ROUTING_DRIVERS: ReadonlySet<string> = new Set(["claudeAgent", "codex"]);

// Auth types that bill per token instead of drawing on a subscription.
const METERED_AUTH_TYPES: ReadonlySet<string> = new Set([
  "apikey",
  "bedrock",
  "amazonbedrock",
  "vertex",
  "googlevertex",
  "foundry",
  "azure",
  "customendpoint",
]);

export type AutoRoutingExclusion =
  | "hidden"
  | "provider_disabled"
  | "provider_not_installed"
  | "provider_unauthenticated"
  | "provider_unavailable"
  | "provider_error"
  | "metered_auth"
  | "subscription_unverified"
  | "usage_exhausted"
  | "legacy_model"
  | "custom_model_unknown_capability"
  | "project_disabled";

export const AUTO_ROUTING_EXCLUSION_LABELS: Record<AutoRoutingExclusion, string> = {
  hidden: "Hidden from Auto",
  provider_disabled: "Provider disabled",
  provider_not_installed: "Provider not installed",
  provider_unauthenticated: "Not signed in",
  provider_unavailable: "Provider unavailable",
  provider_error: "Provider reported an error",
  metered_auth: "Uses metered API billing",
  subscription_unverified: "Subscription sign-in not verified",
  usage_exhausted: "Usage limit reached",
  legacy_model: "Legacy model",
  custom_model_unknown_capability: "Custom model without a capability tier",
  project_disabled: "Disabled for this project",
};

export interface AutoRoutingModelEntry {
  readonly provider: ServerProvider;
  readonly model: ServerProviderModel;
  readonly profile: AutoRoutingModelProfile;
  readonly hidden: boolean;
  readonly exclusion: AutoRoutingExclusion | null;
  /** Highest measured window use for this instance; null when unreported. */
  readonly maxUsedPercent: number | null;
}

export function modelRefMatches(
  ref: AutoRoutingModelRef,
  instanceId: ProviderInstanceId,
  model: Pick<ServerProviderModel, "slug" | "aliases">,
): boolean {
  if (ref.instanceId !== undefined && ref.instanceId !== instanceId) return false;
  return ref.model === model.slug || (model.aliases ?? []).includes(ref.model);
}

function isHiddenFromAuto(
  settings: Pick<AutoRoutingSettings, "hiddenModels">,
  instanceId: ProviderInstanceId,
  model: Pick<ServerProviderModel, "slug" | "aliases">,
): boolean {
  return settings.hiddenModels.some((ref) => modelRefMatches(ref, instanceId, model));
}

function normalizedAuthType(provider: ServerProvider): string | null {
  const type = provider.auth.type?.toLowerCase().replace(/[\s_-]+/g, "");
  return type === undefined || type.length === 0 ? null : type;
}

function providerExclusion(
  provider: ServerProvider,
  settings: AutoRoutingSettings,
): AutoRoutingExclusion | null {
  if (!provider.enabled) return "provider_disabled";
  if (!provider.installed) return "provider_not_installed";
  if (provider.auth.status === "unauthenticated") return "provider_unauthenticated";
  if (!isProviderAvailable(provider)) return "provider_unavailable";
  if (provider.status === "error" || provider.status === "disabled") return "provider_error";
  if (!settings.allowMeteredProviders) {
    const authType = normalizedAuthType(provider);
    if (authType !== null && METERED_AUTH_TYPES.has(authType)) return "metered_auth";
    // Unknown auth could be cloud billing; only a reported plan is trusted unless the user opts in.
    if (provider.auth.status !== "authenticated") return "subscription_unverified";
    if (authType === null && !settings.allowUnverifiedAuth) return "subscription_unverified";
  }
  return null;
}

function maxMeasuredUsage(provider: ServerProvider): number | null {
  const windows = provider.usageLimits?.windows ?? [];
  if (windows.length === 0) return null;
  return Math.max(...windows.map((window) => window.usedPercent ?? 0));
}

export function usageObservations(
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<AutoRoutingUsageObservation> {
  return providers
    .filter((provider) => AUTO_ROUTING_DRIVERS.has(provider.driver))
    .map((provider) => ({
      instanceId: provider.instanceId,
      maxUsedPercent: maxMeasuredUsage(provider),
      checkedAt: provider.usageLimits?.checkedAt ?? null,
    }));
}

/** Every Claude/Codex model with the reason it cannot be routed to, if any. */
export function listAutoRoutingModels(input: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly settings: AutoRoutingSettings;
  readonly nowMs: number;
  readonly instanceEnabledForProject?: (instanceId: ProviderInstanceId) => boolean;
}): ReadonlyArray<AutoRoutingModelEntry> {
  const entries: AutoRoutingModelEntry[] = [];
  for (const provider of input.providers) {
    if (!AUTO_ROUTING_DRIVERS.has(provider.driver)) continue;
    const providerReason =
      input.instanceEnabledForProject?.(provider.instanceId) === false
        ? "project_disabled"
        : providerExclusion(provider, input.settings);
    const maxUsedPercent = maxMeasuredUsage(provider);
    for (const model of provider.models) {
      const profile = resolveModelProfile(model, input.settings.modelTiers);
      const hidden = isHiddenFromAuto(input.settings, provider.instanceId, model);
      const exclusion: AutoRoutingExclusion | null = hidden
        ? "hidden"
        : (providerReason ??
          // A tier override is an explicit opt-in, e.g. the newest model a Vertex project offers.
          (model.isLegacy === true && profile.tierSource !== "override"
            ? "legacy_model"
            : model.isCustom && profile.tierSource !== "override"
              ? "custom_model_unknown_capability"
              : exhaustedUsageWindow(provider, input.nowMs, model.slug) !== undefined
                ? "usage_exhausted"
                : null));
      entries.push({ provider, model, profile, hidden, exclusion, maxUsedPercent });
    }
  }
  return entries;
}
