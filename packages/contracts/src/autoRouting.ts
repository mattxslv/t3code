import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  CommandId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  ProjectId,
  RunId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

export const AutoRoutingProfile = Schema.Literals(["economy", "balanced", "quality"]);
export type AutoRoutingProfile = typeof AutoRoutingProfile.Type;

export const AutoRoutingMode = Schema.Literals(["manual", "auto"]);
export type AutoRoutingMode = typeof AutoRoutingMode.Type;

/** 1 light, 2 standard, 3 strong, 4 frontier. */
export const AutoRoutingTier = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(4),
);
export type AutoRoutingTier = typeof AutoRoutingTier.Type;

/** A model matcher. Without `instanceId` it matches the model on every Claude or Codex instance. */
export const AutoRoutingModelRef = Schema.Struct({
  instanceId: Schema.optionalKey(ProviderInstanceId),
  model: TrimmedNonEmptyString,
});
export type AutoRoutingModelRef = typeof AutoRoutingModelRef.Type;

const AUTO_ROUTING_DEFAULT_HIDDEN_MODELS: ReadonlyArray<AutoRoutingModelRef> = [
  { model: "claude-fable-5-1" },
  { model: "gpt-6-astra" },
];

export const AutoRoutingEscalationMode = Schema.Literals(["ask", "automatic", "off"]);
export type AutoRoutingEscalationMode = typeof AutoRoutingEscalationMode.Type;

const withDefault = <S extends Schema.Top>(schema: S, value: S["Type"]) =>
  schema.pipe(Schema.withDecodingDefault(Effect.succeed(value as S["Encoded"])));

export const AutoRoutingEscalationSettings = Schema.Struct({
  mode: withDefault(AutoRoutingEscalationMode, "ask"),
  maxPerTask: withDefault(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(3)),
    1,
  ),
});
export type AutoRoutingEscalationSettings = typeof AutoRoutingEscalationSettings.Type;

export const AutoRoutingModelTierOverride = Schema.Struct({
  model: TrimmedNonEmptyString,
  tier: AutoRoutingTier,
});
export type AutoRoutingModelTierOverride = typeof AutoRoutingModelTierOverride.Type;

/** Environment-wide safety rules. Projects cannot override these. */
export const AutoRoutingSettings = Schema.Struct({
  /** Offers Auto in the model picker. Off keeps every thread manual. */
  enabled: withDefault(Schema.Boolean, false),
  /** Mode new threads start in once Auto is enabled. */
  defaultMode: withDefault(AutoRoutingMode, "manual"),
  /** Models Auto never selects, including for fallback and escalation. They stay manually selectable. */
  hiddenModels: withDefault(Schema.Array(AutoRoutingModelRef), AUTO_ROUTING_DEFAULT_HIDDEN_MODELS),
  escalation: withDefault(
    AutoRoutingEscalationSettings,
    Schema.decodeSync(AutoRoutingEscalationSettings)({}),
  ),
  /** Moves to another eligible subscription model when the routed one is unavailable or rate limited. */
  fallbackEnabled: withDefault(Schema.Boolean, true),
  /** API-key and cloud-billed provider instances are skipped unless this is on. */
  allowMeteredProviders: withDefault(Schema.Boolean, false),
  /** Accepts signed-in instances whose plan was not reported. Known API-key billing stays excluded. */
  allowUnverifiedAuth: withDefault(Schema.Boolean, false),
  /** Asks a light model to classify ambiguous requests. Never sees repository content. */
  aiClassification: withDefault(Schema.Boolean, false),
  /** Records what Auto would pick but sends with the manually selected model. */
  dryRun: withDefault(Schema.Boolean, false),
  recordHistory: withDefault(Schema.Boolean, true),
  modelTiers: withDefault(Schema.Array(AutoRoutingModelTierOverride), []),
});
export type AutoRoutingSettings = typeof AutoRoutingSettings.Type;
export const DEFAULT_AUTO_ROUTING_SETTINGS: AutoRoutingSettings = Schema.decodeSync(
  AutoRoutingSettings,
)({});

