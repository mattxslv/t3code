import { describe, expect, it } from "vite-plus/test";

import { autoRoutingRequestFor, resolveComposerRoutingMode } from "./autoRoutingStore";

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
