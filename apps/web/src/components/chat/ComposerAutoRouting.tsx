import { CommandId, type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { RouteIcon, ThumbsDownIcon, ThumbsUpIcon, TrendingUpIcon } from "lucide-react";

import { randomUUID } from "../../lib/utils";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";
import type { ComposerAutoRouting } from "./useComposerAutoRouting";

/**
 * The Auto icon stands in for the provider logo, so the routed model name fits where a manual
 * pick would; the accessible label still spells out "Auto · Sonnet 5.5".
 */
export function autoRoutingTrigger(
  routing: Pick<ComposerAutoRouting, "mode" | "state">,
  modelName: string | null,
): { readonly text: string; readonly ariaLabel: string } | undefined {
  if (routing.mode !== "auto") return undefined;
  const decided = routing.state?.latestDecision;
  if (decided?.kind === "dry_run") {
    return {
      text: "Auto (dry run)",
      ariaLabel: modelName === null ? "Auto (dry run)" : `Auto (dry run) · ${modelName}`,
    };
  }
  if (decided == null || modelName === null) return { text: "Auto", ariaLabel: "Auto" };
  return { text: modelName, ariaLabel: `Auto · ${modelName}` };
}

export function AutoRoutingTriggerIcon() {
  return <RouteIcon aria-hidden="true" className="size-4 text-primary" />;
}

/** The Auto row inside the model picker: turn Auto on or off, see why, rate the choice. */
export function AutoRoutingPickerRow(props: {
  readonly routing: ComposerAutoRouting;
  readonly environmentId: EnvironmentId;
}) {
  const { routing } = props;
  const submitFeedback = useAtomCommand(serverEnvironment.autoRoutingSubmitFeedback);
  if (!routing.available) return null;
  const decision = routing.state?.latestDecision ?? null;
  const description =
    routing.mode === "pinned"
      ? "You picked this model, so Auto will not change it."
      : routing.mode === "manual"
        ? "Let T3 pick a Claude or Codex model for each turn."
        : decision !== null && decision.kind !== "pinned"
          ? decision.summary
          : routing.settings.dryRun
            ? "Dry run: records its choice and sends with your model."
            : "Picks a Claude or Codex model for each turn.";

  const rate = (feedback: "good" | "bad") => {
    if (decision === null) return;
    void submitFeedback({
      environmentId: props.environmentId,
      input: {
        decisionId: decision.id,
        feedback: decision.feedback === feedback ? null : feedback,
      },
    }).then(() => routing.refresh());
  };

  return (
    <div className="flex items-center gap-2 border-t border-border/70 px-3 py-2 text-xs">
      <RouteIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span className="font-medium text-foreground">
          {routing.mode === "pinned" ? "Pinned in an Auto thread" : "Auto"}
        </span>
        <Tooltip>
          <TooltipTrigger render={<span className="truncate text-muted-foreground" />}>
            {description}
          </TooltipTrigger>
          <TooltipPopup side="top">{description}</TooltipPopup>
        </Tooltip>
      </div>
      {routing.mode === "auto" && decision !== null && decision.kind !== "pinned" ? (
        <div className="flex shrink-0 items-center">
          <Button
            size="icon-xs"
            variant={decision.feedback === "good" ? "secondary" : "ghost-muted"}
            aria-label="Good model choice"
            aria-pressed={decision.feedback === "good"}
            onClick={() => rate("good")}
          >
            <ThumbsUpIcon />
          </Button>
          <Button
            size="icon-xs"
            variant={decision.feedback === "bad" ? "secondary" : "ghost-muted"}
            aria-label="Poor model choice"
            aria-pressed={decision.feedback === "bad"}
            onClick={() => rate("bad")}
          >
            <ThumbsDownIcon />
          </Button>
        </div>
      ) : null}
      {routing.mode === "pinned" ? (
        <Button size="compact" variant="ghost" onClick={() => routing.setMode("auto")}>
          Return to Auto
        </Button>
      ) : (
        <Switch
          aria-label="Auto model routing"
          checked={routing.mode === "auto"}
          onCheckedChange={(checked) => routing.setMode(checked ? "auto" : "manual")}
        />
      )}
    </div>
  );
}

/** Offers a stronger model after a failed attempt; nothing runs until the user approves. */
export function useAutoRoutingEscalationItem(input: {
  readonly routing: ComposerAutoRouting;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  readonly busy: boolean;
}): ComposerBannerStackItem | null {
  const respond = useAtomCommand(serverEnvironment.autoRoutingRespondEscalation);
  const offer = input.routing.state?.pendingEscalation ?? null;
  const threadId = input.threadId;
  if (offer === null || threadId === null || input.routing.mode !== "auto" || input.busy)
    return null;
  const answer = (accept: boolean) => {
    void respond({
      environmentId: input.environmentId,
      input: {
        threadId,
        offerId: offer.id,
        accept,
        commandId: CommandId.make(`auto-routing:escalate:${randomUUID()}`),
      },
    }).then(() => input.routing.refresh());
  };
  return {
    id: `auto-routing-escalation:${offer.id}`,
    variant: "info",
    group: "attention",
    icon: <TrendingUpIcon />,
    title: `Try again with ${offer.toName}?`,
    description:
      offer.failureKind === "verification_failed"
        ? `The last attempt did not pass its checks${offer.evidence[0] ? `: ${offer.evidence[0]}` : "."} The retry reuses this thread's findings and will not repeat destructive steps.`
        : "You said the last fix did not work. The retry reuses this thread's findings and will not repeat destructive steps.",
    actions: (
      <Button size="compact" onClick={() => answer(true)}>
        Escalate
      </Button>
    ),
    dismissLabel: "Not now",
    onDismiss: () => answer(false),
  };
}
