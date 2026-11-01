import type {
  AutoRoutingCandidate,
  AutoRoutingComplexity,
  AutoRoutingDecision,
  AutoRoutingEscalationOffer,
  AutoRoutingFallbackReason,
  AutoRoutingPreferences,
  AutoRoutingProfile,
  AutoRoutingSettings,
  AutoRoutingTier,
  ModelSelection,
  ProviderInstanceId,
  RunId,
  ServerProvider,
} from "@t3tools/contracts";

import { type Classification, classifyTask } from "./classifier.ts";
import {
  AUTO_ROUTING_EXCLUSION_LABELS,
  type AutoRoutingModelEntry,
  listAutoRoutingModels,
  modelRefMatches,
  usageObservations,
} from "./eligibility.ts";
import type { RunOutcome } from "./failureAnalysis.ts";
import { effortForComplexity, effortOptionFor } from "./modelCapabilities.ts";

export interface RouteThreadContext {
  readonly currentSelection: ModelSelection;
  /** The thread has run at least one turn, so a provider change needs a handoff. */
  readonly started: boolean;
  readonly supportsHandoff: boolean;
  readonly activeWork: "active_run" | "pending_request" | null;
  readonly priorTurns: number;
  readonly previousComplexity: AutoRoutingComplexity | null;
  readonly lastOutcome: RunOutcome;
  readonly escalationsUsed: number;
  /** The task's model while side questions ran elsewhere; a follow-up returns to it. */
  readonly resumeSelection?: ModelSelection | null;
}

export interface RouteInput {
  readonly text: string;
  readonly attachmentCount: number;
  readonly settings: AutoRoutingSettings;
  readonly preferences: AutoRoutingPreferences;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly nowMs: number;
  readonly instanceEnabledForProject?: (instanceId: ProviderInstanceId) => boolean;
  readonly thread: RouteThreadContext | null;
  /** What the client would have sent manually. Used for dry runs and manual fallback. */
  readonly requestedSelection: ModelSelection | null;
  readonly aiClassification?: {
    readonly complexity: AutoRoutingComplexity;
  } | null;
  readonly aiClassificationFailed?: boolean;
}

export type RouteDecision = Omit<
  AutoRoutingDecision,
  | "id"
  | "commandId"
  | "messageId"
  | "threadId"
  | "projectId"
  | "createdAt"
  | "latencyMs"
  | "feedback"
  | "kind"
> & {
  readonly kind: "routed" | "kept_active" | "manual_fallback";
  readonly classification: Classification;
};

const REQUIRED_TIER: Record<AutoRoutingProfile, Record<AutoRoutingComplexity, AutoRoutingTier>> = {
  economy: { trivial: 1, simple: 1, moderate: 2, complex: 3 },
  balanced: { trivial: 1, simple: 2, moderate: 2, complex: 3 },
  quality: { trivial: 2, simple: 2, moderate: 3, complex: 4 },
};

const OVERSHOOT_PENALTY: Record<AutoRoutingProfile, number> = {
  economy: 3,
  balanced: 1.5,
  quality: 0.4,
};
const USAGE_WEIGHT: Record<AutoRoutingProfile, number> = {
  economy: 0.6,
  balanced: 0.25,
  quality: 0.05,
};

/** Classification plus the optional AI refinement; AI only overrides an ambiguous local result. */
const AI_CLASSIFICATION_CONFIDENCE_THRESHOLD = 0.6;

export function shouldAskAiClassifier(classification: Classification, textLength: number): boolean {
  return (
    classification.confidence < AI_CLASSIFICATION_CONFIDENCE_THRESHOLD &&
    !classification.continuation &&
    textLength >= 40
  );
}

function wantsEscalationNow(input: RouteInput, classification: Classification): boolean {
  const thread = input.thread;
  if (thread === null) return false;
  if (input.settings.escalation.mode !== "automatic") return false;
  if (thread.escalationsUsed >= input.settings.escalation.maxPerTask) return false;
  return thread.lastOutcome.type === "verification_failed" || classification.userReportedFailure;
}

