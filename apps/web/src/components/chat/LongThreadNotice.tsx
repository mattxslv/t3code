import { SquarePenIcon } from "lucide-react";
import { useState } from "react";

import type { ContextWindowSnapshot } from "../../lib/contextWindow";
import { Button } from "../ui/button";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";

/** Past this, every message re-sends enough history that a new task is cheaper in a fresh thread. */
const LONG_THREAD_TOKENS = 120_000;

export const HANDOFF_REQUEST =
  "Write a short handoff for a new thread: what we did, what is left, and anything a fresh thread needs to know that is not already in the code or git history.";

/** New drafts whose seeded handoff should send itself once the composer is ready. */
const pendingAutoSendDrafts = new Set<string>();
export const markDraftForAutoSend = (draftId: string) => void pendingAutoSendDrafts.add(draftId);
export const takeDraftAutoSend = (draftId: string) => pendingAutoSendDrafts.delete(draftId);
export const hasDraftAutoSend = (draftId: string) => pendingAutoSendDrafts.has(draftId);

/** The assistant's answer to the latest handoff request, or null while it is missing or streaming. */
export function findHandoffText(
  messages: ReadonlyArray<{
    readonly role: string;
    readonly text: string;
    readonly streaming: boolean;
  }>,
): string | null {
  let requestIndex = -1;
  messages.forEach((message, index) => {
    if (message.role === "user" && message.text.trim() === HANDOFF_REQUEST) requestIndex = index;
  });
  if (requestIndex < 0) return null;
  const reply = messages
    .slice(requestIndex + 1)
    .findLast((message) => message.role === "assistant" && message.text.trim().length > 0);
  return reply === undefined || reply.streaming ? null : reply.text.trim();
}

export const continuationPromptFor = (handoff: string) =>
  `This is a fresh thread continuing earlier work. The handoff from the previous thread is below. Verify its claims against the repository (git status, recent commits) before relying on them, then continue with the open items under "What's left". Do not redo work the handoff marks as done.\n\n${handoff}`;

const formatTokens = (tokens: number) => `${Math.round(tokens / 1000)}k`;

/**
 * Suggests a fresh thread once this one's context is large. Dismissing hides it for the
 * thread until the page reloads.
 */
export function useLongThreadNoticeItem(input: {
  readonly threadKey: string | null;
  readonly contextWindow: ContextWindowSnapshot | null;
  readonly busy: boolean;
  readonly onAskForHandoff: () => void;
  readonly onNewThread: (() => void) | undefined;
}): ComposerBannerStackItem | null {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const { threadKey, contextWindow } = input;
  if (threadKey === null || contextWindow === null || input.busy || dismissed.has(threadKey)) {
    return null;
  }
  if (contextWindow.usedTokens < LONG_THREAD_TOKENS) return null;

  return {
    id: `long-thread:${threadKey}`,
    variant: "info",
    group: "attention",
    icon: <SquarePenIcon />,
    title: `Long thread · ${formatTokens(contextWindow.usedTokens)} tokens`,
    description: "New task? A fresh thread is cheaper.",
    actions: (
      <>
        <Button
          size="micro"
          variant="primary-soft"
          title="Ask this thread for a short summary to start a new one with"
          onClick={input.onAskForHandoff}
        >
          Handoff
        </Button>
        {input.onNewThread ? (
          <Button size="micro" onClick={input.onNewThread}>
            New thread
          </Button>
        ) : null}
      </>
    ),
    dismissLabel: "Not now",
    onDismiss: () => setDismissed((current) => new Set(current).add(threadKey)),
  };
}