/** Per-project routing preferences; global exclusions still apply. */
export const AutoRoutingPreferences = Schema.Struct({
  profile: withDefault(AutoRoutingProfile, "balanced"),
  /** Earlier entries win ties. */
  preferredModels: withDefault(Schema.Array(AutoRoutingModelRef), []),
  preferredInstanceId: withDefault(Schema.NullOr(ProviderInstanceId), null),
});
export type AutoRoutingPreferences = typeof AutoRoutingPreferences.Type;
export const DEFAULT_AUTO_ROUTING_PREFERENCES: AutoRoutingPreferences = Schema.decodeSync(
  AutoRoutingPreferences,
)({});

/** Sent with a turn. `pinned` keeps the client's model and only records the pin. */
export const AutoRoutingRequest = Schema.Struct({
  mode: Schema.Literals(["auto", "pinned"]),
});
export type AutoRoutingRequest = typeof AutoRoutingRequest.Type;

export const AutoRoutingComplexity = Schema.Literals(["trivial", "simple", "moderate", "complex"]);
export type AutoRoutingComplexity = typeof AutoRoutingComplexity.Type;

export const AutoRoutingDecisionKind = Schema.Literals([
  "routed",
  "dry_run",
  "pinned",
  "kept_active",
  "escalation",
  "manual_fallback",
  "simulation",
]);
export type AutoRoutingDecisionKind = typeof AutoRoutingDecisionKind.Type;

export const AutoRoutingFallbackReason = Schema.Literals([
  "unavailable",
  "rate_limited",
  "model_removed",
  "excluded",
]);
export type AutoRoutingFallbackReason = typeof AutoRoutingFallbackReason.Type;

export const AutoRoutingCandidate = Schema.Struct({
  instanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  tier: AutoRoutingTier,
  score: Schema.NullOr(Schema.Number),
  excluded: Schema.NullOr(Schema.String),
});
export type AutoRoutingCandidate = typeof AutoRoutingCandidate.Type;

/** Measured usage only; `null` means the provider did not report it. */
export const AutoRoutingUsageObservation = Schema.Struct({
  instanceId: ProviderInstanceId,
  maxUsedPercent: Schema.NullOr(Schema.Number),
  checkedAt: Schema.NullOr(IsoDateTime),
});
export type AutoRoutingUsageObservation = typeof AutoRoutingUsageObservation.Type;

export const AutoRoutingFeedback = Schema.Literals(["good", "bad"]);
export type AutoRoutingFeedback = typeof AutoRoutingFeedback.Type;

/** Holds reason codes and model ids, never message or repository text. */
export const AutoRoutingDecision = Schema.Struct({
  id: TrimmedNonEmptyString,
  commandId: Schema.NullOr(CommandId),
  messageId: Schema.NullOr(MessageId),
  threadId: Schema.NullOr(ThreadId),
  projectId: Schema.NullOr(ProjectId),
  createdAt: IsoDateTime,
  kind: AutoRoutingDecisionKind,
  selection: Schema.NullOr(ModelSelection),
  requestedSelection: Schema.NullOr(ModelSelection),
  previousSelection: Schema.NullOr(ModelSelection),
  profile: AutoRoutingProfile,
  complexity: AutoRoutingComplexity,
  requiredTier: AutoRoutingTier,
  classifier: Schema.Literals(["deterministic", "ai", "ai_failed"]),
  confidence: Schema.Number,
  continuation: Schema.Boolean,
  reasonCodes: Schema.Array(Schema.String),
  summary: Schema.String,
  providerSwitched: Schema.Boolean,
  fallback: Schema.NullOr(
    Schema.Struct({ reason: AutoRoutingFallbackReason, from: AutoRoutingModelRef }),
  ),
  usage: Schema.Array(AutoRoutingUsageObservation),
  candidates: Schema.Array(AutoRoutingCandidate),
  latencyMs: NonNegativeInt,
  feedback: Schema.NullOr(AutoRoutingFeedback),
});
export type AutoRoutingDecision = typeof AutoRoutingDecision.Type;

export const AutoRoutingFailureKind = Schema.Literals([
  "verification_failed",
  "user_reported_failure",
  "run_failed",
]);
export type AutoRoutingFailureKind = typeof AutoRoutingFailureKind.Type;

export const AutoRoutingEscalationOffer = Schema.Struct({
  id: TrimmedNonEmptyString,
  runId: RunId,
  failureKind: AutoRoutingFailureKind,
  evidence: Schema.Array(Schema.String),
  from: ModelSelection,
  to: ModelSelection,
  toName: TrimmedNonEmptyString,
});
export type AutoRoutingEscalationOffer = typeof AutoRoutingEscalationOffer.Type;

