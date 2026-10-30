import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import type { LimitAccount } from "@t3tools/shared/usageLimits";

export type ComposerUsageDriver = "codex" | "claudeAgent";

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
  kind: "session" | "weekly",
): ServerProviderUsageWindow | undefined {
  const windows = account?.limits.windows.filter((window) => window.kind === kind) ?? [];
  if (account?.driver === "claudeAgent") {
    return windows.find((window) => window.id === (kind === "session" ? "five_hour" : "seven_day"));
  }
  return windows.length === 1 ? windows[0] : undefined;
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
