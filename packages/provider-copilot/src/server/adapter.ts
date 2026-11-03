import { defaultInstanceIdForDriver, ProviderDriverKind } from "@t3tools/contracts";
import {
  copilotClientCapabilitiesMeta,
  extractCopilotSubagentUpdate,
  makeCopilotSubagentRouting,
} from "@t3tools/provider-acp-registry/server/copilotAcp";
import { readCustomModelEntries } from "@t3tools/shared/model";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { resolveSelfInvocation, type SelfInvocation } from "@t3tools/shared/nodeRuntime";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as EffectAcpErrors from "effect-acp/errors";

import * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";
import { makeAcpNativeLoggerFactory } from "@t3tools/provider-acp/server/nativeLogging";
import {
  AcpProviderCapabilitiesV2,
  makeAcpAdapterV2,
  type AcpAdapterV2Flavor,
  type AcpAdapterV2RuntimeInput,
} from "@t3tools/provider-acp/server/adapter";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as ProviderContinuationRequests from "@t3tools/provider-core/server/ProviderContinuationRequests";
import * as ProviderEventLoggers from "@t3tools/provider-core/server/ProviderEventLoggers";
import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import { makeProviderFailure } from "@t3tools/provider-core/server/failure";
import {
  ProviderAdapterDriverCreateError,
  type ProviderAdapterDriver,
  type ProviderAdapterDriverCreateInput,
} from "@t3tools/provider-core/server/adapterDriver";
import { CopilotSettings } from "../settings.ts";
import { COPILOT_DEFAULT_MODEL_SLUG } from "./status.ts";

export const COPILOT_PROVIDER = ProviderDriverKind.make("copilot");
export const COPILOT_DEFAULT_INSTANCE_ID = defaultInstanceIdForDriver(COPILOT_PROVIDER);
const DEFAULT_COPILOT_SETTINGS = Schema.decodeSync(CopilotSettings)({});
const isAcpRequestError = Schema.is(EffectAcpErrors.AcpRequestError);

// No allow-all or autopilot flags: every tool permission is routed to T3's approval policy.
const COPILOT_ACP_ARGS = ["--acp"] as const;

export interface CopilotAdapterV2Options {
  readonly instanceId: Parameters<typeof makeAcpAdapterV2>[0]["instanceId"];
  readonly settings: CopilotSettings;
  readonly environment: NodeJS.ProcessEnv;
  readonly selfInvocation: SelfInvocation;
  readonly nativeLogging?: Parameters<typeof makeAcpAdapterV2>[0]["nativeLogging"];
  readonly continuationRequests?: Parameters<typeof makeAcpAdapterV2>[0]["continuationRequests"];
  readonly makeRuntime?: (
    input: AcpAdapterV2RuntimeInput,
  ) => Effect.Effect<
    AcpSessionRuntime.AcpSessionRuntime["Service"],
    EffectAcpErrors.AcpError,
    ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto | Scope.Scope
  >;
  readonly assertComplete?: Effect.Effect<void, EffectAcpErrors.AcpError>;
}

export function copilotAcpSpawnInput(
  settings: CopilotSettings,
  cwd: string,
  environment: NodeJS.ProcessEnv,
): AcpSessionRuntime.AcpSpawnInput {
  return {
    command: settings.binaryPath || "copilot",
    args: [...COPILOT_ACP_ARGS],
    cwd,
    env: environment,
  };
}

function makeCopilotAcpRuntime(options: CopilotAdapterV2Options) {
  return ({
    processEnvironment,
    runtimePolicy: _runtimePolicy,
    ...input
  }: AcpAdapterV2RuntimeInput): Effect.Effect<
    AcpSessionRuntime.AcpSessionRuntime["Service"],
    EffectAcpErrors.AcpError,
    ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto | Scope.Scope
  > =>
    Effect.gen(function* () {
      const context = yield* Layer.build(
        AcpSessionRuntime.layer({
          ...input,
          spawn: copilotAcpSpawnInput(options.settings, input.cwd, {
            ...options.environment,
            ...processEnvironment,
          }),
          customModels: readCustomModelEntries(options.settings.customModels).map(
            (entry) => entry.slug,
          ),
        }),
      );
      return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
        Effect.provide(context),
      );
    });
}

