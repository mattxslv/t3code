import type { ModelInfo } from "@github/copilot-sdk";
import type {
  ModelCapabilities,
  ServerProviderAuth,
  ServerProviderModel,
  ServerProviderUsageLimits,
} from "@t3tools/contracts";
import { causeErrorTag } from "@t3tools/shared/observability";
import { createModelCapabilities } from "@t3tools/shared/model";
import { resolveCommandPath, resolveSpawnCommand } from "@t3tools/shared/shell";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import {
  buildSelectOptionDescriptor,
  buildServerProvider,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "@t3tools/provider-core/server/snapshotProbe";
import type { CopilotSettings } from "../settings.ts";
import {
  probeCopilotAccount,
  type CopilotAccountSnapshot,
  type CopilotQuotaSnapshot,
} from "./copilotAccount.ts";

export const COPILOT_DISPLAY_NAME = "GitHub Copilot";
/** Keeps the model configured in the Copilot CLI; never sent to ACP. */
export const COPILOT_DEFAULT_MODEL_SLUG = "default";
/** Copilot reports AI-credit usage only for paid models, so the bar is labelled by what it measures. */
const COPILOT_USAGE_WINDOW_ID = "ai_credits";
export const COPILOT_USAGE_URL = "https://github.com/settings/copilot";
/** Auto routing treats this auth type as metered: credits are consumed and overage may be billed. */
export const COPILOT_AUTH_TYPE = "copilot_ai_credits";
// ACP config option id Copilot CLI uses for reasoning effort.
const COPILOT_REASONING_OPTION_ID = "reasoning_effort";

const COPILOT_PRESENTATION = {
  displayName: COPILOT_DISPLAY_NAME,
  supportsConversationRollback: false,
} as const;

const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({ optionDescriptors: [] });

const VERSION_PROBE_TIMEOUT_MS = 4_000;
// Starting the runtime and reading auth, quota and the catalog measured ~3s on CLI 1.0.105.
const ACCOUNT_PROBE_TIMEOUT_MS = 30_000;

const DEFAULT_MODEL: ServerProviderModel = {
  slug: COPILOT_DEFAULT_MODEL_SLUG,
  name: "Copilot CLI default",
  isCustom: false,
  isDefault: true,
  capabilities: EMPTY_CAPABILITIES,
};

// Background text generation and Auto's classifier would spend AI credits without a user prompt.
function copilotSnapshot(input: Parameters<typeof buildServerProvider>[0]): ServerProviderDraft {
  return { ...buildServerProvider(input), supportsTextGeneration: false };
}

function copilotModelCapabilities(model: ModelInfo): ModelCapabilities {
  const efforts = model.supportedReasoningEfforts ?? [];
  if (efforts.length === 0) return EMPTY_CAPABILITIES;
  return createModelCapabilities({
    optionDescriptors: [
      buildSelectOptionDescriptor({
        id: COPILOT_REASONING_OPTION_ID,
        label: "Reasoning",
        options: efforts.map((effort) => ({
          value: effort,
          label: effort,
          ...(effort === model.defaultReasoningEffort ? { isDefault: true } : {}),
        })),
      }),
    ],
  });
}

/** Lists only models the account's enterprise policy leaves selectable. */
export function copilotModelsFromCatalog(
  catalog: ReadonlyArray<ModelInfo>,
): ReadonlyArray<ServerProviderModel> {
  const seen = new Set<string>([COPILOT_DEFAULT_MODEL_SLUG]);
  const models: ServerProviderModel[] = [DEFAULT_MODEL];
  for (const model of catalog) {
    const slug = model.id.trim();
    if (slug.length === 0 || seen.has(slug) || model.policy?.state === "disabled") continue;
    seen.add(slug);
    models.push({
      slug,
      name: slug === "auto" ? "Copilot Auto" : model.name.trim() || slug,
      isCustom: false,
      capabilities: copilotModelCapabilities(model),
    });
  }
  return models;
}

// GitHub has reported reset dates already in the past; such a date would make a used-up
// allowance look reset to Auto, so only a future date is passed on.
function futureResetIso(value: string | undefined, checkedAt: string): string | undefined {
  if (value === undefined) return undefined;
  const reset = DateTime.make(value);
  const checked = DateTime.make(checkedAt);
  if (Option.isNone(reset) || Option.isNone(checked)) return undefined;
  return DateTime.isGreaterThan(reset.value, checked.value)
    ? DateTime.formatIso(reset.value)
    : undefined;
}

/** Reports GitHub's own percentage; credit counts are never estimated locally. */
export function copilotUsageLimits(
  quota: CopilotQuotaSnapshot | undefined,
  checkedAt: string,
): ServerProviderUsageLimits {
  const externalUsage = { label: "GitHub Copilot usage", url: COPILOT_USAGE_URL };
  if (quota === undefined) {
    return {
      checkedAt,
      windows: [],
      externalUsage,
      unavailable: {
        reason: "unsupported",
        message: "Copilot did not report an AI-credit quota for this account.",
      },
    };
  }
  if (quota.isUnlimitedEntitlement || quota.entitlementRequests <= 0) {
    return { checkedAt, windows: [], externalUsage };
  }
  const resetsAt = futureResetIso(quota.resetDate, checkedAt);
  return {
    checkedAt,
    windows: [
      {
        id: COPILOT_USAGE_WINDOW_ID,
        kind: "monthly",
        label: "AI credits",
        usedPercent: Math.min(100, Math.max(0, 100 - quota.remainingPercentage)),
        ...(resetsAt === undefined ? {} : { resetsAt }),
      },
    ],
    externalUsage,
  };
}

function copilotAuth(account: CopilotAccountSnapshot): ServerProviderAuth {
  if (!account.isAuthenticated) return { status: "unauthenticated" };
  const plan = account.plan ? `Copilot ${account.plan}` : "Copilot";
  return {
    status: "authenticated",
    type: COPILOT_AUTH_TYPE,
    label: account.authType === "user" ? plan : `${plan} (${account.authType ?? "token"})`,
    ...(account.login === undefined ? {} : { email: account.login }),
  };
}

const runCopilotVersion = Effect.fn("CopilotProviderStatus.runCopilotVersion")(function* (
  settings: CopilotSettings,
  environment: NodeJS.ProcessEnv,
) {
  const command = settings.binaryPath || "copilot";
  const spawn = yield* resolveSpawnCommand(command, ["--version"], { env: environment });
  return yield* spawnAndCollect(
    command,
    ChildProcess.make(spawn.command, spawn.args, {
      env: environment,
      shell: spawn.shell,
    }),
  );
});

function disabledSnapshot(
  settings: CopilotSettings,
  checkedAt: string,
  message: string,
): ServerProviderDraft {
  return copilotSnapshot({
    presentation: COPILOT_PRESENTATION,
    enabled: false,
    checkedAt,
    models: providerModelsFromSettings([DEFAULT_MODEL], settings.customModels, EMPTY_CAPABILITIES),
    probe: {
      installed: false,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message,
    },
  });
}

export const buildInitialCopilotProviderSnapshot = Effect.fn(
  "CopilotProviderStatus.buildInitialCopilotProviderSnapshot",
)(function* (settings: CopilotSettings): Effect.fn.Return<ServerProviderDraft> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  if (!settings.enabled) {
    return disabledSnapshot(settings, checkedAt, "GitHub Copilot is disabled in T3 Code settings.");
  }
  return copilotSnapshot({
    presentation: COPILOT_PRESENTATION,
    enabled: true,
    checkedAt,
    models: providerModelsFromSettings([DEFAULT_MODEL], settings.customModels, EMPTY_CAPABILITIES),
    probe: {
      installed: true,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: "Checking GitHub Copilot CLI availability...",
    },
  });
});

