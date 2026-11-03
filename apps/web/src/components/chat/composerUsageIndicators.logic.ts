import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import type { LimitAccount } from "@t3tools/shared/usageLimits";

export const COMPOSER_USAGE_DRIVERS = ["codex", "claudeAgent", "copilot"] as const;
export type ComposerUsageDriver = (typeof COMPOSER_USAGE_DRIVERS)[number];

export function isComposerUsageDriver(driver: string): driver is ComposerUsageDriver {
  return (COMPOSER_USAGE_DRIVERS as readonly string[]).includes(driver);
}

export function selectComposerUsageAccount(
  accounts: readonly LimitAccount[],
  driver: ComposerUsageDriver,
  selectedKey: string | undefined,
) {
  const candidates = accounts.filter((account) => account.driver === driver);
  const account = selectedKey
    ? candidates.find((candidate) => candidate.key === selectedKey)
    : candidates.length === 1
      ? candidates[0]
      : undefined;
  return { account, ambiguous: !selectedKey && candidates.length > 1 };
}

export function composerUsageWindow(
  account: LimitAccount | undefined,
  kind: "session" | "weekly" | "monthly",
): ServerProviderUsageWindow | undefined {
  const windows = account?.limits.windows.filter((window) => window.kind === kind) ?? [];
  if (account?.driver === "claudeAgent") {
    return windows.find((window) => window.id === (kind === "session" ? "five_hour" : "seven_day"));
  }
  return windows.length === 1 ? windows[0] : undefined;
}

/** Copilot reports one monthly AI-credit allowance instead of session and weekly windows. */
export function composerUsagePrimaryWindow(
  account: LimitAccount | undefined,
  driver: ComposerUsageDriver,
): ServerProviderUsageWindow | undefined {
  return composerUsageWindow(account, driver === "copilot" ? "monthly" : "session");
}

/** Credits left as GitHub counts them; null when the provider reports only a percentage. */
export function composerUsageCredits(
  window: ServerProviderUsageWindow | undefined,
): { readonly remaining: number; readonly limit: number } | null {
  if (window?.usedCount === undefined || window.limitCount === undefined || window.limitCount <= 0)
    return null;
  return {
    remaining: Math.max(0, Math.floor(window.limitCount - window.usedCount)),
    limit: window.limitCount,
  };
}

/** Even daily spend that makes the remaining credits last until the reset. */
export function composerUsageDailyBudget(
  window: ServerProviderUsageWindow | undefined,
  now: number,
): number | null {
  const credits = composerUsageCredits(window);
  const resetAt = window?.resetsAt ? Date.parse(window.resetsAt) : NaN;
  if (credits === null || !Number.isFinite(resetAt) || resetAt <= now) return null;
  const daysLeft = Math.max(1, Math.ceil((resetAt - now) / 86_400_000));
  return Math.floor(credits.remaining / daysLeft);
}

const fullCredits = new Intl.NumberFormat("en");

export function formatCredits(value: number): string {
  return fullCredits.format(value);
}

const COMPOSER_USAGE_POLL_MS = 15_000;
const COMPOSER_USAGE_FAILED_POLL_MS = 60_000;

/** Polls often while probes succeed, and eases off so a rate limit is not hit again every tick. */
export function composerUsagePollDue(input: {
  readonly now: number;
  readonly lastPollAt: number;
  readonly probeFailed: boolean;
}): boolean {
  return (
    input.now - input.lastPollAt >=
    (input.probeFailed ? COMPOSER_USAGE_FAILED_POLL_MS : COMPOSER_USAGE_POLL_MS)
  );
}

export function composerUsageProbeStale(checkedAt: string, now: number): boolean {
  return now - Date.parse(checkedAt) > 45_000;
}

export function composerUsageStale(account: LimitAccount, now: number): boolean {
  const checkedAt = Date.parse(account.limits.checkedAt);
  return (
    !Number.isFinite(checkedAt) ||
    checkedAt > now + 60_000 ||
    now - checkedAt > 15 * 60_000 ||
    account.limits.windows.some(
      (window) => window.resetsAt !== undefined && Date.parse(window.resetsAt) <= now,
    )
  );
}

export function composerUsageAccountLabel(account: LimitAccount, index: number): string {
  const alias =
    account.displayName && !account.displayName.includes("@")
      ? account.displayName
      : `Account ${index + 1}`;
  const location =
    account.environments.map((environment) => environment.label).join(", ") || account.sourceLabel;
  return `${alias}${location ? ` · ${location}` : ""}${account.plan ? ` · ${account.plan}` : ""}`;
}
