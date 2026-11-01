import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  ProjectId,
  RunId,
  ThreadId,
  type ModelSelection,
  type OrchestrationV2Command,
  type OrchestrationV2Run,
  type OrchestrationV2TurnItem,
  type ServerProvider,
  type ServerSettings,
} from "@t3tools/contracts";
import type { DeepPartial } from "@t3tools/shared/Struct";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettingsService from "../serverSettings.ts";
import { AutoRoutingService, layer as autoRoutingLayer } from "./AutoRoutingService.ts";
import { AutoRoutingStore, layer as storeLayer } from "./AutoRoutingStore.ts";
import { CLAUDE, CODEX, claudeProvider, codexProvider, selection } from "./testing/fixtures.ts";

type DispatchCommand = Extract<OrchestrationV2Command, { readonly type: "message.dispatch" }>;

const THREAD = ThreadId.make("thread-auto");
const PROJECT = ProjectId.make("project-auto");
const SONNET = selection(CLAUDE, "claude-sonnet-5-5");

interface ThreadFixture {
  modelSelection: ModelSelection;
  runs: Array<OrchestrationV2Run>;
  items: Array<OrchestrationV2TurnItem>;
  pendingRequest: boolean;
  dispatched: Array<DispatchCommand>;
}

const run = (id: string, status: OrchestrationV2Run["status"], modelSelection = SONNET) =>
  ({
    id: RunId.make(id),
    threadId: THREAD,
    status,
    modelSelection,
    providerInstanceId: modelSelection.instanceId,
    userMessageId: MessageId.make(`message-${id}`),
  }) as OrchestrationV2Run;

const failedCheck = (runId: string) =>
  ({
    type: "command_execution",
    runId: RunId.make(runId),
    input: "vp test run src/date.test.ts",
    exitCode: 1,
    status: "completed",
  }) as OrchestrationV2TurnItem;

function makeLayer(input: {
  readonly fixture: ThreadFixture;
  readonly settings?: DeepPartial<ServerSettings>;
  readonly providers?: ReadonlyArray<ServerProvider>;
  readonly brokenSettings?: boolean;
}) {
  const { fixture } = input;
  const threads = Layer.mock(ThreadManagement.ThreadManagementService)({
    getThreadRecords: ((threadId: ThreadId, fields: ReadonlyArray<string>) =>
      threadId !== THREAD
        ? Effect.die("unknown thread")
        : Effect.succeed({
            thread: { id: THREAD, projectId: PROJECT, modelSelection: fixture.modelSelection },
            runs: fixture.runs,
            runtimeRequests: fixture.pendingRequest ? [{ status: "pending" }] : [],
            providerSessions: [],
            providerThreads: [],
            turnItems: fields.includes("turnItems") ? fixture.items : [],
          })) as unknown as ThreadManagement.ThreadManagementService["Service"]["getThreadRecords"],
    dispatch: ((command: DispatchCommand) =>
      Effect.sync(() => {
        fixture.dispatched.push(command);
        return { sequence: fixture.dispatched.length, storedEvents: [], replayed: false };
      })) as unknown as ThreadManagement.ThreadManagementService["Service"]["dispatch"],
  });
  const providers = Layer.mock(ProviderRegistry.ProviderRegistry)({
    getProviders: Effect.succeed(input.providers ?? [claudeProvider(), codexProvider()]),
  });
  const instances = Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
    getInstance: () => Effect.undefined,
  });
  const settings = input.brokenSettings
    ? Layer.mock(ServerSettingsService.ServerSettingsService)({
        getSettings: Effect.die("settings unreadable"),
      })
    : ServerSettingsService.layerTest({
        autoRouting: { enabled: true },
        ...input.settings,
      });
  return autoRoutingLayer.pipe(
    Layer.provideMerge(storeLayer),
    Layer.provide(Layer.mergeAll(threads, providers, instances, settings)),
    Layer.provide(SqlitePersistence.layerMemory),
    Layer.provideMerge(NodeServices.layer),
  );
}

const fixture = (overrides: Partial<ThreadFixture> = {}): ThreadFixture => ({
  modelSelection: SONNET,
  runs: [run("run-1", "completed")],
  items: [],
  pendingRequest: false,
  dispatched: [],
  ...overrides,
});

const dispatchCommand = (overrides: Partial<DispatchCommand> = {}): DispatchCommand => ({
  type: "message.dispatch",
  commandId: CommandId.make("command-1"),
  threadId: THREAD,
  messageId: MessageId.make("message-2"),
  text: "Refactor the authentication flow across the entire codebase and migrate the stored tokens",
  attachments: [],
  modelSelection: selection(CLAUDE, "claude-haiku-5-5"),
  dispatchMode: { type: "start_immediately" },
  createdBy: "user",
  creationSource: "web",
  autoRouting: { mode: "auto" },
  ...overrides,
});