export function makeCopilotAcpAdapterFlavor(options: CopilotAdapterV2Options): AcpAdapterV2Flavor {
  const routing = makeCopilotSubagentRouting();
  return {
    driver: COPILOT_PROVIDER,
    runtimeHarness: "GitHub Copilot CLI",
    // Cancelling a Copilot prompt also kills the background agents it started.
    capabilities: {
      ...AcpProviderCapabilitiesV2,
      turns: { ...AcpProviderCapabilitiesV2.turns, supportsSteeringByInterruptRestart: false },
    },
    customModels: readCustomModelEntries(options.settings.customModels).map((entry) => entry.slug),
    // "default" keeps the CLI's configured model, so it is never sent to Copilot.
    resolveModelId: (selection) =>
      selection.model === COPILOT_DEFAULT_MODEL_SLUG ? "" : selection.model,
    promptFailure: (cause) =>
      makeProviderFailure({
        cause,
        ...(isAcpRequestError(cause)
          ? { message: cause.errorMessage, code: String(cause.code), class: "provider_error" }
          : { class: "provider_error" }),
      }),
    clientCapabilitiesMeta: copilotClientCapabilitiesMeta,
    // Copilot CLI 1.0.105 rejects stdio MCP servers from the client.
    mcpOverHttp: true,
    registerExtensions: routing.registerExtensions,
    normalizeSessionUpdate: routing.normalizeSessionUpdate,
    extractSubagentUpdate: extractCopilotSubagentUpdate,
    makeRuntime: options.makeRuntime ?? makeCopilotAcpRuntime(options),
    ...(options.assertComplete === undefined ? {} : { assertComplete: options.assertComplete }),
  };
}

export const makeCopilotAdapterV2 = Effect.fn("makeCopilotAdapterV2")(function* (
  options: CopilotAdapterV2Options,
) {
  return yield* makeAcpAdapterV2({
    instanceId: options.instanceId,
    flavor: makeCopilotAcpAdapterFlavor(options),
    selfInvocation: options.selfInvocation,
    ...(options.continuationRequests === undefined
      ? {}
      : { continuationRequests: options.continuationRequests }),
    ...(options.nativeLogging === undefined ? {} : { nativeLogging: options.nativeLogging }),
  });
});

export type CopilotAdapterV2DriverEnv =
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | IdAllocator.IdAllocatorV2
  | Path.Path
  | McpProviderSessions.McpProviderSessions
  | ProviderEventLoggers.ProviderEventLoggers
  | ProviderHost.ProviderHost;

export const CopilotAdapterV2Driver: ProviderAdapterDriver<
  CopilotSettings,
  CopilotAdapterV2DriverEnv
> = {
  driverKind: COPILOT_PROVIDER,
  configSchema: CopilotSettings,
  defaultConfig: (): CopilotSettings => DEFAULT_COPILOT_SETTINGS,
  create: Effect.fn("CopilotAdapterV2Driver.create")(
    function* (input: ProviderAdapterDriverCreateInput<CopilotSettings>) {
      const hostEnvironment = yield* HostProcess.Environment;
      const selfInvocation = yield* resolveSelfInvocation();
      const providerEventLoggers = yield* ProviderEventLoggers.ProviderEventLoggers;
      const continuationRequests = yield* ProviderContinuationRequests.ProviderContinuationRequests;
      const makeNativeLogger = yield* makeAcpNativeLoggerFactory();
      return yield* makeCopilotAdapterV2({
        instanceId: input.instanceId,
        settings: { ...input.config, enabled: input.enabled },
        environment: yield* mergeProviderInstanceEnvironment(input.environment, hostEnvironment),
        selfInvocation,
        continuationRequests,
        nativeLogging: (threadId) =>
          makeNativeLogger({
            nativeEventLogger: providerEventLoggers.native,
            provider: COPILOT_PROVIDER,
            threadId,
          }),
      });
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterDriverCreateError({
              driver: COPILOT_PROVIDER,
              instanceId: input.instanceId,
              detail: "Failed to create GitHub Copilot ACP adapter.",
              cause,
            }),
        ),
      ),
  ),
};
