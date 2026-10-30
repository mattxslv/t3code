import { useAtomValue } from "@effect/atom-react";
import { memo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { remainingPercent, formatResetsIn, type LimitAccount } from "@t3tools/shared/usageLimits";
import { ProviderDriverKind, type ServerProviderUsageWindow } from "@t3tools/contracts";
import { useClientSettings } from "../../hooks/useSettings";
import { useNowMinute } from "../../hooks/useNowMinute";
import { composerUsageAccountsAtom } from "../../state/composerUsage";
import { environmentPresentations } from "../../state/presentation";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerControl } from "./ComposerControl";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import {
  composerUsageWindow,
  composerUsageStale,
  selectComposerUsageAccount,
  type ComposerUsageDriver,
} from "./composerUsageIndicators.logic";

function WindowDetails({
  label,
  window,
  now,
}: {
  label: string;
  window: ServerProviderUsageWindow | undefined;
  now: number;
}) {
  return (
    <div>
      {label}:{" "}
      {window
        ? `${remainingPercent(window)}% remaining · ${formatResetsIn(window, now) ?? "Reset not reported"}`
        : "Not reported"}
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
}: {
  driver: ComposerUsageDriver;
  account: LimitAccount | undefined;
  ambiguous: boolean;
  connected: boolean;
  loading: boolean;
  now: number;
}) {
  const navigate = useNavigate();
  const name = driver === "codex" ? "Codex" : "Claude";
  const session = composerUsageWindow(account, "session");
  const weekly = composerUsageWindow(account, "weekly");
  const remaining = session ? remainingPercent(session) : null;
  const stale = account !== undefined && composerUsageStale(account, now);
  const status = ambiguous
    ? "Select an account in Appearance"
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
            aria-label={`${name}: ${remaining === null ? "session not reported" : `${remaining}% session remaining`}. ${status}. Open usage limits`}
            onClick={() => void navigate({ to: "/usage", search: { metric: "limits" } })}
            data-composer-usage-provider={driver}
          >
            <ProviderInstanceIcon
              driverKind={ProviderDriverKind.make(driver)}
              displayName={name}
              size="compact"
              showBadge={false}
            />
            <span
              aria-hidden
              className="hidden w-10 overflow-hidden rounded-full @min-[540px]/composer-surface:block"
            >
              {remaining === null ? (
                <span className="block text-center text-xs text-muted-foreground">?</span>
              ) : (
                <span className="block bg-muted">
                  <span
                    className="block h-1"
                    style={{
                      width: `${remaining}%`,
                      backgroundColor:
                        !connected || stale ? "var(--muted-foreground)" : "var(--primary)",
                    }}
                  />
                </span>
              )}
            </span>
            <span className="sr-only">{name}</span>
          </ComposerControl>
        }
      />
      <TooltipPopup side="top">
        <div className="space-y-1 text-xs">
          <div className="font-medium">{name}</div>
          <WindowDetails label="Session" window={session} now={now} />
          <WindowDetails label="Weekly" window={weekly} now={now} />
          <div>
            Last usage update:{" "}
            {account ? new Date(account.limits.checkedAt).toLocaleString() : "Unavailable"}
          </div>
          <div>{status}</div>
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}

export const ComposerUsageIndicators = memo(function ComposerUsageIndicators() {
  const accounts = useAtomValue(composerUsageAccountsAtom);
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const selection = useClientSettings((settings) => settings.composerUsageAccounts);
  const now = Date.parse(`${useNowMinute()}Z`);
  return (
    <div className="flex shrink-0 items-center gap-0.5" data-composer-usage-indicators>
      {(["codex", "claudeAgent"] as const).map((driver) => {
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