describe("AutoRoutingService.resolveDispatch", () => {
  it.effect("leaves manual turns untouched and records nothing", () => {
    const thread = fixture();
    return Effect.gen(function* () {
      const routing = yield* AutoRoutingService;
      const store = yield* AutoRoutingStore;
      const { autoRouting: _autoRouting, ...manual } = dispatchCommand();
      expect(yield* routing.resolveDispatch(manual)).toEqual(manual);
      expect(yield* store.list({})).toEqual([]);
    }).pipe(Effect.provide(makeLayer({ fixture: thread })));
  });

  it.effect("routes an Auto turn server-side and strips the request field", () => {
    const thread = fixture();
    return Effect.gen(function* () {
      const routing = yield* AutoRoutingService;
      const resolved = yield* routing.resolveDispatch(dispatchCommand());
      expect(resolved.autoRouting).toBeUndefined();
      expect(resolved.modelSelection?.model).toBe("claude-opus-5-5");
      const state = yield* routing.getThreadState(THREAD);
      expect(state).toMatchObject({ mode: "auto", latestDecision: { kind: "routed" } });
      expect(state.latestDecision?.summary).toContain("Opus");
    }).pipe(Effect.provide(makeLayer({ fixture: thread })));
  });

  it.effect("answers a side question cheaply, then returns to the task's model", () => {
    const thread = fixture();
    return Effect.gen(function* () {
      const routing = yield* AutoRoutingService;
      const send = (index: number, text: string) =>
        routing
          .resolveDispatch(
            dispatchCommand({
              commandId: CommandId.make(`command-${index}`),
              messageId: MessageId.make(`message-${index}`),
              text,
            }),
          )
          .pipe(
            Effect.tap((resolved) =>
              Effect.sync(() => {
                // The thread now runs on whatever Auto chose.
                thread.modelSelection = resolved.modelSelection!;
                thread.runs.push(run(`run-${index + 1}`, "completed", resolved.modelSelection!));
              }),
            ),
            Effect.map((resolved) => resolved.modelSelection?.model),
          );
      expect(yield* send(1, "check this system for security vulnerabilities")).toBe(
        "claude-opus-5-5",
      );
      expect(yield* send(2, "who is the president of the philippines?")).toBe("claude-haiku-5-5");
      expect(yield* send(3, "ok continue with the vulnerability check")).toBe("claude-opus-5-5");
    }).pipe(Effect.provide(makeLayer({ fixture: thread, providers: [claudeProvider()] })));
  });

  it.effect("never overrides a pinned model", () => {
    const thread = fixture();
    return Effect.gen(function* () {
      const routing = yield* AutoRoutingService;
      const pinned = selection(CODEX, "gpt-6-astra");
      const resolved = yield* routing.resolveDispatch(
        dispatchCommand({ autoRouting: { mode: "pinned" }, modelSelection: pinned }),
      );
      expect(resolved.modelSelection).toEqual(pinned);
      const state = yield* routing.getThreadState(THREAD);
      expect(state).toMatchObject({ mode: "pinned", latestDecision: { kind: "pinned" } });
    }).pipe(Effect.provide(makeLayer({ fixture: thread })));
  });

  it.effect("ignores Auto requests while the feature is disabled on the server", () => {
    const thread = fixture();
    return Effect.gen(function* () {
      const routing = yield* AutoRoutingService;
      const resolved = yield* routing.resolveDispatch(dispatchCommand());
      expect(resolved.modelSelection?.model).toBe("claude-haiku-5-5");
    }).pipe(
      Effect.provide(makeLayer({ fixture: thread, settings: { autoRouting: { enabled: false } } })),
    );
  });

  it.effect("records but does not apply decisions in dry-run mode", () => {
    const thread = fixture();
    return Effect.gen(function* () {
      const routing = yield* AutoRoutingService;
      const resolved = yield* routing.resolveDispatch(dispatchCommand());
      expect(resolved.modelSelection?.model).toBe("claude-haiku-5-5");
      const { latestDecision } = yield* routing.getThreadState(THREAD);
      expect(latestDecision).toMatchObject({
        kind: "dry_run",
        selection: { model: "claude-opus-5-5" },
      });
    }).pipe(
      Effect.provide(
        makeLayer({ fixture: thread, settings: { autoRouting: { enabled: true, dryRun: true } } }),
      ),
    );
  });

  it.effect("keeps the running model for a message queued or steered into active work", () => {
    const thread = fixture({ runs: [run("run-1", "running")] });
    return Effect.gen(function* () {
      const routing = yield* AutoRoutingService;
      const resolved = yield* routing.resolveDispatch(
        dispatchCommand({ dispatchMode: { type: "queue_after_active" } }),
      );
      expect(resolved.modelSelection).toEqual(SONNET);
      expect(resolved.dispatchMode).toEqual({ type: "queue_after_active" });
    }).pipe(Effect.provide(makeLayer({ fixture: thread })));
  });

  it.effect("does not reroute while a permission request is unresolved", () => {
    const thread = fixture({ pendingRequest: true });
    return Effect.gen(function* () {
      const routing = yield* AutoRoutingService;
      const resolved = yield* routing.resolveDispatch(dispatchCommand());
      expect(resolved.modelSelection).toEqual(SONNET);
    }).pipe(Effect.provide(makeLayer({ fixture: thread })));
  });

  it.effect("reuses the first decision when a command is retried", () => {
    const thread = fixture();
    return Effect.gen(function* () {
      const routing = yield* AutoRoutingService;
      const store = yield* AutoRoutingStore;
      const first = yield* routing.resolveDispatch(dispatchCommand());
      // A retry with a different message must not produce a different model or a second row.
      const retry = yield* routing.resolveDispatch(dispatchCommand({ text: "thanks" }));
      expect(retry.modelSelection).toEqual(first.modelSelection);
      expect(yield* store.list({ threadId: THREAD })).toHaveLength(1);
    }).pipe(Effect.provide(makeLayer({ fixture: thread })));
  });

  it.effect("falls back to the manual selection when settings cannot be read", () => {
    const thread = fixture();
    return Effect.gen(function* () {
      const routing = yield* AutoRoutingService;
      const resolved = yield* routing.resolveDispatch(dispatchCommand());
      expect(resolved.modelSelection?.model).toBe("claude-haiku-5-5");
      expect(resolved.autoRouting).toBeUndefined();
    }).pipe(Effect.provide(makeLayer({ fixture: thread, brokenSettings: true })));
  });

  it.effect("stores reason codes and model ids, never the message text", () => {
    const thread = fixture();
    return Effect.gen(function* () {
      const routing = yield* AutoRoutingService;
      const store = yield* AutoRoutingStore;
      const secret = "deploy key sk-live-abc123 in src/secret-config.ts";
      yield* routing.resolveDispatch(dispatchCommand({ text: `Fix ${secret}` }));
      const [decision] = yield* store.list({});
      expect(JSON.stringify(decision)).not.toContain("sk-live");
      expect(JSON.stringify(decision)).not.toContain("secret-config");
    }).pipe(Effect.provide(makeLayer({ fixture: thread })));
  });
});