function selectionFor(
  entry: AutoRoutingModelEntry,
  complexity: AutoRoutingComplexity,
  profile: AutoRoutingProfile,
  keep: ModelSelection | null,
): ModelSelection {
  if (
    keep !== null &&
    keep.instanceId === entry.provider.instanceId &&
    (keep.model === entry.model.slug || (entry.model.aliases ?? []).includes(keep.model))
  ) {
    return keep;
  }
  const effort = effortOptionFor(entry.model, effortForComplexity(complexity, profile));
  return {
    instanceId: entry.provider.instanceId,
    model: entry.model.slug,
    ...(effort === null ? {} : { options: [effort] }),
  };
}

function entryMatchesSelection(entry: AutoRoutingModelEntry, selection: ModelSelection): boolean {
  return (
    entry.provider.instanceId === selection.instanceId &&
    (entry.model.slug === selection.model || (entry.model.aliases ?? []).includes(selection.model))
  );
}

function fallbackReasonFor(
  entries: ReadonlyArray<AutoRoutingModelEntry>,
  selection: ModelSelection,
): AutoRoutingFallbackReason | null {
  const entry = entries.find((candidate) => entryMatchesSelection(candidate, selection));
  if (entry === undefined) {
    // Only Claude/Codex instances are listed; a missing other-driver model is not a fallback.
    const instanceListed = entries.some(
      (candidate) => candidate.provider.instanceId === selection.instanceId,
    );
    return instanceListed ? "model_removed" : null;
  }
  switch (entry.exclusion) {
    case null:
      return null;
    case "usage_exhausted":
      return "rate_limited";
    case "provider_unavailable":
    case "provider_disabled":
    case "provider_not_installed":
    case "provider_unauthenticated":
    case "provider_error":
    case "project_disabled":
      return "unavailable";
    default:
      return "excluded";
  }
}

function providerLabel(provider: ServerProvider): string {
  return provider.displayName ?? (provider.driver === "codex" ? "Codex" : "Claude");
}

function modelLabel(entry: AutoRoutingModelEntry): string {
  return entry.model.shortName ?? entry.model.name;
}

function describe(input: {
  readonly entry: AutoRoutingModelEntry | null;
  readonly complexity: AutoRoutingComplexity;
  readonly codes: ReadonlyArray<string>;
  readonly kind: RouteDecision["kind"];
}): string {
  const { entry, codes } = input;
  if (input.kind === "kept_active") return "Kept the current model while work is in progress";
  if (entry === null) return "No eligible Auto model; using the manual selection";
  const parts: string[] = [`${input.complexity} task`];
  if (codes.includes("escalation_automatic")) parts.push("escalated after a failed attempt");
  if (codes.includes("continuation_kept_model")) parts.push("continuing the current task");
  else if (codes.includes("provider_continuity"))
    parts.push(`staying on ${providerLabel(entry.provider)}`);
  if (codes.includes("provider_switch_handoff"))
    parts.push(`switching to ${providerLabel(entry.provider)} with context handoff`);
  if (codes.includes("fallback_rate_limited")) parts.push("previous model is rate limited");
  if (codes.includes("fallback_unavailable")) parts.push("previous model is unavailable");
  if (codes.includes("fallback_model_removed")) parts.push("previous model was removed");
  if (codes.includes("fallback_excluded")) parts.push("previous model is excluded from Auto");
  if (codes.includes("usage_low_headroom")) parts.push("avoiding a nearly used-up limit");
  if (codes.includes("preferred_model")) parts.push("project preference");
  return `${modelLabel(entry)} · ${parts.join(", ")}`;
}

function toCandidate(entry: AutoRoutingModelEntry, score: number | null): AutoRoutingCandidate {
  return {
    instanceId: entry.provider.instanceId,
    model: entry.model.slug,
    name: entry.model.name,
    tier: entry.profile.tier,
    score: score === null ? null : Math.round(score * 100) / 100,
    excluded: entry.exclusion === null ? null : AUTO_ROUTING_EXCLUSION_LABELS[entry.exclusion],
  };
}

