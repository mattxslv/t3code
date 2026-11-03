import { CopilotClient, RuntimeConnection, type ModelInfo } from "@github/copilot-sdk";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

/**
 * Control-plane facts read through the official Copilot SDK. Only auth, catalog
 * and quota RPCs are used here; no session is created and no prompt is sent.
 */
export interface CopilotAccountSnapshot {
  readonly isAuthenticated: boolean;
  readonly authType: string | undefined;
  readonly login: string | undefined;
  readonly statusMessage: string | undefined;
  readonly plan: string | undefined;
  readonly accessSku: string | undefined;
  readonly models: ReadonlyArray<ModelInfo>;
  readonly quota: CopilotQuotaSnapshot | undefined;
}

/** The `premium_interactions` snapshot GitHub reports for AI-credit usage. */
export interface CopilotQuotaSnapshot {
  readonly isUnlimitedEntitlement: boolean;
  readonly entitlementRequests: number;
  readonly usedRequests: number;
  readonly remainingPercentage: number;
  readonly overageAllowedWithExhaustedQuota: boolean;
  readonly resetDate: string | undefined;
}

export class CopilotAccountProbeError extends Data.TaggedError("CopilotAccountProbeError")<{
  readonly step: string;
  readonly cause: unknown;
}> {
  override get message(): string {
    const reason = this.cause instanceof Error ? this.cause.message : undefined;
    return reason === undefined
      ? `Copilot SDK ${this.step} failed.`
      : `Copilot SDK ${this.step} failed: ${reason}`;
  }
}

const PREMIUM_QUOTA_KEY = "premium_interactions";

function stringEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(environment)) {
    if (typeof value === "string") result[key] = value;
  }
  return result;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function readPremiumQuota(
  snapshots: Readonly<Record<string, unknown>> | undefined,
): CopilotQuotaSnapshot | undefined {
  const raw = snapshots?.[PREMIUM_QUOTA_KEY];
  if (typeof raw !== "object" || raw === null) return undefined;
  const value = raw as Record<string, unknown>;
  if (
    typeof value.isUnlimitedEntitlement !== "boolean" ||
    typeof value.entitlementRequests !== "number" ||
    typeof value.usedRequests !== "number" ||
    typeof value.remainingPercentage !== "number"
  ) {
    return undefined;
  }
  return {
    isUnlimitedEntitlement: value.isUnlimitedEntitlement,
    entitlementRequests: value.entitlementRequests,
    usedRequests: value.usedRequests,
    remainingPercentage: value.remainingPercentage,
    overageAllowedWithExhaustedQuota: value.overageAllowedWithExhaustedQuota === true,
    resetDate: optionalString(value.resetDate),
  };
}

export const probeCopilotAccount = Effect.fn("probeCopilotAccount")(function* (input: {
  readonly binaryPath: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly cwd?: string | undefined;
}) {
  const client = yield* Effect.acquireRelease(
    Effect.sync(
      () =>
        new CopilotClient({
          connection: RuntimeConnection.forStdio({
            path: input.binaryPath,
            env: stringEnvironment(input.environment),
          }),
          ...(input.cwd === undefined ? {} : { workingDirectory: input.cwd }),
          logLevel: "error",
        }),
    ),
    (client) => Effect.promise(() => client.stop().catch(() => [])),
  );
  const call = <A>(step: string, run: () => Promise<A>) =>
    Effect.tryPromise({
      try: run,
      catch: (cause) => new CopilotAccountProbeError({ step, cause }),
    });

  yield* call("start", () => client.start());
  const auth = yield* call("getAuthStatus", () => client.getAuthStatus());
  if (!auth.isAuthenticated) {
    return {
      isAuthenticated: false,
      authType: auth.authType,
      login: undefined,
      statusMessage: optionalString(auth.statusMessage),
      plan: undefined,
      accessSku: undefined,
      models: [],
      quota: undefined,
    } satisfies CopilotAccountSnapshot;
  }
  // Plan and quota RPCs are marked experimental in the SDK; their absence must not hide models.
  const currentAuth = yield* call("account.getCurrentAuth", () =>
    client.rpc.account.getCurrentAuth(),
  ).pipe(Effect.option);
  const copilotUser: Record<string, unknown> | undefined =
    currentAuth._tag === "Some"
      ? (currentAuth.value.authInfo as { copilotUser?: Record<string, unknown> } | undefined)
          ?.copilotUser
      : undefined;
  const quota = yield* call("account.getQuota", () => client.rpc.account.getQuota({})).pipe(
    Effect.map((result) => readPremiumQuota(result.quotaSnapshots)),
    Effect.orElseSucceed(() => undefined),
  );
  const models = yield* call("listModels", () => client.listModels());
  return {
    isAuthenticated: true,
    authType: auth.authType,
    login: optionalString(auth.login),
    statusMessage: optionalString(auth.statusMessage),
    plan: optionalString(copilotUser?.copilot_plan),
    accessSku: optionalString(copilotUser?.access_type_sku),
    models,
    quota,
  } satisfies CopilotAccountSnapshot;
}, Effect.scoped);
