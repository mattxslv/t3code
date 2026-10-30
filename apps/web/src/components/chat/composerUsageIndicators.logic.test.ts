import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind, type ServerProviderUsageWindow } from "@t3tools/contracts";
import { remainingPercent, type LimitAccount } from "@t3tools/shared/usageLimits";
import {
  composerUsageWindow,
  composerUsageStale,
  selectComposerUsageAccount,
} from "./composerUsageIndicators.logic";

const now = Date.parse("2026-10-30T08:00:00Z");
const window = (
  id: string,
  kind: ServerProviderUsageWindow["kind"],
  usedPercent = 25,
): ServerProviderUsageWindow => ({
  id,
  kind,
  label: id,
  usedPercent,
  resetsAt: "2026-10-30T09:00:00Z",
});
function account(
  key: string,
  driver = "codex",
  windows = [window("primary", "session"), window("secondary", "weekly", 80)],
): LimitAccount {
  return {
    key,
    driver: ProviderDriverKind.make(driver),
    displayName: null,
    email: undefined,
    plan: undefined,
    accentColor: undefined,
    environments: [],
    sourceLabel: null,
    redeem: null,
    limits: { checkedAt: "2026-10-30T07:59:00Z", windows },
  };
}

describe("composer usage indicators", () => {
  it("keeps provider accounts separate and never combines multiple accounts or silently replaces a missing selection", () => {
    const first = account("first");
    const second = account("second");
    const claude = account("claude", "claudeAgent");
    expect(selectComposerUsageAccount([first, claude], "codex", undefined)).toEqual({
      account: first,
      ambiguous: false,
    });
    expect(selectComposerUsageAccount([first, second, claude], "codex", undefined)).toEqual({
      account: undefined,
      ambiguous: true,
    });
    expect(selectComposerUsageAccount([first, second], "codex", "second").account).toBe(second);
    expect(selectComposerUsageAccount([first], "codex", "removed").account).toBeUndefined();
    expect(selectComposerUsageAccount([first, claude], "claudeAgent", undefined).account).toBe(
      claude,
    );
  });

  it("uses normalized window kinds and remaining allowance, including zero and full balances", () => {
    const codex = account("codex", "codex", [
      window("primary", "monthly"),
      window("secondary", "weekly", 100),
    ]);
    expect(composerUsageWindow(codex, "session")).toBeUndefined();
    expect(remainingPercent(composerUsageWindow(codex, "weekly")!)).toBe(0);
    const full = account("full", "codex", [window("secondary", "session", 0)]);
    expect(remainingPercent(composerUsageWindow(full, "session")!)).toBe(100);
    expect(composerUsageWindow(undefined, "session")).toBeUndefined();
  });

  it("does not substitute Claude model-specific weekly limits for its general allowance", () => {
    const claude = account("claude", "claudeAgent", [
      window("five_hour", "session"),
      window("seven_day_sonnet", "weekly", 90),
    ]);
    expect(remainingPercent(composerUsageWindow(claude, "session")!)).toBe(75);
    expect(composerUsageWindow(claude, "weekly")).toBeUndefined();
    const general = window("seven_day", "weekly", 40);
    expect(
      composerUsageWindow(
        { ...claude, limits: { ...claude.limits, windows: [...claude.limits.windows, general] } },
        "weekly",
      ),
    ).toBe(general);
  });

  it("marks aged, future-clock and past-reset snapshots stale without fabricating a refill", () => {
    const current = account("current");
    expect(composerUsageStale(current, now)).toBe(false);
    expect(composerUsageStale(current, now + 16 * 60_000)).toBe(true);
    expect(composerUsageStale(current, now - 5 * 60_000)).toBe(true);
    const expired = {
      ...current,
      limits: {
        ...current.limits,
        windows: [{ ...window("primary", "session", 100), resetsAt: "2026-10-30T07:58:00Z" }],
      },
    };
    expect(composerUsageStale(expired, now)).toBe(true);
    expect(remainingPercent(composerUsageWindow(expired, "session")!)).toBe(0);
  });
});
