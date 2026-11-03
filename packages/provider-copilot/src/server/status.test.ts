import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import type { ModelInfo } from "@github/copilot-sdk";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { CopilotSettings } from "../settings.ts";
import {
  CopilotAccountProbeError,
  readPremiumQuota,
  type CopilotAccountSnapshot,
  type probeCopilotAccount,
} from "./copilotAccount.ts";
import {
  checkCopilotProviderStatus,
  COPILOT_AUTH_TYPE,
  COPILOT_USAGE_URL,
  copilotModelsFromCatalog,
  copilotUsageLimits,
} from "./status.ts";

const CHECKED_AT = "2026-11-03T03:00:00.000Z";
const DEFAULT_SETTINGS = Schema.decodeSync(CopilotSettings)({});

const catalogModel = (id: string, name: string, extra: Partial<ModelInfo> = {}): ModelInfo =>
  ({
    id,
    name,
    capabilities: {
      supports: { vision: true, reasoningEffort: true },
      limits: { max_context_window_tokens: 1_000_000 },
    },
    ...extra,
  }) as ModelInfo;

const enterpriseAccount: CopilotAccountSnapshot = {
  isAuthenticated: true,
  authType: "user",
  login: "octocat_corp",
  statusMessage: "octocat_corp",
  plan: "enterprise",
  accessSku: "copilot_enterprise_seat_quota",
  models: [
    catalogModel("auto", "Auto"),
    catalogModel("claude-opus-5.5", "Claude Opus 5.5", {
      policy: { state: "enabled", terms: "" },
      supportedReasoningEfforts: ["low", "medium", "high"],
      defaultReasoningEffort: "medium",
    }),
    catalogModel("gpt-6-sol", "GPT-6 Sol", { policy: { state: "disabled", terms: "" } }),
  ],
  quota: {
    isUnlimitedEntitlement: false,
    entitlementRequests: 20_000,
    usedRequests: 5_000,
    remainingPercentage: 75,
    overageAllowedWithExhaustedQuota: true,
    resetDate: "2026-12-01T00:00:00.000Z",
  },
};

const fakeCopilotBinary = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fileSystem.makeTempDirectory({ prefix: "t3-copilot-" });
  const binary = path.join(dir, "copilot");
  yield* fileSystem.writeFileString(binary, '#!/bin/sh\necho "GitHub Copilot CLI 1.0.105."\n');
  yield* fileSystem.chmod(binary, 0o755);
  return binary;
}).pipe(Effect.orDie);

const settings = (overrides: Partial<CopilotSettings> = {}) =>
  fakeCopilotBinary.pipe(
    Effect.map((binaryPath): CopilotSettings => ({
      ...DEFAULT_SETTINGS,
      enabled: true,
      binaryPath,
      ...overrides,
    })),
  );

const probeReturning = (account: CopilotAccountSnapshot) =>
  (() => Effect.succeed(account)) as unknown as typeof probeCopilotAccount;

const probeFailing = (() =>
  Effect.fail(
    new CopilotAccountProbeError({ step: "start", cause: new Error("policy") }),
  )) as unknown as typeof probeCopilotAccount;

const mustNotProbe = (() =>
  Effect.die(
    "disabled or missing Copilot must not start the SDK",
  )) as unknown as typeof probeCopilotAccount;

describe("copilotModelsFromCatalog", () => {
  it("lists the CLI default first and hides models disabled by enterprise policy", () => {
    const models = copilotModelsFromCatalog(enterpriseAccount.models);
    expect(models.map((model) => model.slug)).toEqual(["default", "auto", "claude-opus-5.5"]);
    expect(models[0]?.isDefault).toBe(true);
    expect(models.find((model) => model.slug === "auto")?.name).toBe("Copilot Auto");
  });

  it("offers the reasoning efforts Copilot reports under its ACP option id", () => {
    const opus = copilotModelsFromCatalog(enterpriseAccount.models).find(
      (model) => model.slug === "claude-opus-5.5",
    );
    const descriptor = opus?.capabilities?.optionDescriptors?.[0];
    expect(descriptor?.id).toBe("reasoning_effort");
    expect(descriptor?.type === "select" ? descriptor.options.map((o) => o.id) : []).toEqual([
      "low",
      "medium",
      "high",
    ]);
    expect(descriptor?.type === "select" ? descriptor.currentValue : undefined).toBe("medium");
  });
});

