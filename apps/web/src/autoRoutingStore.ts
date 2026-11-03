import type {
  AutoRoutingDecision,
  AutoRoutingMode,
  AutoRoutingProfile,
  AutoRoutingRequest,
  AutoRoutingSettings,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

/** `pinned` is an Auto thread where the user chose a model; Auto resumes when they ask. */
export type ComposerRoutingMode = "auto" | "pinned" | "manual";

interface AutoRoutingModeState {
  readonly modes: Readonly<Record<string, ComposerRoutingMode>>;
  readonly setMode: (threadKey: string, mode: ComposerRoutingMode) => void;
}

const MAX_REMEMBERED_THREADS = 500;

export const useAutoRoutingModeStore = create<AutoRoutingModeState>()(
  persist(
    (set) => ({
      modes: {},
      setMode: (threadKey, mode) =>
        set((state) => {
          const { [threadKey]: _previous, ...rest } = state.modes;
          const entries = Object.entries({ ...rest, [threadKey]: mode });
          return { modes: Object.fromEntries(entries.slice(-MAX_REMEMBERED_THREADS)) };
        }),
    }),
    {
      name: "t3code:auto-routing-modes:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ modes: state.modes }),
    },
  ),
);

/** Local choice first, then the server's record for the thread, then the configured default. */
export function resolveComposerRoutingMode(input: {
  readonly available: boolean;
  readonly settings: Pick<AutoRoutingSettings, "enabled" | "defaultMode">;
  readonly local: ComposerRoutingMode | undefined;
  readonly server: "auto" | "pinned" | null | undefined;
  readonly threadStarted: boolean;
}): ComposerRoutingMode {
  if (!input.available || !input.settings.enabled) return "manual";
  if (input.local !== undefined) return input.local;
  if (input.server != null) return input.server;
  // A thread that already ran manually stays manual until the user opts in.
  if (input.threadStarted) return "manual";
  return input.settings.defaultMode satisfies AutoRoutingMode;
}

export function autoRoutingRequestFor(mode: ComposerRoutingMode): AutoRoutingRequest | undefined {
  return mode === "manual" ? undefined : { mode };
}

/** Which subscription a thread spends: Copilot's work seat, or personal Claude and Codex. */
export type ComposerAccount = "work" | "personal";

export function composerAccountFor(driver: string): ComposerAccount {
  return driver === "copilot" ? "work" : "personal";
}

// Copilot's "default" and "auto" hide the real model, so they make poor starting points.
const SERVER_CHOSEN_MODELS: ReadonlySet<string> = new Set(["default", "auto"]);

/** The model a thread moves to when the Work / Personal switch is flipped. */
export function composerAccountTarget(
  entries: ReadonlyArray<{
    readonly instanceId: ProviderInstanceId;
    readonly driverKind: string;
    readonly enabled: boolean;
    readonly isAvailable: boolean;
    readonly models: ReadonlyArray<{ readonly slug: string }>;
  }>,
  account: ComposerAccount,
): { readonly instanceId: ProviderInstanceId; readonly model: string } | null {
  for (const entry of entries) {
    if (!entry.enabled || !entry.isAvailable) continue;
    const eligible =
      account === "work"
        ? entry.driverKind === "copilot"
        : entry.driverKind === "claudeAgent" || entry.driverKind === "codex";
    if (!eligible) continue;
    const model = entry.models.find((candidate) => !SERVER_CHOSEN_MODELS.has(candidate.slug));
    if (model !== undefined) return { instanceId: entry.instanceId, model: model.slug };
  }
  return null;
}

export const AUTO_ROUTING_PROFILE_LABELS: Record<AutoRoutingProfile, string> = {
  economy: "Economy",
  balanced: "Balanced",
  quality: "Quality",
};

export const AUTO_ROUTING_PROFILE_DESCRIPTIONS: Record<AutoRoutingProfile, string> = {
  economy: "Lightest model that can do the job; saves subscription usage.",
  balanced: "Weighs quality, speed and usage.",
  quality: "Stronger models when the task justifies them.",
};

export const AUTO_ROUTING_KIND_LABELS: Record<AutoRoutingDecision["kind"], string> = {
  routed: "Routed",
  dry_run: "Dry run",
  pinned: "Pinned",
  kept_active: "Kept during work",
  escalation: "Escalated",
  manual_fallback: "Manual fallback",
  simulation: "Simulation",
};
