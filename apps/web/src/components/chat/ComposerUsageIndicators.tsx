import { useAtomValue } from "@effect/atom-react";
import { memo, useEffect, useEffectEvent, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { refreshUsageLimits } from "@t3tools/client-runtime/state/usage";
import {
  remainingPercent,
  formatResetsIn,
  formatDuration,
  paceRemainingPercent,
  type LimitAccount,
} from "@t3tools/shared/usageLimits";
import { ProviderDriverKind, type ServerProviderUsageWindow } from "@t3tools/contracts";
import { useClientSettings } from "../../hooks/useSettings";
import { useNowMinute } from "../../hooks/useNowMinute";
import { composerUsageAccountsAtom } from "../../state/composerUsage";
import { environmentPresentations } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerControl } from "./ComposerControl";
import {
  COMPOSER_USAGE_DRIVERS,
  composerUsageCredits,
  composerUsageDailyBudget,
  composerUsagePollDue,
  composerUsageProbeStale,
  composerUsagePrimaryWindow,
  composerUsageWindow,
  composerUsageStale,
  formatCredits,
  isComposerUsageDriver,
  selectComposerUsageAccount,
  type ComposerUsageDriver,
} from "./composerUsageIndicators.logic";

const DRIVER_NAMES: Record<ComposerUsageDriver, string> = {
  codex: "Codex",
  claudeAgent: "Claude",
  copilot: "Copilot",
};

const DRIVER_BAR_CLASSES: Record<ComposerUsageDriver, string> = {
  codex: "bg-composer-usage-codex",
  claudeAgent: "bg-composer-usage-claude",
  copilot: "bg-composer-usage-copilot",
};

function WindowDetails({
  title,
  window,
  now,
}: {
  title: string;
  window: ServerProviderUsageWindow | undefined;
  now: number;
}) {
  const remaining = window ? remainingPercent(window) : null;
  const credits = composerUsageCredits(window);
  const dailyBudget = composerUsageDailyBudget(window, now);
  return (
    <div className="w-52 space-y-2 py-1 text-xs">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-medium">{title}</span>
        <span className="tabular-nums">
          {credits
            ? `${formatCredits(credits.remaining)} / ${formatCredits(credits.limit)} left`
            : remaining === null
              ? "Unavailable"
              : `${remaining}% left`}
        </span>
      </div>
      {remaining !== null ? (
        <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
          <div
            className="h-full rounded-full bg-foreground/50"
            style={{ width: `${remaining}%` }}
          />
        </div>
      ) : null}
      {dailyBudget !== null ? (
        <div className="tabular-nums">{formatCredits(dailyBudget)} a day lasts until the reset</div>
      ) : null}
      <div className="text-muted-foreground tabular-nums">
        {window ? (formatResetsIn(window, now) ?? "Reset not reported") : "Not reported"}
      </div>
    </div>
  );
}

