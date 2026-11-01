import {
  type AutoRoutingComplexity,
  type AutoRoutingDecision,
  type AutoRoutingDiagnostics,
  AutoRoutingError,
  type AutoRoutingEscalationOffer,
  type AutoRoutingHistory,
  type AutoRoutingListHistoryInput,
  type AutoRoutingRequest,
  type AutoRoutingRespondEscalationInput,
  type AutoRoutingSimulateInput,
  type AutoRoutingSubmitFeedbackInput,
  type AutoRoutingThreadState,
  CommandId,
  MessageId,
  type ModelSelection,
  type OrchestrationV2Command,
  type OrchestrationV2ThreadProjection,
  type ProjectId,
  type ProviderInstanceId,
  resolveProjectProviderInstanceEnabled,
  type ServerSettings,
  type ThreadId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettingsService from "../serverSettings.ts";
import { AutoRoutingStore, type AutoRoutingThreadRecord } from "./AutoRoutingStore.ts";
import { classifyTask } from "./classifier.ts";
import {
  AUTO_ROUTING_EXCLUSION_LABELS,
  listAutoRoutingModels,
  usageObservations,
} from "./eligibility.ts";
import {
  computeEscalationOffer,
  decideRoute,
  type RouteDecision,
  type RouteInput,
  type RouteThreadContext,
  shouldAskAiClassifier,
} from "./engine.ts";
import { analyzeRunOutcome, hasActiveWork } from "./failureAnalysis.ts";

type MessageDispatchCommand = Extract<
  OrchestrationV2Command,
  { readonly type: "message.dispatch" }
>;

export interface RoutableLaunchInput {
  readonly commandId: CommandId;
  readonly threadId?: ThreadId;
  readonly projectId: ProjectId;
  readonly modelSelection: ModelSelection;
  readonly autoRouting?: AutoRoutingRequest;
  readonly initialMessage?: {
    readonly messageId?: MessageId;
    readonly text: string;
    readonly attachments: ReadonlyArray<unknown>;
  };
}

export interface AutoRoutingServiceShape {
  /** Never fails: any routing error leaves the client's manual selection in place. */
  readonly resolveDispatch: (
    command: MessageDispatchCommand,
  ) => Effect.Effect<MessageDispatchCommand>;
  readonly resolveLaunch: <Input extends RoutableLaunchInput>(input: Input) => Effect.Effect<Input>;
  readonly getThreadState: (
    threadId: ThreadId,
  ) => Effect.Effect<AutoRoutingThreadState, AutoRoutingError>;
  readonly listHistory: (
    input: AutoRoutingListHistoryInput,
  ) => Effect.Effect<AutoRoutingHistory, AutoRoutingError>;
  readonly simulate: (
    input: AutoRoutingSimulateInput,
  ) => Effect.Effect<AutoRoutingDecision, AutoRoutingError>;
  readonly getDiagnostics: (input: {
    readonly projectId?: ProjectId;
  }) => Effect.Effect<AutoRoutingDiagnostics, AutoRoutingError>;
  readonly respondEscalation: (
    input: AutoRoutingRespondEscalationInput,
  ) => Effect.Effect<AutoRoutingThreadState, AutoRoutingError>;
  readonly submitFeedback: (
    input: AutoRoutingSubmitFeedbackInput,
  ) => Effect.Effect<void, AutoRoutingError>;
  readonly clearHistory: Effect.Effect<void, AutoRoutingError>;
}

export class AutoRoutingService extends Context.Service<
  AutoRoutingService,
  AutoRoutingServiceShape
>()("t3/autoRouting/AutoRoutingService") {}

const AI_CLASSIFICATION_TIMEOUT = Duration.seconds(10);
const THREAD_RECORD_FIELDS = [
  "runs",
  "runtimeRequests",
  "providerSessions",
  "providerThreads",
] as const;

/** Model-facing continuation sent when the user approves an escalation. */
function buildEscalationMessage(offer: AutoRoutingEscalationOffer): string {
  const lines = [
    offer.failureKind === "verification_failed"
      ? "The previous attempt did not pass verification:"
      : "The previous attempt did not resolve the problem, according to the user.",
    ...offer.evidence.map((line) => `- ${line}`),
    "",
    "Continue the same task with a fresh look. Reuse the findings, diffs and command output already in this thread instead of starting over.",
    "Before re-running anything destructive or irreversible (deleting files or data, migrations, deploys, pushes, publishing), check whether the previous attempt already did it, and do not repeat it.",
    "Finish by running the relevant checks again to confirm the fix.",
  ];
  return lines.join("\n");
}

const sessionSupportsHandoff = (
  records: Pick<OrchestrationV2ThreadProjection, "thread" | "providerSessions" | "providerThreads">,
): boolean => {
  const attached = records.providerThreads.find(
    (providerThread) =>
      providerThread.appThreadId === records.thread.id && providerThread.providerSessionId !== null,
  );
  const session =
    attached === undefined
      ? undefined
      : records.providerSessions.find((candidate) => candidate.id === attached.providerSessionId);
  // No live session means the next turn opens one with a portable handoff.
  return session === undefined
    ? true
    : session.capabilities.sessions.supportsProviderSwitchingViaHandoff;
};

const make = Effect.gen(function* () {
  const store = yield* AutoRoutingStore;
  const settingsService = yield* ServerSettingsService.ServerSettingsService;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const instances = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const crypto = yield* Crypto.Crypto;
  const newId = crypto.randomUUIDv4().pipe(Effect.orDie);
  const fileSystem = yield* FileSystem.FileSystem;
  // Latest decision per thread when history recording is off, so the UI can still explain it.
  const unrecorded = new Map<ThreadId, AutoRoutingDecision>();

  const readSettings = settingsService.getSettings.pipe(
    Effect.mapError(
      (cause) => new AutoRoutingError({ message: "Could not read settings.", cause }),
    ),
  );

  const projectScope = (settings: ServerSettings, projectId: ProjectId | null) => ({
    preferences: resolveProjectSettings(settings, projectId).settings.autoRoutingPreferences,
    instanceEnabledForProject: (instanceId: ProviderInstanceId) =>
      resolveProjectProviderInstanceEnabled(settings, projectId, instanceId),
  });

  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const latestDecision = (threadId: ThreadId) =>
    store
      .latestForThread(threadId)
      .pipe(Effect.map((decision) => decision ?? unrecorded.get(threadId) ?? null));

  const emptyThreadRecord = (threadId: ThreadId, updatedAt: string): AutoRoutingThreadRecord => ({
    threadId,
    mode: null,
    escalationsUsed: 0,
    taskDecisionId: null,
    declinedOfferIds: [],
    acceptedOfferIds: [],
    updatedAt,
  });

  const recordDecision = Effect.fn("AutoRoutingService.recordDecision")(function* (
    settings: ServerSettings,
    decision: AutoRoutingDecision,
  ) {
    if (settings.autoRouting.recordHistory) {
      yield* store.insertDecision(decision);
      if (decision.threadId !== null) unrecorded.delete(decision.threadId);
    } else if (decision.threadId !== null) {
      unrecorded.set(decision.threadId, decision);
      if (unrecorded.size > 500) unrecorded.delete(unrecorded.keys().next().value!);
    }
  });

  const loadThreadContext = Effect.fn("AutoRoutingService.loadThreadContext")(function* (
    threadId: ThreadId,
  ) {
    const records = yield* threads.getThreadRecords(threadId, THREAD_RECORD_FIELDS);
    const lastRun = records.runs.findLast((run) => run.status !== "queued");
    const items =
      lastRun === undefined
        ? []
        : (yield* threads.getThreadRecords(threadId, ["turnItems"], {
            turnItemRunIds: [lastRun.id],
            turnItemTypes: ["command_execution", "error"],
          })).turnItems;
    const outcome = analyzeRunOutcome({ run: lastRun, items });
    return { records, lastRun, outcome };
  });

  const buildThreadContext = (
    loaded: Effect.Success<ReturnType<typeof loadThreadContext>>,
    previous: AutoRoutingDecision | null,
    threadRecord: AutoRoutingThreadRecord | null,
  ): RouteThreadContext => ({
    currentSelection: loaded.records.thread.modelSelection,
    started: loaded.records.runs.length > 0,
    supportsHandoff: sessionSupportsHandoff(loaded.records),
    activeWork: hasActiveWork(loaded.records.runs, loaded.records.runtimeRequests),
    priorTurns: loaded.records.runs.filter((run) => run.status !== "queued").length,
    previousComplexity: previous?.complexity ?? null,
    lastOutcome: loaded.outcome,
    escalationsUsed: threadRecord?.escalationsUsed ?? 0,
  });

  /** Only for ambiguous requests, only when enabled, and only on an eligible light model. */
  const classifyWithAi = Effect.fn("AutoRoutingService.classifyWithAi")(function* (
    input: RouteInput,
    allowed: boolean,
  ): Effect.fn.Return<{ readonly complexity: AutoRoutingComplexity } | "failed" | null> {
    if (!allowed) return null;
    const local = classifyTask({
      text: input.text,
      attachmentCount: input.attachmentCount,
      history: {
        priorTurns: input.thread?.priorTurns ?? 0,
        previousComplexity: input.thread?.previousComplexity ?? null,
        previousTurnFailed: false,
      },
    });
    if (!shouldAskAiClassifier(local, input.text.length)) return null;
    const classifier = listAutoRoutingModels({
      providers: input.providers,
      settings: input.settings,
      nowMs: input.nowMs,
      ...(input.instanceEnabledForProject === undefined
        ? {}
        : { instanceEnabledForProject: input.instanceEnabledForProject }),
    })
      .filter(
        (entry) => entry.exclusion === null && entry.provider.supportsTextGeneration !== false,
      )
      .toSorted((left, right) => left.profile.usageWeight - right.profile.usageWeight)[0];
    if (classifier === undefined) return "failed";
    const instance = yield* instances.getInstance(classifier.provider.instanceId);
    const classify = instance?.textGeneration.classifyRoutingTask;
    if (classify === undefined) return "failed";
    return yield* Effect.scoped(
      Effect.gen(function* () {
        // An empty cwd keeps CLAUDE.md, AGENTS.md and other repository text out of the prompt.
        const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-auto-routing-" });
        const result = yield* classify({
          cwd,
          message: input.text,
          modelSelection: {
            instanceId: classifier.provider.instanceId,
            model: classifier.model.slug,
          },
        });
        return { complexity: result.complexity };
      }),
    ).pipe(
      Effect.timeoutOption(AI_CLASSIFICATION_TIMEOUT),
      Effect.map(Option.getOrElse(() => "failed" as const)),
      Effect.orElseSucceed(() => "failed" as const),
    );
  });

  const route = Effect.fn("AutoRoutingService.route")(function* (input: {
    readonly settings: ServerSettings;
    readonly projectId: ProjectId | null;
    readonly text: string;
    readonly attachmentCount: number;
    readonly thread: RouteThreadContext | null;
    readonly requestedSelection: ModelSelection | null;
    readonly profileOverride?: AutoRoutingSimulateInput["profile"];
    readonly allowAi: boolean;
  }) {
    const providers = yield* providerRegistry.getProviders;
    const nowMs = yield* Clock.currentTimeMillis;
    const scope = projectScope(input.settings, input.projectId);
    const routeInput: RouteInput = {
      text: input.text,
      attachmentCount: input.attachmentCount,
      settings: input.settings.autoRouting,
      preferences:
        input.profileOverride === undefined
          ? scope.preferences
          : { ...scope.preferences, profile: input.profileOverride },
      providers,
      nowMs,
      instanceEnabledForProject: scope.instanceEnabledForProject,
      thread: input.thread,
      requestedSelection: input.requestedSelection,
    };
    const ai = yield* classifyWithAi(routeInput, input.allowAi);
    return decideRoute({
      ...routeInput,
      ...(ai !== null && ai !== "failed" ? { aiClassification: ai } : {}),
      ...(ai === "failed" ? { aiClassificationFailed: true } : {}),
    });
  });

  const toDecision = Effect.fn("AutoRoutingService.toDecision")(function* (
    routed: RouteDecision,
    meta: {
      readonly kind: AutoRoutingDecision["kind"];
      readonly commandId: CommandId | null;
      readonly messageId: MessageId | null;
      readonly threadId: ThreadId | null;
      readonly projectId: ProjectId | null;
      readonly startedAtMs: number;
    },
  ) {
    const { classification: _classification, ...decision } = routed;
    const endedAtMs = yield* Clock.currentTimeMillis;
    return {
      ...decision,
      id: `route:${yield* newId}`,
      kind: meta.kind,
      commandId: meta.commandId,
      messageId: meta.messageId,
      threadId: meta.threadId,
      projectId: meta.projectId,
      createdAt: yield* nowIso,
      latencyMs: Math.max(0, Math.round(endedAtMs - meta.startedAtMs)),
      feedback: null,
      reasonCodes:
        meta.kind === "dry_run" ? [...decision.reasonCodes, "dry_run"] : decision.reasonCodes,
    } satisfies AutoRoutingDecision;
  });

  const updateThreadRecord = Effect.fn("AutoRoutingService.updateThreadRecord")(function* (
    threadId: ThreadId,
    decision: AutoRoutingDecision,
  ) {
    const updatedAt = decision.createdAt;
    const current = (yield* store.getThread(threadId)) ?? emptyThreadRecord(threadId, updatedAt);
    const newTask =
      decision.kind !== "pinned" && decision.kind !== "kept_active" && !decision.continuation;
    const escalated = decision.reasonCodes.includes("escalation_automatic") ? 1 : 0;
    yield* store.putThread({
      ...current,
      mode: decision.kind === "pinned" ? "pinned" : "auto",
      taskDecisionId: newTask ? decision.id : current.taskDecisionId,
      escalationsUsed: (newTask ? 0 : current.escalationsUsed) + escalated,
      updatedAt,
    });
  });

  const routeForThread = Effect.fn("AutoRoutingService.routeForThread")(function* (input: {
    readonly mode: AutoRoutingRequest["mode"];
    readonly commandId: CommandId;
    readonly messageId: MessageId | null;
    readonly threadId: ThreadId | null;
    /** False for a thread this launch is about to create: there is no history to read. */
    readonly threadExists: boolean;
    readonly projectId: ProjectId | null;
    readonly text: string;
    readonly attachmentCount: number;
    readonly requestedSelection: ModelSelection;
  }): Effect.fn.Return<ModelSelection, AutoRoutingError> {
    const replay = yield* store.findByCommandId(input.commandId);
    if (replay !== null) {
      return replay.kind === "routed" || replay.kind === "escalation"
        ? (replay.selection ?? input.requestedSelection)
        : input.requestedSelection;
    }
    const startedAtMs = yield* Clock.currentTimeMillis;
    const settings = yield* readSettings;
    const meta = {
      commandId: input.commandId,
      messageId: input.messageId,
      threadId: input.threadId,
      projectId: input.projectId,
      startedAtMs,
    };

    const existingThreadId = input.threadExists ? input.threadId : null;
    const threadLoad =
      existingThreadId === null
        ? null
        : yield* loadThreadContext(existingThreadId).pipe(
            Effect.mapError(
              (cause) => new AutoRoutingError({ message: "Could not read the thread.", cause }),
            ),
          );
    const projectId = threadLoad?.records.thread.projectId ?? input.projectId;
    const previous = existingThreadId === null ? null : yield* latestDecision(existingThreadId);
    const threadRecord =
      existingThreadId === null ? null : yield* store.getThread(existingThreadId);
    const threadContext =
      threadLoad === null ? null : buildThreadContext(threadLoad, previous, threadRecord);

    // Pins and a disabled feature never change the model; they are recorded so history stays honest.
    if (input.mode === "pinned" || !settings.autoRouting.enabled) {
      const decision = yield* toDecision(
        {
          ...decideRoute({
            text: input.text,
            attachmentCount: input.attachmentCount,
            settings: settings.autoRouting,
            preferences: projectScope(settings, projectId).preferences,
            providers: [],
            nowMs: startedAtMs,
            thread: null,
            requestedSelection: input.requestedSelection,
          }),
          selection: input.requestedSelection,
          reasonCodes: [input.mode === "pinned" ? "manual_pin" : "auto_disabled"],
          summary:
            input.mode === "pinned" ? "Pinned by you" : "Auto routing is off; using your selection",
          candidates: [],
          usage: [],
        },
        { ...meta, projectId, kind: input.mode === "pinned" ? "pinned" : "manual_fallback" },
      );
      yield* recordDecision(settings, decision);
      if (input.threadId !== null) yield* updateThreadRecord(input.threadId, decision);
      return input.requestedSelection;
    }

    const routed = yield* route({
      settings,
      projectId,
      text: input.text,
      attachmentCount: input.attachmentCount,
      thread: threadContext,
      requestedSelection: input.requestedSelection,
      allowAi: settings.autoRouting.aiClassification,
    });
    const dryRun = settings.autoRouting.dryRun && routed.kind === "routed";
    const decision = yield* toDecision(routed, {
      ...meta,
      projectId,
      kind: dryRun ? "dry_run" : routed.kind,
    });
    yield* recordDecision(settings, decision);
    if (input.threadId !== null) yield* updateThreadRecord(input.threadId, decision);
    if (dryRun) return input.requestedSelection;
    return decision.selection ?? input.requestedSelection;
  });

  // Defects included: a routing bug must never stop a message from being sent.
  const failSafe =
    <A>(fallback: A, operation: string) =>
    <E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause as Cause.Cause<never>)
            : Effect.logWarning(
                `Auto routing ${operation} failed; using the manual selection.`,
                cause,
              ).pipe(Effect.as(fallback)),
        ),
      );

  const resolveDispatch: AutoRoutingServiceShape["resolveDispatch"] = Effect.fn(
    "AutoRoutingService.resolveDispatch",
  )(function* (command) {
    const { autoRouting, ...manual } = command;
    if (autoRouting === undefined) return manual;
    const requested =
      command.modelSelection ??
      (yield* threads.getThreadRecords(command.threadId, []).pipe(
        Effect.map((records): ModelSelection | null => records.thread.modelSelection),
        Effect.catchCause(() => Effect.succeed(null)),
      ));
    if (requested === null) return manual;
    const selection = yield* routeForThread({
      mode: autoRouting.mode,
      commandId: command.commandId,
      messageId: command.messageId,
      threadId: command.threadId,
      threadExists: true,
      projectId: null,
      text: command.text,
      attachmentCount: command.attachments.length,
      requestedSelection: requested,
    }).pipe(failSafe(requested, "dispatch"));
    return { ...manual, modelSelection: selection };
  });

  const resolveLaunch: AutoRoutingServiceShape["resolveLaunch"] = Effect.fn(
    "AutoRoutingService.resolveLaunch",
  )(function* <Input extends RoutableLaunchInput>(input: Input) {
    const { autoRouting, ...manual } = input;
    if (autoRouting === undefined) return manual as Input;
    // A launch reusing an existing thread routes like a follow-up; a new thread has no history.
    const existing =
      input.threadId === undefined
        ? false
        : yield* threads.getThreadRecords(input.threadId, []).pipe(
            Effect.as(true),
            Effect.catchCause(() => Effect.succeed(false)),
          );
    const selection = yield* routeForThread({
      mode: autoRouting.mode,
      commandId: input.commandId,
      messageId: input.initialMessage?.messageId ?? null,
      threadId: input.threadId ?? null,
      threadExists: existing,
      projectId: input.projectId,
      text: input.initialMessage?.text ?? "",
      attachmentCount: input.initialMessage?.attachments.length ?? 0,
      requestedSelection: input.modelSelection,
    }).pipe(failSafe(input.modelSelection, "launch"));
    return { ...manual, modelSelection: selection } as Input;
  });

  const pendingEscalation = Effect.fn("AutoRoutingService.pendingEscalation")(function* (
    threadId: ThreadId,
    settings: ServerSettings,
    record: AutoRoutingThreadRecord | null,
    latest: AutoRoutingDecision | null,
  ) {
    if (record?.mode !== "auto" || settings.autoRouting.escalation.mode !== "ask") return null;
    const loaded = yield* loadThreadContext(threadId).pipe(
      Effect.mapError(
        (cause) => new AutoRoutingError({ message: "Could not read the thread.", cause }),
      ),
    );
    if (loaded.lastRun === undefined) return null;
    if (hasActiveWork(loaded.records.runs, loaded.records.runtimeRequests) !== null) return null;
    const scope = projectScope(settings, loaded.records.thread.projectId);
    return computeEscalationOffer({
      settings: settings.autoRouting,
      preferences: scope.preferences,
      providers: yield* providerRegistry.getProviders,
      nowMs: yield* Clock.currentTimeMillis,
      instanceEnabledForProject: scope.instanceEnabledForProject,
      runId: loaded.lastRun.id,
      runSelection: loaded.lastRun.modelSelection,
      outcome: loaded.outcome,
      userReportedFailure:
        latest !== null &&
        latest.messageId === loaded.lastRun.userMessageId &&
        latest.reasonCodes.includes("user_reported_failure") &&
        loaded.outcome.type !== "success",
      escalationsUsed: record.escalationsUsed,
      declinedOfferIds: record.declinedOfferIds,
      supportsHandoff: sessionSupportsHandoff(loaded.records),
    });
  });

  const getThreadState: AutoRoutingServiceShape["getThreadState"] = Effect.fn(
    "AutoRoutingService.getThreadState",
  )(function* (threadId) {
    const settings = yield* readSettings;
    const record = yield* store.getThread(threadId);
    const latest = yield* latestDecision(threadId);
    const offer = yield* pendingEscalation(threadId, settings, record, latest).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Could not compute an escalation offer.", cause).pipe(Effect.as(null)),
      ),
    );
    return {
      threadId,
      mode: record?.mode ?? null,
      escalationsUsed: record?.escalationsUsed ?? 0,
      latestDecision: latest,
      pendingEscalation: offer,
    };
  });

  const respondEscalation: AutoRoutingServiceShape["respondEscalation"] = Effect.fn(
    "AutoRoutingService.respondEscalation",
  )(function* (input) {
    const settings = yield* readSettings;
    const record = yield* store.getThread(input.threadId);
    const updatedAt = yield* nowIso;
    const base = record ?? emptyThreadRecord(input.threadId, updatedAt);
    // Accepting twice must not send the continuation twice.
    if (base.acceptedOfferIds.includes(input.offerId)) return yield* getThreadState(input.threadId);
    const offer = yield* pendingEscalation(
      input.threadId,
      settings,
      record,
      yield* latestDecision(input.threadId),
    );
    if (offer === null || offer.id !== input.offerId) {
      return yield* new AutoRoutingError({
        message: "This escalation offer is no longer available.",
      });
    }
    if (!input.accept) {
      yield* store.putThread({
        ...base,
        declinedOfferIds: [...base.declinedOfferIds, offer.id],
        updatedAt,
      });
      return yield* getThreadState(input.threadId);
    }
    const startedAtMs = yield* Clock.currentTimeMillis;
    // Recorded before dispatch so a crash between the two cannot leave a retry loop open.
    yield* store.putThread({
      ...base,
      escalationsUsed: base.escalationsUsed + 1,
      acceptedOfferIds: [...base.acceptedOfferIds, offer.id],
      updatedAt,
    });
    const messageId = MessageId.make(`message:escalation:${yield* newId}`);
    yield* threads
      .dispatch({
        type: "message.dispatch",
        commandId: input.commandId,
        threadId: input.threadId,
        messageId,
        text: buildEscalationMessage(offer),
        attachments: [],
        modelSelection: offer.to,
        dispatchMode: { type: "start_immediately" },
        createdBy: "user",
        creationSource: "web",
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new AutoRoutingError({ message: "Could not start the escalated turn.", cause }),
        ),
      );
    const previous = yield* latestDecision(input.threadId);
    const decision: AutoRoutingDecision = {
      id: `route:${yield* newId}`,
      commandId: input.commandId,
      messageId,
      threadId: input.threadId,
      projectId: previous?.projectId ?? null,
      createdAt: updatedAt,
      kind: "escalation",
      selection: offer.to,
      requestedSelection: null,
      previousSelection: offer.from,
      profile: previous?.profile ?? "balanced",
      complexity: previous?.complexity ?? "complex",
      requiredTier: Math.min(4, (previous?.requiredTier ?? 2) + 1),
      classifier: "deterministic",
      confidence: 1,
      continuation: true,
      reasonCodes: ["escalation_approved", `failure_${offer.failureKind}`],
      summary: `${offer.toName} · escalated with your approval`,
      providerSwitched: offer.to.instanceId !== offer.from.instanceId,
      fallback: null,
      usage: usageObservations(yield* providerRegistry.getProviders),
      candidates: [],
      latencyMs: Math.max(0, Math.round((yield* Clock.currentTimeMillis) - startedAtMs)),
      feedback: null,
    };
    yield* recordDecision(settings, decision);
    return yield* getThreadState(input.threadId);
  });

  const listHistory: AutoRoutingServiceShape["listHistory"] = Effect.fn(
    "AutoRoutingService.listHistory",
  )(function* (input) {
    const decisions = yield* store.list(input);
    const byModel = new Map<
      string,
      { instanceId: ProviderInstanceId; model: string; count: number }
    >();
    let latencyTotal = 0;
    for (const decision of decisions) {
      latencyTotal += decision.latencyMs;
      const used = decision.kind === "dry_run" ? null : decision.selection;
      if (used === null) continue;
      const key = `${used.instanceId}\u0000${used.model}`;
      const entry = byModel.get(key) ?? {
        instanceId: used.instanceId,
        model: used.model,
        count: 0,
      };
      entry.count += 1;
      byModel.set(key, entry);
    }
    const count = (predicate: (decision: AutoRoutingDecision) => boolean) =>
      decisions.filter(predicate).length;
    return {
      decisions,
      stats: {
        total: decisions.length,
        byModel: [...byModel.values()].toSorted((left, right) => right.count - left.count),
        providerSwitches: count((decision) => decision.providerSwitched),
        escalations: count(
          (decision) =>
            decision.kind === "escalation" || decision.reasonCodes.includes("escalation_automatic"),
        ),
        fallbacks: count(
          (decision) => decision.fallback !== null || decision.kind === "manual_fallback",
        ),
        dryRuns: count((decision) => decision.kind === "dry_run"),
        feedbackGood: count((decision) => decision.feedback === "good"),
        feedbackBad: count((decision) => decision.feedback === "bad"),
        averageLatencyMs:
          decisions.length === 0 ? null : Math.round(latencyTotal / decisions.length),
      },
    };
  });

  const simulate: AutoRoutingServiceShape["simulate"] = Effect.fn("AutoRoutingService.simulate")(
    function* (input) {
      const startedAtMs = yield* Clock.currentTimeMillis;
      const settings = yield* readSettings;
      const loaded =
        input.threadId === undefined
          ? null
          : yield* loadThreadContext(input.threadId).pipe(Effect.orElseSucceed(() => null));
      const threadId = loaded === null ? null : (input.threadId ?? null);
      const record = threadId === null ? null : yield* store.getThread(threadId);
      const previous = threadId === null ? null : yield* latestDecision(threadId);
      const projectId = loaded?.records.thread.projectId ?? input.projectId ?? null;
      const routed = yield* route({
        settings,
        projectId,
        text: input.text,
        attachmentCount: 0,
        thread: loaded === null ? null : buildThreadContext(loaded, previous, record),
        requestedSelection: loaded?.records.thread.modelSelection ?? settings.defaultModelSelection,
        ...(input.profile === undefined ? {} : { profileOverride: input.profile }),
        allowAi: settings.autoRouting.aiClassification || input.allowAiClassification === true,
      });
      // Simulations are never persisted and never change a thread.
      return yield* toDecision(routed, {
        kind: "simulation",
        commandId: null,
        messageId: null,
        threadId,
        projectId,
        startedAtMs,
      });
    },
  );

  const getDiagnostics: AutoRoutingServiceShape["getDiagnostics"] = Effect.fn(
    "AutoRoutingService.getDiagnostics",
  )(function* (input) {
    const settings = yield* readSettings;
    const providers = yield* providerRegistry.getProviders;
    const scope = projectScope(settings, input.projectId ?? null);
    const models = listAutoRoutingModels({
      providers,
      settings: settings.autoRouting,
      nowMs: yield* Clock.currentTimeMillis,
      instanceEnabledForProject: scope.instanceEnabledForProject,
    });
    const issues: string[] = [];
    if (!settings.autoRouting.enabled) issues.push("Auto routing is turned off.");
    if (!models.some((entry) => entry.exclusion === null)) {
      issues.push("No Claude or Codex model is eligible, so Auto uses your manual selection.");
    }
    if (models.some((entry) => entry.exclusion === "subscription_unverified")) {
      issues.push(
        "Some providers did not report a subscription plan. Auto skips them unless you trust unverified sign-ins.",
      );
    }
    if (settings.autoRouting.dryRun)
      issues.push("Dry run is on: Auto records its choice but sends with your selection.");
    return {
      enabled: settings.autoRouting.enabled,
      profile: scope.preferences.profile,
      models: models.map((entry) => ({
        instanceId: entry.provider.instanceId,
        driver: entry.provider.driver,
        model: entry.model.slug,
        name: entry.model.name,
        tier: entry.profile.tier,
        tierSource: entry.profile.tierSource,
        hidden: entry.hidden,
        eligible: entry.exclusion === null,
        excludedReason:
          entry.exclusion === null ? null : AUTO_ROUTING_EXCLUSION_LABELS[entry.exclusion],
      })),
      usage: usageObservations(providers),
      issues,
    };
  });

  const submitFeedback: AutoRoutingServiceShape["submitFeedback"] = Effect.fn(
    "AutoRoutingService.submitFeedback",
  )(function* (input) {
    const found = yield* store.setFeedback(input.decisionId, input.feedback);
    if (!found) {
      for (const [threadId, decision] of unrecorded) {
        if (decision.id === input.decisionId) {
          unrecorded.set(threadId, { ...decision, feedback: input.feedback });
          return;
        }
      }
      return yield* new AutoRoutingError({ message: "That routing decision no longer exists." });
    }
  });

  return AutoRoutingService.of({
    resolveDispatch,
    resolveLaunch,
    getThreadState,
    listHistory,
    simulate,
    getDiagnostics,
    respondEscalation,
    submitFeedback,
    clearHistory: store.clear.pipe(Effect.tap(() => Effect.sync(() => unrecorded.clear()))),
  });
});

export const layer = Layer.effect(AutoRoutingService, make);