describe("copilotUsageLimits", () => {
  it("shows GitHub's reported percentage and credit counts as a monthly AI-credit window", () => {
    const limits = copilotUsageLimits(enterpriseAccount.quota, CHECKED_AT);
    expect(limits.windows).toEqual([
      {
        id: "ai_credits",
        kind: "monthly",
        label: "AI credits",
        usedPercent: 25,
        resetsAt: "2026-12-01T00:00:00.000Z",
        windowDurationMins: 30 * 24 * 60,
        usedCount: 5_000,
        limitCount: 20_000,
      },
    ]);
    expect(limits.externalUsage?.url).toBe(COPILOT_USAGE_URL);
  });

  it("replaces a reset date that has already passed with the next monthly reset so a used-up allowance stays exhausted", () => {
    const limits = copilotUsageLimits(
      {
        ...enterpriseAccount.quota!,
        remainingPercentage: 0,
        resetDate: "2026-11-03T02:00:00.000Z",
      },
      CHECKED_AT,
    );
    expect(limits.windows[0]?.usedPercent).toBe(100);
    expect(limits.windows[0]?.resetsAt).toBe("2026-12-01T00:00:00.000Z");
  });

  it("links to GitHub instead of inventing a balance when no quota is reported", () => {
    const limits = copilotUsageLimits(undefined, CHECKED_AT);
    expect(limits.windows).toEqual([]);
    expect(limits.unavailable?.reason).toBe("unsupported");
    expect(limits.externalUsage?.url).toBe(COPILOT_USAGE_URL);
  });

  it("reports no window for unlimited entitlements", () => {
    const limits = copilotUsageLimits(
      { ...enterpriseAccount.quota!, isUnlimitedEntitlement: true },
      CHECKED_AT,
    );
    expect(limits.windows).toEqual([]);
    expect(limits.unavailable).toBeUndefined();
  });
});

describe("readPremiumQuota", () => {
  it("reads the premium_interactions snapshot and ignores malformed ones", () => {
    expect(
      readPremiumQuota({
        chat: { isUnlimitedEntitlement: true },
        premium_interactions: {
          isUnlimitedEntitlement: false,
          entitlementRequests: 20_000,
          usedRequests: 0,
          remainingPercentage: 100,
          overageAllowedWithExhaustedQuota: true,
          resetDate: "2026-12-01T00:00:00.000Z",
        },
      }),
    ).toEqual({
      isUnlimitedEntitlement: false,
      entitlementRequests: 20_000,
      usedRequests: 0,
      remainingPercentage: 100,
      overageAllowedWithExhaustedQuota: true,
      resetDate: "2026-12-01T00:00:00.000Z",
    });
    expect(readPremiumQuota({ premium_interactions: { usedRequests: 1 } })).toBeUndefined();
    expect(readPremiumQuota(undefined)).toBeUndefined();
  });
});

describe("checkCopilotProviderStatus", () => {
  it.effect("does not spawn anything while disabled", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkCopilotProviderStatus(
        yield* settings({ enabled: false }),
        process.env,
        undefined,
        mustNotProbe,
      );
      expect(snapshot.status).toBe("disabled");
      expect(snapshot.supportsTextGeneration).toBe(false);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("reports a missing CLI without starting the SDK", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkCopilotProviderStatus(
        yield* settings({ binaryPath: "/nonexistent/copilot" }),
        process.env,
        undefined,
        mustNotProbe,
      );
      expect(snapshot.status).toBe("error");
      expect(snapshot.installed).toBe(false);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("reports a signed-in enterprise account as ready and metered", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkCopilotProviderStatus(
        yield* settings(),
        process.env,
        undefined,
        probeReturning(enterpriseAccount),
      );
      expect(snapshot.status).toBe("ready");
      expect(snapshot.version).toBe("1.0.105");
      expect(snapshot.auth).toEqual({
        status: "authenticated",
        type: COPILOT_AUTH_TYPE,
        label: "Copilot enterprise",
        email: "octocat_corp",
      });
      expect(snapshot.models.map((model) => model.slug)).toEqual([
        "default",
        "auto",
        "claude-opus-5.5",
      ]);
      expect(snapshot.usageLimits?.windows[0]?.usedPercent).toBe(25);
      expect(snapshot.supportsTextGeneration).toBe(false);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("asks for `copilot login` when the CLI is signed out", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkCopilotProviderStatus(
        yield* settings(),
        process.env,
        undefined,
        probeReturning({
          ...enterpriseAccount,
          isAuthenticated: false,
          models: [],
          quota: undefined,
        }),
      );
      expect(snapshot.status).toBe("error");
      expect(snapshot.auth.status).toBe("unauthenticated");
      expect(snapshot.message).toContain("copilot login");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps the provider usable but unverified when the SDK probe fails", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkCopilotProviderStatus(
        yield* settings(),
        process.env,
        undefined,
        probeFailing,
      );
      expect(snapshot.status).toBe("warning");
      expect(snapshot.auth.status).toBe("unknown");
      expect(snapshot.usageLimits).toBeUndefined();
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