export const checkCopilotProviderStatus = Effect.fn("checkCopilotProviderStatus")(function* (
  settings: CopilotSettings,
  environment: NodeJS.ProcessEnv,
  cwd: string | undefined,
  probeAccount: typeof probeCopilotAccount = probeCopilotAccount,
): Effect.fn.Return<
  ServerProviderDraft,
  never,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const fallbackModels = providerModelsFromSettings(
    [DEFAULT_MODEL],
    settings.customModels,
    EMPTY_CAPABILITIES,
  );
  if (!settings.enabled) {
    return disabledSnapshot(settings, checkedAt, "GitHub Copilot is disabled in T3 Code settings.");
  }

  const versionResult = yield* runCopilotVersion(settings, environment).pipe(
    Effect.timeoutOption(VERSION_PROBE_TIMEOUT_MS),
    Effect.result,
  );
  if (Result.isFailure(versionResult)) {
    const missing = isCommandMissingCause(versionResult.failure);
    return copilotSnapshot({
      presentation: COPILOT_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: !missing,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: missing
          ? "GitHub Copilot CLI (`copilot`) is not installed or not on PATH."
          : "Failed to execute GitHub Copilot CLI health check.",
      },
    });
  }
  if (Option.isNone(versionResult.success) || versionResult.success.value.code !== 0) {
    return copilotSnapshot({
      presentation: COPILOT_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: Option.isNone(versionResult.success)
          ? "GitHub Copilot CLI timed out while running `copilot --version`."
          : "GitHub Copilot CLI is installed but failed to run.",
      },
    });
  }
  const output = versionResult.success.value;
  const version = parseGenericCliVersion(`${output.stdout}\n${output.stderr}`);

  // The SDK requires an existing file path and does not search PATH itself.
  const command = settings.binaryPath || "copilot";
  const resolvedBinary = yield* resolveCommandPath(command, { env: environment }).pipe(
    Effect.orElseSucceed(() => null),
  );
  const accountExit = yield* probeAccount({
    binaryPath: resolvedBinary ?? command,
    environment,
    cwd,
  }).pipe(Effect.timeoutOption(ACCOUNT_PROBE_TIMEOUT_MS), Effect.exit);
  if (Exit.isFailure(accountExit) || Option.isNone(accountExit.value)) {
    yield* Effect.logWarning("Copilot SDK account probe failed or timed out.", {
      errorTag: Exit.isFailure(accountExit) ? causeErrorTag(accountExit.cause) : "Timeout",
    });
    return copilotSnapshot({
      presentation: COPILOT_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version,
        status: "warning",
        auth: { status: "unknown" },
        message:
          "Could not read Copilot sign-in, entitlement or models through the Copilot SDK. Model options may be incomplete.",
      },
    });
  }

  const account = accountExit.value.value;
  const auth = copilotAuth(account);
  if (auth.status === "unauthenticated") {
    return copilotSnapshot({
      presentation: COPILOT_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version,
        status: "error",
        auth,
        message: "GitHub Copilot CLI is not signed in. Run `copilot login` in a terminal.",
      },
    });
  }

  const catalogModels = copilotModelsFromCatalog(account.models);
  const models = providerModelsFromSettings(
    catalogModels,
    settings.customModels,
    EMPTY_CAPABILITIES,
  );
  const hasCatalog = catalogModels.length > 1;
  return copilotSnapshot({
    presentation: COPILOT_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: true,
      version,
      status: hasCatalog ? "ready" : "warning",
      auth,
      usageLimits: copilotUsageLimits(account.quota, checkedAt),
      ...(hasCatalog
        ? {}
        : { message: "Copilot reported no models enabled for this account by policy." }),
    },
  });
});
