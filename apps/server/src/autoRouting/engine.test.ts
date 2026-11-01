import { describe, expect, it } from "@effect/vitest";

import { ProviderInstanceId, RunId } from "@t3tools/contracts";

import { computeEscalationOffer, decideRoute } from "./engine.ts";
import {
  CLAUDE,
  CODEX,
  CURSOR,
  claudeProvider,
  codexProvider,
  cursorProvider,
  idleThread,
  NOW_MS,
  routeInput,
  selection,
} from "./testing/fixtures.ts";

const FROZEN_MODELS = new Set(["claude-fable-5-1", "gpt-6-astra"]);
const RUN_ID = RunId.make("run-1");

const exhausted = (resetsAt = "2026-11-01T18:00:00.000Z") => ({
  checkedAt: "2026-11-01T11:59:00.000Z",
  windows: [{ id: "five_hour", kind: "session" as const, label: "5h", usedPercent: 100, resetsAt }],
});

describe("decideRoute", () => {
  it.each([
    ["economy", "thanks, looks good", 1],
    ["balanced", "Add a unit test for parseDuration covering negative values", 2],
    [
      "balanced",
      "Refactor the authentication flow across the entire codebase, migrate stored tokens and remove race conditions on refresh.",
      3,
    ],
    ["quality", "Add a unit test for parseDuration covering negative values", 3],
  ] as const)("%s routes %j to a tier %i model", (profile, text, tier) => {
    const decision = decideRoute(routeInput({ text, preferencesPatch: { profile } }));
    expect(decision.kind).toBe("routed");
    const chosen = decision.candidates.find(
      (candidate) =>
        candidate.instanceId === decision.selection?.instanceId &&
        candidate.model === decision.selection?.model,
    );
    expect(chosen?.tier).toBe(tier);
  });

  it("never selects hidden, other-provider, legacy, metered or unverified models", () => {
    for (const profile of ["economy", "balanced", "quality"] as const) {
      const decision = decideRoute(
        routeInput({
          text: "Design a complete distributed consensus protocol with end-to-end tests across packages",
          preferencesPatch: { profile },
        }),
      );
      expect(FROZEN_MODELS.has(decision.selection!.model)).toBe(false);
      expect(decision.selection!.instanceId).not.toBe(CURSOR);
      expect(decision.selection!.model).not.toBe("gpt-5.6-terra");
    }
    const metered = decideRoute(
      routeInput({
        providers: [
          claudeProvider({ auth: { status: "authenticated", type: "apiKey" } }),
          codexProvider({ auth: { status: "authenticated" } }),
        ],
      }),
    );
    expect(metered.kind).toBe("manual_fallback");
    expect(metered.selection).toEqual(selection(CLAUDE, "claude-opus-5-5"));
    expect(
      metered.candidates.find((candidate) => candidate.model === "claude-opus-5-5")?.excluded,
    ).toBe("Uses metered API billing");
  });

  it("trusts an unverified sign-in only when asked, and never as a way around metered billing", () => {
    const providers = [
      claudeProvider({ auth: { status: "authenticated" } }),
      claudeProvider({
        instanceId: ProviderInstanceId.make("claudeWork"),
        auth: { status: "authenticated", type: "vertex" },
      }),
      claudeProvider({
        instanceId: ProviderInstanceId.make("claudeProxy"),
        auth: { status: "authenticated", type: "customEndpoint" },
      }),
      codexProvider({ auth: { status: "authenticated", type: "apiKey" } }),
    ];
    expect(decideRoute(routeInput({ providers })).kind).toBe("manual_fallback");
    const trusted = decideRoute(
      routeInput({ providers, settingsPatch: { allowUnverifiedAuth: true } }),
    );
    expect(trusted.selection?.instanceId).toBe(CLAUDE);
    for (const [instanceId, model] of [
      ["claudeWork", "claude-opus-5-5"],
      ["claudeProxy", "claude-opus-5-5"],
      ["codex", "gpt-6.1-sol"],
    ]) {
      expect(
        trusted.candidates.find(
          (candidate) => candidate.instanceId === instanceId && candidate.model === model,
        )?.excluded,
      ).toBe("Uses metered API billing");
    }
  });

  it("allows metered instances only when explicitly enabled", () => {
    const decision = decideRoute(
      routeInput({
        providers: [claudeProvider({ auth: { status: "authenticated", type: "apiKey" } })],
        settingsPatch: { allowMeteredProviders: true },
      }),
    );
    expect(decision.selection?.instanceId).toBe(CLAUDE);
  });

  it("lets users unhide a model and tier-override custom models", () => {
    const decision = decideRoute(
      routeInput({
        text: "Design a complete distributed consensus protocol with end-to-end tests across packages",
        preferencesPatch: { profile: "quality" },
        settingsPatch: { hiddenModels: [] },
      }),
    );
    expect(FROZEN_MODELS.has(decision.selection!.model)).toBe(true);
  });

  it("does not favor one provider when equally capable models tie", () => {
    const tasks = [
      "Refactor the authentication flow across the entire codebase and migrate the tokens",
      "We have an intermittent deadlock in the job scheduler; investigate and fix it",
      "Design a complete event-sourced billing pipeline with end-to-end tests",
      "Fix the race condition in the websocket reconnect logic across packages",
      "Optimize the memory leak in the renderer and profile the hot path",
      "Migrate the database layer to the new connection pool and fix concurrency bugs",
    ];
    const providers = new Set(
      tasks.map((text) => decideRoute(routeInput({ text })).selection?.instanceId),
    );
    expect(providers).toEqual(new Set([CLAUDE, CODEX]));
  });

  it("breaks ties toward the provider with more measured headroom", () => {
    const busy = {
      checkedAt: "2026-11-01T11:59:00.000Z",
      windows: [{ id: "weekly", kind: "weekly" as const, label: "Week", usedPercent: 60 }],
    };
    const text =
      "Refactor the authentication flow across the entire codebase and migrate the tokens";
    expect(
      decideRoute(
        routeInput({ text, providers: [claudeProvider({ usageLimits: busy }), codexProvider()] }),
      ).selection?.instanceId,
    ).toBe(CODEX);
    expect(
      decideRoute(
        routeInput({ text, providers: [claudeProvider(), codexProvider({ usageLimits: busy })] }),
      ).selection?.instanceId,
    ).toBe(CLAUDE);
  });

  it("keeps the active model while a run or approval is pending", () => {
    for (const activeWork of ["active_run", "pending_request"] as const) {
      const decision = decideRoute(
        routeInput({
          text: "Refactor the whole codebase architecture",
          thread: idleThread({ activeWork }),
        }),
      );
      expect(decision.kind).toBe("kept_active");
      expect(decision.selection).toEqual(selection(CLAUDE, "claude-sonnet-5-5"));
    }
  });

  it("keeps the current model for a follow-up instead of switching", () => {
    const current = selection(CODEX, "gpt-6.1-sol", [{ id: "reasoningEffort", value: "high" }]);
    const decision = decideRoute(
      routeInput({
        text: "now also update the docs for it",
        thread: idleThread({ currentSelection: current, previousComplexity: "complex" }),
      }),
    );
    expect(decision.selection).toEqual(current);
    expect(decision.continuation).toBe(true);
    expect(decision.providerSwitched).toBe(false);
    expect(decision.reasonCodes).toContain("continuation_kept_model");
  });

  it("prefers staying on the thread's provider when tiers tie", () => {
    const decision = decideRoute(
      routeInput({
        text: "Add a unit test for parseDuration covering negative values",
        thread: idleThread({
          currentSelection: selection(CODEX, "gpt-6-luna"),
          previousComplexity: null,
          priorTurns: 1,
        }),
      }),
    );
    expect(decision.selection?.instanceId).toBe(CODEX);
    expect(decision.providerSwitched).toBe(false);
  });

  it("does not switch providers when the session cannot hand off context", () => {
    const decision = decideRoute(
      routeInput({
        text: "Refactor the authentication flow across the entire codebase and migrate the tokens",
        providers: [claudeProvider(), codexProvider()],
        preferencesPatch: { preferredInstanceId: CODEX },
        thread: idleThread({ supportsHandoff: false, previousComplexity: null }),
      }),
    );
    expect(decision.selection?.instanceId).toBe(CLAUDE);
  });

  it("falls back when the current model is rate limited and records why", () => {
    const decision = decideRoute(
      routeInput({
        text: "Add a unit test for parseDuration covering negative values",
        providers: [
          claudeProvider({ usageLimits: exhausted() }),
          codexProvider(),
          cursorProvider(),
        ],
        thread: idleThread({ previousComplexity: null }),
      }),
    );
    expect(decision.selection?.instanceId).toBe(CODEX);
    expect(decision.fallback).toEqual({
      reason: "rate_limited",
      from: { instanceId: CLAUDE, model: "claude-sonnet-5-5" },
    });
    expect(decision.providerSwitched).toBe(true);
    expect(decision.reasonCodes).toEqual(
      expect.arrayContaining(["fallback_rate_limited", "provider_switch_handoff"]),
    );
  });

  it("treats an expired limit window as available again", () => {
    const decision = decideRoute(
      routeInput({
        providers: [claudeProvider({ usageLimits: exhausted("2026-11-01T11:00:00.000Z") })],
        thread: idleThread(),
      }),
    );
    expect(decision.selection?.instanceId).toBe(CLAUDE);
  });

  it("falls back when the thread's model was removed from the catalog", () => {
    const decision = decideRoute(
      routeInput({
        thread: idleThread({ currentSelection: selection(CLAUDE, "claude-sonnet-4-0") }),
      }),
    );
    expect(decision.fallback?.reason).toBe("model_removed");
    expect(decision.selection?.model).not.toBe("claude-sonnet-4-0");
  });

  it("uses the manual selection when fallback is disabled or nothing is eligible", () => {
    const disabled = decideRoute(
      routeInput({
        providers: [claudeProvider({ usageLimits: exhausted() }), codexProvider()],
        thread: idleThread(),
        settingsPatch: { fallbackEnabled: false },
      }),
    );
    expect(disabled.kind).toBe("manual_fallback");
    expect(disabled.reasonCodes).toContain("fallback_disabled");

    const none = decideRoute(
      routeInput({
        providers: [cursorProvider()],
        requestedSelection: selection(CURSOR, "composer-2"),
      }),
    );
    expect(none).toMatchObject({
      kind: "manual_fallback",
      selection: selection(CURSOR, "composer-2"),
    });
    expect(none.reasonCodes).toContain("no_eligible_model");
  });

  it("never falls back or escalates into a hidden model", () => {
    const decision = decideRoute(
      routeInput({
        text: "still failing with the same error",
        providers: [
          claudeProvider({
            models: claudeProvider().models.filter((model) => model.slug !== "claude-haiku-5-5"),
          }),
          codexProvider({ usageLimits: exhausted() }),
        ],
        settingsPatch: { escalation: { mode: "automatic", maxPerTask: 1 } },
        thread: idleThread({
          currentSelection: selection(CLAUDE, "claude-opus-5-5"),
          lastOutcome: { type: "verification_failed", evidence: ["`vp test` exited with code 1"] },
          previousComplexity: "complex",
        }),
      }),
    );
    expect(decision.selection?.model).not.toBe("claude-fable-5-1");
  });

  it("sets an effort level for new selections but never an expensive one", () => {
    const complex = decideRoute(
      routeInput({
        text: "Refactor the authentication flow across the entire codebase and migrate the tokens",
        preferencesPatch: { profile: "quality" },
      }),
    );
    expect(complex.selection?.options?.[0]?.value).toBe("high");
    const trivial = decideRoute(
      routeInput({ text: "thanks", preferencesPatch: { profile: "economy" } }),
    );
    expect(trivial.selection?.options?.[0]?.value).toBe("low");
  });

  it("applies project preferences without overriding global exclusions", () => {
    const preferred = decideRoute(
      routeInput({
        text: "Fix the typo in the README heading",
        preferencesPatch: { preferredModels: [{ model: "gpt-6-luna" }, { model: "gpt-6-astra" }] },
      }),
    );
    expect(preferred.selection?.model).not.toBe("gpt-6-astra");
    expect(preferred.selection?.instanceId).toBe(CODEX);
  });

  it("escalates automatically at most once per task when configured", () => {
    const thread = idleThread({
      lastOutcome: { type: "verification_failed", evidence: ["`vp test` exited with code 1"] },
      previousComplexity: "moderate",
    });
    const input = routeInput({
      text: "try again",
      settingsPatch: { escalation: { mode: "automatic", maxPerTask: 1 } },
      thread,
    });
    const first = decideRoute(input);
    expect(first.reasonCodes).toContain("escalation_automatic");
    expect(first.requiredTier).toBe(3);
    const exhaustedBudget = decideRoute({ ...input, thread: { ...thread, escalationsUsed: 1 } });
    expect(exhaustedBudget.reasonCodes).not.toContain("escalation_automatic");
  });

  it("does not escalate on its own when escalation asks first", () => {
    const decision = decideRoute(
      routeInput({
        text: "try again",
        thread: idleThread({
          lastOutcome: { type: "verification_failed", evidence: ["`vp test` exited with code 1"] },
        }),
      }),
    );
    expect(decision.reasonCodes).not.toContain("escalation_automatic");
  });

  it("uses an AI classification only for ambiguous requests", () => {
    const vague = decideRoute(
      routeInput({
        text: "Can you take a look at how the sidebar items are rendered and make them feel nicer to use please",
        aiClassification: { complexity: "complex" },
      }),
    );
    expect(vague).toMatchObject({ classifier: "ai", complexity: "complex" });
    const clear = decideRoute(
      routeInput({ text: "thanks", aiClassification: { complexity: "complex" } }),
    );
    expect(clear).toMatchObject({ classifier: "deterministic", complexity: "trivial" });
  });

  it("reports measured usage only from provider snapshots", () => {
    const decision = decideRoute(routeInput({ providers: [claudeProvider(), codexProvider()] }));
    expect(decision.usage).toEqual([
      { instanceId: CLAUDE, maxUsedPercent: null, checkedAt: null },
      { instanceId: CODEX, maxUsedPercent: null, checkedAt: null },
    ]);
  });
});

