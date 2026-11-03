import { describe, expect, it } from "vite-plus/test";

import { ProviderInstanceId } from "@t3tools/contracts";

import {
  autoRoutingRequestFor,
  composerAccountFor,
  composerAccountTarget,
  resolveComposerRoutingMode,
} from "./autoRoutingStore";

const enabled = { enabled: true, defaultMode: "manual" as const };

describe("resolveComposerRoutingMode", () => {
  it.each([
    [
      "server without Auto support",
      {
        available: false,
        settings: { ...enabled, defaultMode: "auto" as const },
        local: "auto" as const,
      },
      "manual",
    ],
    [
      "Auto turned off",
      {
        available: true,
        settings: { enabled: false, defaultMode: "auto" as const },
        local: "auto" as const,
      },
      "manual",
    ],
    ["new thread with the manual default", { available: true, settings: enabled }, "manual"],
    [
      "new thread with the Auto default",
      { available: true, settings: { ...enabled, defaultMode: "auto" as const } },
      "auto",
    ],
    [
      "started manual thread ignores the Auto default",
      {
        available: true,
        settings: { ...enabled, defaultMode: "auto" as const },
        threadStarted: true,
      },
      "manual",
    ],
    [
      "server remembers an Auto thread",
      { available: true, settings: enabled, server: "auto" as const, threadStarted: true },
      "auto",
    ],
    [
      "local pin wins over the server",
      { available: true, settings: enabled, server: "auto" as const, local: "pinned" as const },
      "pinned",
    ],
  ] as const)("%s", (_name, input, expected) => {
    expect(
      resolveComposerRoutingMode({
        local: undefined,
        server: null,
        threadStarted: false,
        ...input,
      }),
    ).toBe(expected);
  });

  it("sends no routing request for manual threads", () => {
    expect(autoRoutingRequestFor("manual")).toBeUndefined();
    expect(autoRoutingRequestFor("pinned")).toEqual({ mode: "pinned" });
  });
});

describe("composerAccountTarget", () => {
  const entry = (driverKind: string, slugs: ReadonlyArray<string>, enabled = true) => ({
    instanceId: ProviderInstanceId.make(driverKind),
    driverKind,
    enabled,
    isAvailable: true,
    models: slugs.map((slug) => ({ slug })),
  });
  const entries = [
    entry("cursor", ["composer-2"]),
    entry("copilot", ["default", "auto", "gpt-5.6-luna"]),
    entry("claudeAgent", ["claude-sonnet-5-5"]),
  ];

  it("moves Work to a real Copilot model and Personal to Claude or Codex", () => {
    expect(composerAccountTarget(entries, "work")?.model).toBe("gpt-5.6-luna");
    expect(composerAccountTarget(entries, "personal")?.model).toBe("claude-sonnet-5-5");
  });

  it("has nowhere to go when that side is turned off", () => {
    expect(composerAccountTarget([entry("copilot", ["gpt-5.6-luna"], false)], "work")).toBeNull();
    expect(composerAccountTarget([entry("cursor", ["composer-2"])], "personal")).toBeNull();
  });

  it("treats only Copilot as the work account", () => {
    expect(composerAccountFor("copilot")).toBe("work");
    expect(composerAccountFor("codex")).toBe("personal");
  });
});