describe("AutoRoutingService.resolveLaunch", () => {
  it.effect("routes the first message of a new thread and records it under that thread", () => {
    const thread = fixture();
    return Effect.gen(function* () {
      const routing = yield* AutoRoutingService;
      const launched = yield* routing.resolveLaunch({
        commandId: CommandId.make("launch-1"),
        threadId: ThreadId.make("thread-new"),
        projectId: PROJECT,
        modelSelection: selection(CODEX, "gpt-6-luna"),
        autoRouting: { mode: "auto" },
        initialMessage: { text: "thanks", attachments: [] },
      });
      expect(launched.autoRouting).toBeUndefined();
      expect(launched.modelSelection.model).not.toBe("gpt-6-astra");
      const state = yield* routing.getThreadState(ThreadId.make("thread-new"));
      expect(state.latestDecision?.kind).toBe("routed");
    }).pipe(Effect.provide(makeLayer({ fixture: thread })));
  });
});

describe("AutoRoutingService escalation", () => {
  const failedThread = () =>
    fixture({ runs: [run("run-1", "completed")], items: [failedCheck("run-1")] });

  it.effect("offers escalation after a failed check and sends one continuation on approval", () => {
    const thread = failedThread();
    return Effect.gen(function* () {
      const routing = yield* AutoRoutingService;
      yield* routing.resolveDispatch(dispatchCommand({ text: "thanks" }));
      const state = yield* routing.getThreadState(THREAD);
      expect(state.pendingEscalation).toMatchObject({
        id: "escalate:run-1",
        to: { instanceId: CLAUDE, model: "claude-opus-5-5" },
        evidence: ["`vp test run src/date.test.ts` exited with code 1"],
      });
      const request = {
        threadId: THREAD,
        offerId: "escalate:run-1",
        accept: true,
        commandId: CommandId.make("escalate-command"),
      };
      const accepted = yield* routing.respondEscalation(request);
      expect(accepted.escalationsUsed).toBe(1);
      expect(accepted.pendingEscalation).toBeNull();
      // Approving twice is a no-op, so the destructive-retry guard holds.
      yield* routing.respondEscalation(request);
      expect(thread.dispatched).toHaveLength(1);
      expect(thread.dispatched[0]).toMatchObject({
        modelSelection: { model: "claude-opus-5-5" },
        dispatchMode: { type: "start_immediately" },
      });
      expect(thread.dispatched[0]!.text).toContain("do not repeat it");
      expect(thread.dispatched[0]!.text).toContain("exited with code 1");
    }).pipe(Effect.provide(makeLayer({ fixture: thread })));
  });

  it.effect("stops offering an escalation the user declined", () => {
    const thread = failedThread();
    return Effect.gen(function* () {
      const routing = yield* AutoRoutingService;
      yield* routing.resolveDispatch(dispatchCommand({ text: "thanks" }));
      const declined = yield* routing.respondEscalation({
        threadId: THREAD,
        offerId: "escalate:run-1",
        accept: false,
        commandId: CommandId.make("decline"),
      });
      expect(declined.pendingEscalation).toBeNull();
      expect(thread.dispatched).toHaveLength(0);
    }).pipe(Effect.provide(makeLayer({ fixture: thread })));
  });

  it.effect("never offers escalation for an environment failure", () => {
    const thread = fixture({
      runs: [run("run-1", "failed")],
      items: [
        {
          type: "error",
          failure: { class: "usage_limit", message: "limit", code: null, retryable: true },
        } as OrchestrationV2TurnItem,
      ],
    });
    return Effect.gen(function* () {
      const routing = yield* AutoRoutingService;
      yield* routing.resolveDispatch(dispatchCommand({ text: "thanks" }));
      expect((yield* routing.getThreadState(THREAD)).pendingEscalation).toBeNull();
    }).pipe(Effect.provide(makeLayer({ fixture: thread })));
  });

  it.effect("rejects a stale offer instead of dispatching", () => {
    const thread = fixture();
    return Effect.gen(function* () {
      const routing = yield* AutoRoutingService;
      const error = yield* routing
        .respondEscalation({
          threadId: THREAD,
          offerId: "escalate:run-0",
          accept: true,
          commandId: CommandId.make("stale"),
        })
        .pipe(Effect.flip);
      expect(error._tag).toBe("AutoRoutingError");
      expect(thread.dispatched).toHaveLength(0);
    }).pipe(Effect.provide(makeLayer({ fixture: thread })));
  });
});