function UsageIndicator({
  driver,
  account,
  ambiguous,
  connected,
  loading,
  now,
  detailed,
}: {
  driver: ComposerUsageDriver;
  account: LimitAccount | undefined;
  ambiguous: boolean;
  connected: boolean;
  loading: boolean;
  now: number;
  detailed: boolean;
}) {
  const navigate = useNavigate();
  const name = DRIVER_NAMES[driver];
  const windowName = driver === "copilot" ? "AI credits" : "session";
  const session = composerUsagePrimaryWindow(account, driver);
  // Copilot has no weekly window, so its tooltip details the monthly AI-credit allowance instead.
  const details =
    driver === "copilot"
      ? { title: "AI credits", window: session }
      : { title: "Weekly", window: composerUsageWindow(account, "weekly") };
  const remaining = session ? remainingPercent(session) : null;
  const credits = composerUsageCredits(session);
  const resetLabel = session ? formatResetsIn(session, now) : null;
  // Where even spending would be: the share of the session window's time still left.
  const timeLeft = session ? paceRemainingPercent(session, now) : null;
  const resetAt = session?.resetsAt ? Date.parse(session.resetsAt) : NaN;
  const resetCountdown = Number.isFinite(resetAt)
    ? resetAt > now
      ? formatDuration(resetAt - now)
      : "Updating"
    : "No reset";
  const stale = account !== undefined && composerUsageStale(account, now);
  const status = ambiguous
    ? "Select an account in Personal customizations"
    : loading
      ? "Loading usage"
      : !connected
        ? "Disconnected"
        : !account
          ? "Usage unavailable"
          : stale
            ? "Stale usage · awaiting update"
            : "Current usage";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ComposerControl
            size="xs"
            aria-label={`${name}: ${remaining === null ? `${windowName} not reported` : `${remaining}% ${windowName} remaining`}${timeLeft === null ? "" : `, ${timeLeft}% of the window left`}. ${resetLabel ?? "Reset not reported"}. ${status}. Open usage limits`}
            onClick={() => void navigate({ to: "/usage", search: { metric: "limits" } })}
            data-composer-usage-provider={driver}
          >
            <span className={detailed ? "whitespace-nowrap text-xs tabular-nums" : "sr-only"}>
              {credits
                ? `${formatCredits(credits.remaining, true)} left`
                : remaining === null
                  ? "Unavailable"
                  : `${remaining}%`}
            </span>
            <span
              aria-hidden
              className={
                detailed
                  ? "relative block h-5 w-36 overflow-hidden rounded-md @min-[540px]/composer-surface:w-52"
                  : "relative block h-1 w-10 overflow-hidden rounded-full bg-muted"
              }
              style={{
                backgroundImage: detailed
                  ? "repeating-linear-gradient(135deg, transparent 0px, transparent 3px, color-mix(in srgb, var(--foreground) 18%, transparent) 3px, color-mix(in srgb, var(--foreground) 18%, transparent) 4px)"
                  : undefined,
              }}
            >
              {remaining !== null ? (
                <span
                  className={`absolute inset-y-0 left-0 rounded-md transition-[width,opacity] ${
                    DRIVER_BAR_CLASSES[driver]
                  } ${!connected || stale ? "opacity-50" : ""}`}
                  style={{ width: `${remaining}%` }}
                />
              ) : null}
              {detailed && timeLeft !== null ? (
                <span
                  className="absolute inset-y-0.5 w-0.5 -translate-x-1/2 rounded-full bg-foreground"
                  style={{ left: `clamp(2px, ${timeLeft}%, calc(100% - 2px))` }}
                />
              ) : null}
              {detailed && (remaining !== 100 || Number.isFinite(resetAt)) ? (
                <span className="absolute inset-y-0 right-0 flex items-center gap-1 px-1.5 text-3xs text-foreground tabular-nums">
                  <span>↻</span> {resetCountdown}
                </span>
              ) : null}
            </span>
            <span className="sr-only">{name}</span>
          </ComposerControl>
        }
      />
      <TooltipPopup side="top">
        <WindowDetails title={details.title} window={details.window} now={now} />
      </TooltipPopup>
    </Tooltip>
  );
}