/** FNV-1a; only needs to be stable and well spread, not secure. */
function stableHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function decideRoute(input: RouteInput): RouteDecision {
  const { settings, preferences, thread } = input;
  const profile = preferences.profile;
  const entries = listAutoRoutingModels({
    providers: input.providers,
    settings,
    nowMs: input.nowMs,
    ...(input.instanceEnabledForProject === undefined
      ? {}
      : { instanceEnabledForProject: input.instanceEnabledForProject }),
  });
  const usage = usageObservations(input.providers);

  const deterministic = classifyTask({
    text: input.text,
    attachmentCount: input.attachmentCount,
    history: {
      priorTurns: thread?.priorTurns ?? 0,
      previousComplexity: thread?.previousComplexity ?? null,
      previousTurnFailed:
        thread?.lastOutcome.type === "verification_failed" ||
        thread?.lastOutcome.type === "run_failed",
    },
  });
  const usedAi =
    input.aiClassification != null &&
    deterministic.confidence < AI_CLASSIFICATION_CONFIDENCE_THRESHOLD;
  const classification: Classification = usedAi
    ? { ...deterministic, complexity: input.aiClassification!.complexity, confidence: 0.75 }
    : deterministic;
  const complexity = classification.complexity;
  const codes: string[] = [`complexity_${complexity}`, `profile_${profile}`];
  if (usedAi) codes.push("ai_classified");
  if (input.aiClassificationFailed) codes.push("ai_classification_failed");
  if (classification.userReportedFailure) codes.push("user_reported_failure");
  if (input.attachmentCount > 0) codes.push("attachments_present");
  // A quick unrelated question in the middle of real work: answer it cheaply without letting
  // it reset the task, so the next follow-up goes back to the task's level.
  const sideQuestion =
    thread !== null &&
    thread.started &&
    !classification.continuation &&
    complexity === "trivial" &&
    classification.signals.includes("question") &&
    (thread.previousComplexity === "moderate" || thread.previousComplexity === "complex");
  if (sideQuestion) codes.push("side_question");

  const base = {
    profile,
    complexity,
    classifier: usedAi
      ? ("ai" as const)
      : input.aiClassificationFailed
        ? ("ai_failed" as const)
        : ("deterministic" as const),
    confidence: Math.round(classification.confidence * 100) / 100,
    continuation: classification.continuation,
    requestedSelection: input.requestedSelection,
    previousSelection: thread?.currentSelection ?? null,
    usage,
    classification,
  };

  if (thread !== null && thread.activeWork !== null) {
    codes.push(
      thread.activeWork === "active_run" ? "active_run_kept_model" : "pending_approval_kept_model",
    );
    return {
      ...base,
      kind: "kept_active",
      selection: thread.currentSelection,
      requiredTier: REQUIRED_TIER[profile][complexity],
      reasonCodes: codes,
      summary: describe({ entry: null, complexity, codes, kind: "kept_active" }),
      providerSwitched: false,
      fallback: null,
      candidates: entries.map((entry) => toCandidate(entry, null)),
    };
  }

  const escalateNow = wantsEscalationNow(input, classification);
  let requiredTier = REQUIRED_TIER[profile][complexity];
  if (escalateNow) {
    requiredTier = Math.min(4, requiredTier + 1) as AutoRoutingTier;
    codes.push("prior_failure_upgrade");
  }

  const currentSelection = thread?.currentSelection ?? null;
  const switchBlocked = (entry: AutoRoutingModelEntry) =>
    thread !== null &&
    thread.started &&
    !thread.supportsHandoff &&
    entry.provider.instanceId !== thread.currentSelection.instanceId;

  const eligible = entries.filter((entry) => entry.exclusion === null && !switchBlocked(entry));
  const fallbackReason =
    currentSelection === null ? null : fallbackReasonFor(entries, currentSelection);
  const scores = new Map<AutoRoutingModelEntry, number>();
  let currentTier: AutoRoutingTier | null = null;
  if (currentSelection !== null) {
    const currentEntry = entries.find((entry) => entryMatchesSelection(entry, currentSelection));
    currentTier = currentEntry?.profile.tier ?? null;
  }

  for (const entry of eligible) {
    const tier = entry.profile.tier;
    let score = 0;
    if (tier < requiredTier) score -= 10 * (requiredTier - tier);
    else score -= OVERSHOOT_PENALTY[profile] * (tier - requiredTier);
    if (escalateNow && currentTier !== null && tier <= currentTier) score -= 6;
    score -= USAGE_WEIGHT[profile] * entry.profile.usageWeight;
    if ((complexity === "trivial" || complexity === "simple") && profile !== "quality") {
      score += entry.profile.speed * 0.4;
    }
    if (entry.maxUsedPercent !== null) {
      if (entry.maxUsedPercent >= 90) score -= 4;
      else if (entry.maxUsedPercent >= 75) score -= 1.5;
    }
    if (thread !== null && thread.started) {
      if (entry.provider.instanceId === thread.currentSelection.instanceId) score += 2;
      if (entryMatchesSelection(entry, thread.currentSelection)) score += 1;
    }
    const preferredIndex = preferences.preferredModels.findIndex((ref) =>
      modelRefMatches(ref, entry.provider.instanceId, entry.model),
    );
    if (preferredIndex >= 0) score += Math.max(0.5, 3 - preferredIndex * 0.5);
    if (preferences.preferredInstanceId === entry.provider.instanceId) score += 1;
    if (!entry.profile.known) score -= 1;
    scores.set(entry, score);
  }

  const onCurrentInstance = (entry: AutoRoutingModelEntry) =>
    Number(entry.provider.instanceId === currentSelection?.instanceId);
  // Equal scores are not a provider preference: favor measured headroom, then split by request.
  const spread = stableHash(input.text);
  const ranked = [...scores.entries()].toSorted(
    ([left, leftScore], [right, rightScore]) =>
      rightScore - leftScore ||
      onCurrentInstance(right) - onCurrentInstance(left) ||
      (left.maxUsedPercent ?? 0) - (right.maxUsedPercent ?? 0) ||
      ((stableHash(left.provider.instanceId) ^ spread) >>> 0) -
        ((stableHash(right.provider.instanceId) ^ spread) >>> 0) ||
      left.model.slug.localeCompare(right.model.slug),
  );
  const candidates = entries.map((entry) => toCandidate(entry, scores.get(entry) ?? null));

  const fallbackAllowed =
    settings.fallbackEnabled || fallbackReason === null || fallbackReason === "excluded";
  if (ranked.length === 0 || !fallbackAllowed) {
    codes.push(ranked.length === 0 ? "no_eligible_model" : "fallback_disabled");
    return {
      ...base,
      kind: "manual_fallback",
      selection: input.requestedSelection ?? currentSelection,
      requiredTier,
      reasonCodes: codes,
      summary: describe({ entry: null, complexity, codes, kind: "manual_fallback" }),
      providerSwitched: false,
      fallback: null,
      candidates,
    };
  }

  // A follow-up keeps its model when that model still meets the bar, avoiding needless switches.
  // It steps down once the model is more than a tier above the need, so a thread never stays on
  // its strongest model for every acknowledgement after one hard turn.
  let chosen = ranked[0]![0];
  if (
    classification.continuation &&
    currentSelection !== null &&
    fallbackReason === null &&
    !escalateNow
  ) {
    const target = thread?.resumeSelection ?? currentSelection;
    const current = eligible.find((entry) => entryMatchesSelection(entry, target));
    if (
      current !== undefined &&
      current.profile.tier >= requiredTier &&
      current.profile.tier <= requiredTier + 1
    ) {
      chosen = current;
      codes.push("continuation_kept_model");
    }
  }

  if (escalateNow) codes.push("escalation_automatic");
  const providerSwitched =
    currentSelection !== null &&
    thread !== null &&
    thread.started &&
    chosen.provider.instanceId !== currentSelection.instanceId;
  if (providerSwitched) codes.push("provider_switch_handoff");
  else if (thread?.started) codes.push("provider_continuity");
  if (
    fallbackReason !== null &&
    currentSelection !== null &&
    !entryMatchesSelection(chosen, currentSelection)
  ) {
    codes.push(`fallback_${fallbackReason}`);
  }
  if (chosen.maxUsedPercent !== null && chosen.maxUsedPercent >= 75)
    codes.push("usage_high_measured");
  if (ranked.some(([entry]) => entry.maxUsedPercent !== null && entry.maxUsedPercent >= 90)) {
    codes.push("usage_low_headroom");
  }
  if (
    preferences.preferredModels.some((ref) =>
      modelRefMatches(ref, chosen.provider.instanceId, chosen.model),
    )
  ) {
    codes.push("preferred_model");
  }

  // Returning to the task's model also restores its options, such as effort.
  const resumed =
    thread?.resumeSelection != null && entryMatchesSelection(chosen, thread.resumeSelection)
      ? thread.resumeSelection
      : null;
  const keepOptions = escalateNow ? null : (resumed ?? currentSelection);
  const selection = selectionFor(chosen, complexity, profile, keepOptions);
  return {
    ...base,
    kind: "routed",
    selection,
    requiredTier,
    reasonCodes: codes,
    summary: describe({ entry: chosen, complexity, codes, kind: "routed" }),
    providerSwitched,
    fallback:
      fallbackReason !== null &&
      currentSelection !== null &&
      !entryMatchesSelection(chosen, currentSelection)
        ? {
            reason: fallbackReason,
            from: { instanceId: currentSelection.instanceId, model: currentSelection.model },
          }
        : null,
    candidates,
  };
}

