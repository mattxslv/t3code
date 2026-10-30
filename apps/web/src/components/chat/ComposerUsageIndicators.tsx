import { useAtomValue } from "@effect/atom-react";
import { memo, useEffect, useEffectEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { refreshUsageLimits } from "@t3tools/client-runtime/state/usage";
import {
  remainingPercent,
  formatResetsIn,
  formatDuration,
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
  composerUsageWindow,
  composerUsageStale,
  selectComposerUsageAccount,
  type ComposerUsageDriver,
} from "./composerUsageIndicators.logic";

function WeeklyDetails({
  window,
  now,
}: {
  window: ServerProviderUsageWindow | undefined;
  now: number;
}) {
  const remaining = window ? remainingPercent(window) : null;
  return (
    <div className="w-48 space-y-2 py-1 text-xs">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-medium">Weekly</span>
        <span className="tabular-nums">
          {remaining === null ? "Unavailable" : `${remaining}% left`}
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
  const name = driver === "codex" ? "Codex" : "Claude";
  const session = composerUsageWindow(account, "session");
  const weekly = composerUsageWindow(account, "weekly");
  const remaining = session ? remainingPercent(session) : null;
  const resetLabel = session ? formatResetsIn(session, now) : null;
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
            aria-label={`${name}: ${remaining === null ? "session not reported" : `${remaining}% session remaining`}. ${resetLabel ?? "Reset not reported"}. ${status}. Open usage limits`}
            onClick={() => void navigate({ to: "/usage", search: { metric: "limits" } })}
            data-composer-usage-provider={driver}
          >
            <span className={detailed ? "whitespace-nowrap text-xs tabular-nums" : "sr-only"}>
              {remaining === null ? "Unavailable" : `${remaining}%`}
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
                    driver === "codex" ? "bg-composer-usage-codex" : "bg-composer-usage-claude"
                  } ${!connected || stale ? "opacity-50" : ""}`}
                  style={{ width: `${remaining}%` }}
                />
              ) : null}
              {detailed && (remaining !== 100 || Number.isFinite(resetAt)) ? (
                <span className="absolute inset-y-0 right-0 flex items-center gap-1 border-l border-foreground/50 px-1.5 text-3xs text-foreground tabular-nums">
                  <span>↻</span> {resetCountdown}
                </span>
              ) : null}
            </span>
            <span className="sr-only">{name}</span>
          </ComposerControl>
        }
      />
      <TooltipPopup side="top">
        <WeeklyDetails window={weekly} now={now} />
      </TooltipPopup>
    </Tooltip>
  );
}

export const ComposerUsageIndicators = memo(function ComposerUsageIndicators({
  selectedProvider,
}: {
  selectedProvider: ProviderDriverKind;
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
  if (
    !preferences.enabled ||
    (preferences.selectedOnly && selectedProvider !== "codex" && selectedProvider !== "claudeAgent")
  )
    return null;
  return (
    <div className="flex shrink-0 items-center gap-0.5" data-composer-usage-indicators>
      {(["codex", "claudeAgent"] as const)
        .filter((driver) => !preferences.selectedOnly || driver === selectedProvider)
        .map((driver) => {
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