describe("computeEscalationOffer", () => {
  const base = {
    settings: routeInput().settings,
    preferences: routeInput().preferences,
    providers: [claudeProvider(), codexProvider()],
    nowMs: NOW_MS,
    runId: RUN_ID,
    runSelection: selection(CLAUDE, "claude-sonnet-5-5"),
    outcome: { type: "verification_failed", evidence: ["`vp test` exited with code 1"] } as const,
    userReportedFailure: false,
    escalationsUsed: 0,
    declinedOfferIds: [],
    supportsHandoff: true,
  };

  it("offers the next stronger allowed model on the same provider after a failed check", () => {
    expect(computeEscalationOffer(base)).toMatchObject({
      id: "escalate:run-1",
      failureKind: "verification_failed",
      evidence: ["`vp test` exited with code 1"],
      to: { instanceId: CLAUDE, model: "claude-opus-5-5" },
    });
  });

  it("does not offer escalation for environment failures, interruptions or success", () => {
    for (const outcome of [
      { type: "environment_failure", failureClass: "usage_limit" },
      { type: "environment_failure", failureClass: "transport_error" },
      { type: "interrupted" },
      { type: "success" },
      { type: "run_failed" },
    ] as const) {
      expect(computeEscalationOffer({ ...base, outcome })).toBeNull();
    }
  });

  it("respects the per-task limit, declines, the off switch and exclusions", () => {
    expect(computeEscalationOffer({ ...base, escalationsUsed: 1 })).toBeNull();
    expect(computeEscalationOffer({ ...base, declinedOfferIds: ["escalate:run-1"] })).toBeNull();
    expect(
      computeEscalationOffer({
        ...base,
        settings: { ...base.settings, escalation: { mode: "off", maxPerTask: 1 } },
      }),
    ).toBeNull();
    // Opus is the strongest visible Claude model; Fable stays hidden even for escalation.
    expect(
      computeEscalationOffer({
        ...base,
        providers: [claudeProvider()],
        runSelection: selection(CLAUDE, "claude-opus-5-5"),
      }),
    ).toBeNull();
  });

  it("offers escalation when the user reports the fix did not work", () => {
    expect(
      computeEscalationOffer({ ...base, outcome: { type: "success" }, userReportedFailure: true }),
    ).toMatchObject({ failureKind: "user_reported_failure", evidence: [] });
  });
});