export const AutoRoutingThreadState = Schema.Struct({
  threadId: ThreadId,
  mode: Schema.NullOr(Schema.Literals(["auto", "pinned"])),
  escalationsUsed: NonNegativeInt,
  latestDecision: Schema.NullOr(AutoRoutingDecision),
  pendingEscalation: Schema.NullOr(AutoRoutingEscalationOffer),
});
export type AutoRoutingThreadState = typeof AutoRoutingThreadState.Type;

export const AutoRoutingGetThreadStateInput = Schema.Struct({ threadId: ThreadId });

export const AutoRoutingListHistoryInput = Schema.Struct({
  threadId: Schema.optionalKey(ThreadId),
  projectId: Schema.optionalKey(ProjectId),
  limit: Schema.optionalKey(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(500)),
  ),
});
export type AutoRoutingListHistoryInput = typeof AutoRoutingListHistoryInput.Type;

export const AutoRoutingHistoryStats = Schema.Struct({
  total: NonNegativeInt,
  byModel: Schema.Array(
    Schema.Struct({ instanceId: ProviderInstanceId, model: Schema.String, count: NonNegativeInt }),
  ),
  providerSwitches: NonNegativeInt,
  escalations: NonNegativeInt,
  fallbacks: NonNegativeInt,
  dryRuns: NonNegativeInt,
  feedbackGood: NonNegativeInt,
  feedbackBad: NonNegativeInt,
  averageLatencyMs: Schema.NullOr(Schema.Number),
});
export type AutoRoutingHistoryStats = typeof AutoRoutingHistoryStats.Type;

export const AutoRoutingHistory = Schema.Struct({
  decisions: Schema.Array(AutoRoutingDecision),
  stats: AutoRoutingHistoryStats,
});
export type AutoRoutingHistory = typeof AutoRoutingHistory.Type;

export const AutoRoutingSimulateInput = Schema.Struct({
  text: Schema.String.check(Schema.isMaxLength(20_000)),
  projectId: Schema.optionalKey(ProjectId),
  threadId: Schema.optionalKey(ThreadId),
  profile: Schema.optionalKey(AutoRoutingProfile),
  /** Lets the simulator run the AI classifier even when it is off in settings. */
  allowAiClassification: Schema.optionalKey(Schema.Boolean),
});
export type AutoRoutingSimulateInput = typeof AutoRoutingSimulateInput.Type;

export const AutoRoutingDiagnosticsInput = Schema.Struct({
  projectId: Schema.optionalKey(ProjectId),
});

export const AutoRoutingModelDiagnostic = Schema.Struct({
  instanceId: ProviderInstanceId,
  driver: Schema.String,
  model: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  tier: AutoRoutingTier,
  tierSource: Schema.Literals(["override", "catalog"]),
  hidden: Schema.Boolean,
  eligible: Schema.Boolean,
  excludedReason: Schema.NullOr(Schema.String),
});
export type AutoRoutingModelDiagnostic = typeof AutoRoutingModelDiagnostic.Type;

export const AutoRoutingDiagnostics = Schema.Struct({
  enabled: Schema.Boolean,
  profile: AutoRoutingProfile,
  models: Schema.Array(AutoRoutingModelDiagnostic),
  usage: Schema.Array(AutoRoutingUsageObservation),
  issues: Schema.Array(Schema.String),
});
export type AutoRoutingDiagnostics = typeof AutoRoutingDiagnostics.Type;

export const AutoRoutingRespondEscalationInput = Schema.Struct({
  threadId: ThreadId,
  offerId: TrimmedNonEmptyString,
  accept: Schema.Boolean,
  commandId: CommandId,
});
export type AutoRoutingRespondEscalationInput = typeof AutoRoutingRespondEscalationInput.Type;

export const AutoRoutingSubmitFeedbackInput = Schema.Struct({
  decisionId: TrimmedNonEmptyString,
  feedback: Schema.NullOr(AutoRoutingFeedback),
});
export type AutoRoutingSubmitFeedbackInput = typeof AutoRoutingSubmitFeedbackInput.Type;

export class AutoRoutingError extends Schema.TaggedError<AutoRoutingError>()("AutoRoutingError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}