export const ComposerUsageIndicators = memo(function ComposerUsageIndicators({
  selectedProvider,
  turnRunning,
}: {
  selectedProvider: ProviderDriverKind;
  turnRunning: boolean;
}) {
  const accounts = useAtomValue(composerUsageAccountsAtom);
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const selection = useClientSettings((settings) => settings.composerUsageAccounts);
  const preferences = useClientSettings((settings) => ({
    enabled: settings.customizationsEnabled && settings.composerUsageEnabled,
    selectedOnly: settings.composerUsageSelectedOnly,
    detailed: settings.composerUsageDetailed,
  }));
  const now = Date.parse(`${useNowMinute()}Z`);
  const presentationsByEnvironment = useAtomValue(environmentPresentations.presentationsAtom);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  // refreshUsageLimits throttles automatic calls to one per environment every few minutes and
  // shares one in-flight request with the Usage page, so ticking here adds no duplicate requests.
  const autoRefresh = useEffectEvent(() => {
    if (!preferences.enabled || document.hidden) return;
    for (const [environmentId, presentation] of presentationsByEnvironment) {
      if (presentation.connection.phase === "connected" && presentation.serverConfig !== null) {
        void refreshUsageLimits(
          environmentId,
          () => refreshProviders({ environmentId, input: {} }),
          true,
        ).catch(() => undefined);
      }
    }
  });
  const connectedKey = [...presentationsByEnvironment]
    .filter(([, p]) => p.connection.phase === "connected" && p.serverConfig !== null)
    .map(([id]) => id)
    .join(",");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps composer usage live by refreshing provider limits on mount, when environments connect, on tab focus, and on a timer
  useEffect(() => {
    if (!preferences.enabled || connectedKey === "") return;
    autoRefresh();
    const timer = globalThis.setInterval(autoRefresh, 60_000);
    document.addEventListener("visibilitychange", autoRefresh);
    return () => {
      globalThis.clearInterval(timer);
      document.removeEventListener("visibilitychange", autoRefresh);
    };
  }, [preferences.enabled, connectedKey]);
  // Only the bars on screen are polled, one round at a time, so a slow probe never stacks up.
  const pollInFlight = useRef(false);
  const lastPollAt = useRef(0);
  const pollShownUsage = useEffectEvent(() => {
    if (!preferences.enabled || document.hidden || pollInFlight.current) return;
    const shownDrivers: ReadonlyArray<string> = preferences.selectedOnly
      ? [selectedProvider]
      : COMPOSER_USAGE_DRIVERS;
    const pollAt = Date.now();
    // A failed probe keeps the last good bars, so a stale check time is the sign of a rate limit.
    const probeFailed = accounts.some(
      (account) =>
        shownDrivers.includes(account.driver) &&
        (account.limits.unavailable?.reason === "probeFailed" ||
          composerUsageProbeStale(account.limits.checkedAt, pollAt)),
    );
    if (!composerUsagePollDue({ now: pollAt, lastPollAt: lastPollAt.current, probeFailed })) return;
    const refreshes = [...presentations].flatMap(([environmentId, presentation]) =>
      presentation.connection.phase === "connected"
        ? (presentation.serverConfig?.providers ?? [])
            .filter(
              (provider) =>
                provider.enabled &&
                isComposerUsageDriver(provider.driver) &&
                shownDrivers.includes(provider.driver),
            )
            .map((provider) =>
              refreshProviders({ environmentId, input: { instanceId: provider.instanceId } }),
            )
        : [],
    );
    if (refreshes.length === 0) return;
    pollInFlight.current = true;
    lastPollAt.current = pollAt;
    void Promise.allSettled(refreshes).finally(() => {
      pollInFlight.current = false;
    });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- usage changes outside the app, so the bars poll the server while they are visible
  useEffect(() => {
    if (!preferences.enabled || connectedKey === "") return;
    const timer = globalThis.setInterval(pollShownUsage, 1_000);
    return () => globalThis.clearInterval(timer);
  }, [preferences.enabled, connectedKey]);
  // A finished turn is when the numbers most likely moved, so it does not wait for the next tick.
  const turnWasRunning = useRef(turnRunning);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a finished turn spends usage held by the provider, outside React
  useEffect(() => {
    if (turnWasRunning.current && !turnRunning) {
      lastPollAt.current = 0;
      pollShownUsage();
    }
    turnWasRunning.current = turnRunning;
  }, [turnRunning]);
  if (
    !preferences.enabled ||
    (preferences.selectedOnly && !isComposerUsageDriver(selectedProvider))
  )
    return null;
  return (
    <div className="flex shrink-0 items-center gap-0.5" data-composer-usage-indicators>
      {COMPOSER_USAGE_DRIVERS.filter((driver) =>
        preferences.selectedOnly
          ? driver === selectedProvider
          : // Copilot is opt-in, so it joins the always-on row only when selected or signed in.
            driver !== "copilot" ||
            driver === selectedProvider ||
            accounts.some((account) => account.driver === "copilot"),
      ).map((driver) => {
        const selected = selectComposerUsageAccount(accounts, driver, selection[driver]);
        const environmentIds =
          selected.account?.environments.map((environment) => environment.environmentId) ?? [];
        const connected =
          environmentIds.length > 0
            ? environmentIds.some((id) => presentations.get(id)?.connection.phase === "connected")
            : [...presentations.values()].some(
                (presentation) =>
                  presentation.connection.phase === "connected" &&
                  (!selected.account ||
                    presentation.serverConfig?.usageLimitSources?.some((source) =>
                      source.accounts.some(
                        (account) =>
                          selected.account?.key ===
                          `${source.id}:${account.id}${account.workspaceId ? `:${account.workspaceId}` : ""}`,
                      ),
                    )),
              );
        const loading =
          !selected.account &&
          [...presentations.values()].some(
            (presentation) =>
              presentation.connection.phase === "connected" && presentation.serverConfig === null,
          );
        return (
          <UsageIndicator
            key={driver}
            driver={driver}
            detailed={preferences.detailed}
            {...selected}
            connected={connected}
            loading={loading}
            now={now}
          />
        );
      })}
    </div>
  );
});
