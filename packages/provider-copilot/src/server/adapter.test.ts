import { describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { CopilotSettings } from "../settings.ts";
import { copilotAcpSpawnInput, makeCopilotAcpAdapterFlavor } from "./adapter.ts";

const settings: CopilotSettings = {
  ...Schema.decodeSync(CopilotSettings)({}),
  enabled: true,
};

const flavor = makeCopilotAcpAdapterFlavor({
  instanceId: ProviderInstanceId.make("copilot"),
  settings,
  environment: {},
  selfInvocation: { command: "node", args: [] } as never,
  makeRuntime: () => Effect.die("tests must not start Copilot"),
});

describe("copilotAcpSpawnInput", () => {
  it("launches ACP mode without allow-all or autopilot flags", () => {
    const spawn = copilotAcpSpawnInput(settings, "/repo", { HOME: "/home/user" });
    expect(spawn).toEqual({
      command: "copilot",
      args: ["--acp"],
      cwd: "/repo",
      env: { HOME: "/home/user" },
    });
  });

  it("uses the configured binary path", () => {
    expect(
      copilotAcpSpawnInput({ ...settings, binaryPath: "/opt/copilot" }, "/repo", {}).command,
    ).toBe("/opt/copilot");
  });
});

describe("makeCopilotAcpAdapterFlavor", () => {
  it("keeps the CLI's own model for the default selection", () => {
    const instanceId = ProviderInstanceId.make("copilot");
    expect(flavor.resolveModelId?.({ instanceId, model: "default" })).toBe("");
    expect(flavor.resolveModelId?.({ instanceId, model: "claude-opus-5.5" })).toBe(
      "claude-opus-5.5",
    );
  });

  it("does not steer by interrupt, because cancel also stops Copilot's background agents", () => {
    expect(flavor.capabilities.turns.supportsSteeringByInterruptRestart).toBe(false);
    expect(flavor.mcpOverHttp).toBe(true);
    expect(flavor.driver).toBe("copilot");
  });

  it("leaves tool approvals to T3's shared ACP permission policy", () => {
    expect(flavor.permissionDisposition).toBeUndefined();
    expect(flavor.sessionModeForPolicy).toBeUndefined();
  });
});