describe("AutoRoutingService history and tools", () => {
  it.effect("simulates without persisting and lists stats with feedback", () => {
    const thread = fixture();
    return Effect.gen(function* () {
      const routing = yield* AutoRoutingService;
      const simulated = yield* routing.simulate({ text: "thanks", profile: "economy" });
      expect(simulated.kind).toBe("simulation");
      expect((yield* routing.listHistory({})).decisions).toHaveLength(0);

      yield* routing.resolveDispatch(dispatchCommand());
      const history = yield* routing.listHistory({ threadId: THREAD });
      expect(history.stats).toMatchObject({ total: 1, providerSwitches: 0, dryRuns: 0 });
      yield* routing.submitFeedback({ decisionId: history.decisions[0]!.id, feedback: "bad" });
      expect((yield* routing.listHistory({})).stats.feedbackBad).toBe(1);
      yield* routing.clearHistory;
      expect((yield* routing.listHistory({})).stats.total).toBe(0);
    }).pipe(Effect.provide(makeLayer({ fixture: thread })));
  });

  it.effect("explains why each model is or is not eligible", () => {
    const thread = fixture();
    return Effect.gen(function* () {
      const routing = yield* AutoRoutingService;
      const diagnostics = yield* routing.getDiagnostics({});
      const byModel = new Map(diagnostics.models.map((model) => [model.model, model]));
      expect(byModel.get("claude-fable-5-1")).toMatchObject({ eligible: false, hidden: true });
      expect(byModel.get("gpt-6-astra")).toMatchObject({
        eligible: false,
        excludedReason: "Hidden from Auto",
      });
      expect(byModel.get("claude-sonnet-5-5")).toMatchObject({ eligible: true });
      expect(diagnostics.models.every((model) => model.driver !== "cursor")).toBe(true);
    }).pipe(Effect.provide(makeLayer({ fixture: thread })));
  });

  it.effect("keeps no history when recording is off but still explains the last decision", () => {
    const thread = fixture();
    return Effect.gen(function* () {
      const routing = yield* AutoRoutingService;
      yield* routing.resolveDispatch(dispatchCommand());
      expect((yield* routing.listHistory({})).stats.total).toBe(0);
      expect((yield* routing.getThreadState(THREAD)).latestDecision?.kind).toBe("routed");
    }).pipe(
      Effect.provide(
        makeLayer({
          fixture: thread,
          settings: { autoRouting: { enabled: true, recordHistory: false } },
        }),
      ),
    );
  });
});