/** A stronger, allowed model to offer after a reasoning failure; never for environment failures. */
export function computeEscalationOffer(input: {
  readonly settings: AutoRoutingSettings;
  readonly preferences: AutoRoutingPreferences;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly nowMs: number;
  readonly instanceEnabledForProject?: (instanceId: ProviderInstanceId) => boolean;
  readonly runId: RunId;
  readonly runSelection: ModelSelection;
  readonly outcome: RunOutcome;
  readonly userReportedFailure: boolean;
  readonly escalationsUsed: number;
  readonly declinedOfferIds: ReadonlyArray<string>;
  readonly supportsHandoff: boolean;
}): AutoRoutingEscalationOffer | null {
  if (input.settings.escalation.mode === "off") return null;
  if (input.escalationsUsed >= input.settings.escalation.maxPerTask) return null;
  const failureKind =
    input.outcome.type === "verification_failed"
      ? ("verification_failed" as const)
      : input.userReportedFailure
        ? ("user_reported_failure" as const)
        : null;
  if (failureKind === null) return null;
  const id = `escalate:${input.runId}`;
  if (input.declinedOfferIds.includes(id)) return null;
  const entries = listAutoRoutingModels({
    providers: input.providers,
    settings: input.settings,
    nowMs: input.nowMs,
    ...(input.instanceEnabledForProject === undefined
      ? {}
      : { instanceEnabledForProject: input.instanceEnabledForProject }),
  });
  const current = entries.find((entry) => entryMatchesSelection(entry, input.runSelection));
  const currentTier = current?.profile.tier ?? 2;
  const stronger = entries
    .filter(
      (entry) =>
        entry.exclusion === null &&
        entry.profile.tier > currentTier &&
        (input.supportsHandoff || entry.provider.instanceId === input.runSelection.instanceId),
    )
    .toSorted(
      (left, right) =>
        left.profile.tier - right.profile.tier ||
        Number(right.provider.instanceId === input.runSelection.instanceId) -
          Number(left.provider.instanceId === input.runSelection.instanceId) ||
        (left.maxUsedPercent ?? 0) - (right.maxUsedPercent ?? 0) ||
        left.model.slug.localeCompare(right.model.slug),
    );
  const target = stronger[0];
  if (target === undefined) return null;
  return {
    id,
    runId: input.runId,
    failureKind,
    evidence:
      input.outcome.type === "verification_failed" ? input.outcome.evidence.slice(0, 5) : [],
    from: input.runSelection,
    to: selectionFor(target, "complex", input.preferences.profile, null),
    toName: target.model.name,
  };
}
