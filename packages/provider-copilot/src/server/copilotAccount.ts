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

/**
 * The runtime serves the quota it cached at sign-in, so usage drifts until restart. GitHub's own
 * endpoint is current; any failure falls back to the runtime snapshot.
 */
export function readLivePremiumQuota(
  body: unknown,
  fallback: CopilotQuotaSnapshot,
): CopilotQuotaSnapshot | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const snapshots = (body as { quota_snapshots?: unknown }).quota_snapshots;
  const raw = (snapshots as Record<string, unknown> | undefined)?.[PREMIUM_QUOTA_KEY];
  if (typeof raw !== "object" || raw === null) return undefined;
  const value = raw as Record<string, unknown>;
  const entitlement = value.entitlement;
  const percentRemaining = value.percent_remaining;
  if (typeof entitlement !== "number" || typeof percentRemaining !== "number") return undefined;
  const used =
    typeof value.credits_used === "number"
      ? value.credits_used
      : typeof value.remaining === "number"
        ? entitlement - value.remaining
        : undefined;
  if (used === undefined) return undefined;
  return {
    ...fallback,
    entitlementRequests: entitlement,
    usedRequests: used,
    remainingPercentage: percentRemaining,
  };
}

const LIVE_QUOTA_TIMEOUT_MS = 5_000;

async function requestLivePremiumQuota(token: string, fallback: CopilotQuotaSnapshot) {
  // @effect-diagnostics-next-line globalFetch:off - Plain promise helper; wiring HttpClient would widen the probe's requirements for one optional call.
  const response = await fetch("https://api.github.com/copilot_internal/user", {
    headers: { authorization: `token ${token}`, "user-agent": "t3code" },
    signal: AbortSignal.timeout(LIVE_QUOTA_TIMEOUT_MS),
  });
  if (!response.ok) return undefined;
  return readLivePremiumQuota(await response.json(), fallback);
}

const fetchLivePremiumQuota = (token: string, fallback: CopilotQuotaSnapshot) =>
  Effect.tryPromise(() => requestLivePremiumQuota(token, fallback)).pipe(
    Effect.orElseSucceed(() => undefined),
  );

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
  const cachedQuota = yield* call("account.getQuota", () => client.rpc.account.getQuota({})).pipe(
    Effect.map((result) => readPremiumQuota(result.quotaSnapshots)),
    Effect.orElseSucceed(() => undefined),
  );
  let quota = cachedQuota;
  if (cachedQuota !== undefined && !cachedQuota.isUnlimitedEntitlement) {
    const users = yield* call("account.getAllUsers", () => client.rpc.account.getAllUsers()).pipe(
      Effect.orElseSucceed(() => undefined),
    );
    const token = (
      users as ReadonlyArray<{
        token?: unknown;
        authInfo?: { host?: string; login?: string };
      }> | undefined
    )?.find(
      (user) =>
        user.authInfo?.host === "https://github.com" &&
        user.authInfo.login === auth.login &&
        typeof user.token === "string",
    )?.token;
    if (typeof token === "string") {
      quota = (yield* fetchLivePremiumQuota(token, cachedQuota)) ?? cachedQuota;
    }
  }
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
