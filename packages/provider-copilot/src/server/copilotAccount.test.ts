import { describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import * as Effect from "effect/Effect";

import { probeCopilotAccount } from "./copilotAccount.ts";

const sdk = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("@github/copilot-sdk", () => ({
  CopilotClient: vi.fn(function () {
    return sdk.client;
  }),
  RuntimeConnection: { forStdio: () => ({}) },
}));

function setup(authenticated = true) {
  const client = {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => []),
    getAuthStatus: vi.fn(async () => ({ isAuthenticated: authenticated, login: "work" })),
    listModels: vi.fn(async () => []),
    rpc: {
      account: {
        getCurrentAuth: vi.fn(async () => ({
          authInfo: { copilotUser: { copilot_plan: "enterprise" } },
        })),
        getQuota: vi.fn(async () => ({
          quotaSnapshots: {
            premium_interactions: {
              tokenBasedBilling: true,
              isUnlimitedEntitlement: false,
              entitlementRequests: 10000,
              usedRequests: 1330,
              remainingPercentage: 86.7,
            },
          },
        })),
        getAllUsers: vi.fn(() => {
          throw new Error("Credential extraction is forbidden");
        }),
      },
    },
  };
  sdk.client = client;
  return client;
}

describe("probeCopilotAccount", () => {
  it.effect("reads metadata without extracting credentials or creating a session", () =>
    Effect.gen(function* () {
      const client = setup();
      const account = yield* probeCopilotAccount({ binaryPath: "/copilot", environment: {} });
      expect(account.plan).toBe("enterprise");
      expect(account.quota?.remainingPercentage).toBe(86.7);
      expect(client.rpc.account.getAllUsers).not.toHaveBeenCalled();
      expect(client.stop).toHaveBeenCalledOnce();
    }),
  );

  it.effect("cleans up after catalog failure", () =>
    Effect.gen(function* () {
      const client = setup();
      client.listModels.mockRejectedValueOnce(new Error("policy denied"));
      const result = yield* probeCopilotAccount({ binaryPath: "/copilot", environment: {} }).pipe(
        Effect.result,
      );
      expect(result._tag).toBe("Failure");
      expect(client.stop).toHaveBeenCalledOnce();
    }),
  );

  it.effect("does not query models or quota when signed out", () =>
    Effect.gen(function* () {
      const client = setup(false);
      const account = yield* probeCopilotAccount({ binaryPath: "/copilot", environment: {} });
      expect(account.isAuthenticated).toBe(false);
      expect(client.listModels).not.toHaveBeenCalled();
      expect(client.rpc.account.getQuota).not.toHaveBeenCalled();
      expect(client.stop).toHaveBeenCalledOnce();
    }),
  );
});
