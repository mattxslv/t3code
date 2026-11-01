import type {
  OrchestrationV2ProviderFailureClass,
  OrchestrationV2Run,
  OrchestrationV2RuntimeRequest,
  OrchestrationV2TurnItem,
} from "@t3tools/contracts";

export type RunOutcome =
  | { readonly type: "none" }
  | { readonly type: "active" }
  | { readonly type: "success" }
  | { readonly type: "interrupted" }
  | {
      readonly type: "verification_failed";
      readonly evidence: ReadonlyArray<string>;
    }
  | {
      readonly type: "environment_failure";
      readonly failureClass: OrchestrationV2ProviderFailureClass;
    }
  | { readonly type: "run_failed" };

const ACTIVE_STATUSES: ReadonlySet<OrchestrationV2Run["status"]> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

// These failures come from the provider, network, quota or sandbox, not the model's reasoning.
const ENVIRONMENT_FAILURE_CLASSES: ReadonlySet<OrchestrationV2ProviderFailureClass> = new Set([
  "usage_limit",
  "provider_error",
  "transport_error",
  "permission_error",
]);

const VERIFICATION_COMMAND =
  /(?:^|[\s;&|(])(?:(?:vp|pnpm|npm|yarn|bun|npx|bunx)\s+(?:run\s+)?(?:test|tests|typecheck|tc|lint|check|check:changed|build|vitest|jest|tsc)\b|vitest|jest|pytest|tox\b|tsc\b|eslint|oxlint|ruff\b|mypy\b|cargo\s+(?:test|check|build|clippy)|go\s+(?:test|build|vet)|mvn\s+(?:test|verify)|gradlew?\s+(?:test|check|build)|dotnet\s+(?:test|build)|make\s+(?:test|check)|rspec|phpunit|swift\s+(?:test|build)|xcodebuild\b.*\btest)/i;

function isVerificationCommand(command: string): boolean {
  return VERIFICATION_COMMAND.test(command);
}

/** Strips inline env assignments and long opaque tokens before a command is shown or reused. */
export function redactCommand(command: string): string {
  const firstLine = command.split("\n")[0] ?? "";
  const redacted = firstLine
    .replace(/\b[A-Z][A-Z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)/g, "$ENV")
    .replace(/\b[A-Za-z0-9+/_-]{32,}\b/g, "…")
    .trim();
  return redacted.length > 120 ? `${redacted.slice(0, 117)}…` : redacted;
}

type CommandItem = Extract<OrchestrationV2TurnItem, { readonly type: "command_execution" }>;

function commandFailed(item: CommandItem): boolean | null {
  if (item.exitCode !== undefined) return item.exitCode !== 0;
  if (item.outputIndicatesFailure !== undefined) return item.outputIndicatesFailure;
  if (item.status === "failed") return true;
  if (item.status === "completed") return false;
  return null;
}

/** The last verification command of each kind decides, so a fix-then-pass run counts as passing. */
function verificationEvidence(items: ReadonlyArray<OrchestrationV2TurnItem>) {
  const latestByCommand = new Map<string, { failed: boolean; item: CommandItem }>();
  for (const item of items) {
    if (item.type !== "command_execution" || item.monitor === true) continue;
    if (!isVerificationCommand(item.input)) continue;
    const failed = commandFailed(item);
    if (failed === null) continue;
    const key = redactCommand(item.input);
    latestByCommand.delete(key);
    latestByCommand.set(key, { failed, item });
  }
  const failures = [...latestByCommand.values()].filter((entry) => entry.failed);
  return {
    ran: latestByCommand.size > 0,
    failures: failures.map(({ item }) =>
      item.exitCode !== undefined
        ? `\`${redactCommand(item.input)}\` exited with code ${item.exitCode}`
        : `\`${redactCommand(item.input)}\` reported failures`,
    ),
  };
}

export function analyzeRunOutcome(input: {
  readonly run: OrchestrationV2Run | undefined;
  /** Items belonging to `run`. */
  readonly items: ReadonlyArray<OrchestrationV2TurnItem>;
}): RunOutcome {
  const { run } = input;
  if (run === undefined) return { type: "none" };
  if (ACTIVE_STATUSES.has(run.status)) return { type: "active" };
  if (run.status === "interrupted" || run.status === "cancelled" || run.status === "rolled_back") {
    return { type: "interrupted" };
  }
  const errors = input.items.filter(
    (item): item is Extract<OrchestrationV2TurnItem, { readonly type: "error" }> =>
      item.type === "error",
  );
  const environmentError = errors.findLast((item) =>
    ENVIRONMENT_FAILURE_CLASSES.has(item.failure.class),
  );
  if (run.status === "failed") {
    return environmentError === undefined
      ? { type: "run_failed" }
      : { type: "environment_failure", failureClass: environmentError.failure.class };
  }
  const verification = verificationEvidence(input.items);
  if (verification.failures.length > 0) {
    return { type: "verification_failed", evidence: verification.failures };
  }
  return { type: "success" };
}

export function hasActiveWork(
  runs: ReadonlyArray<OrchestrationV2Run>,
  runtimeRequests: ReadonlyArray<OrchestrationV2RuntimeRequest>,
): "active_run" | "pending_request" | null {
  if (runs.some((run) => ACTIVE_STATUSES.has(run.status))) return "active_run";
  if (runtimeRequests.some((request) => request.status === "pending")) return "pending_request";
  return null;
}
