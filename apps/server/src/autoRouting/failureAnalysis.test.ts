import { describe, expect, it } from "@effect/vitest";

import type { OrchestrationV2Run, OrchestrationV2TurnItem } from "@t3tools/contracts";

import { analyzeRunOutcome, redactCommand } from "./failureAnalysis.ts";

const run = (status: OrchestrationV2Run["status"]) => ({ status }) as OrchestrationV2Run;
const command = (input: string, exitCode: number) =>
  ({ type: "command_execution", input, exitCode, status: "completed" }) as OrchestrationV2TurnItem;
const error = (failureClass: string) =>
  ({
    type: "error",
    failure: { class: failureClass, message: "x", code: null, retryable: null },
  }) as OrchestrationV2TurnItem;

describe("analyzeRunOutcome", () => {
  it("reports a failed verification as a reasoning failure with redacted evidence", () => {
    expect(
      analyzeRunOutcome({
        run: run("completed"),
        items: [command("GITHUB_TOKEN=ghp_secret vp test run src/a.test.ts", 1)],
      }),
    ).toEqual({
      type: "verification_failed",
      evidence: ["`$ENV vp test run src/a.test.ts` exited with code 1"],
    });
  });

  it("counts a run as passing when the same check passes after a failure", () => {
    expect(
      analyzeRunOutcome({
        run: run("completed"),
        items: [command("pnpm test", 1), command("ls", 2), command("pnpm test", 0)],
      }),
    ).toEqual({ type: "success" });
  });

  it("separates environment failures from other run failures", () => {
    expect(analyzeRunOutcome({ run: run("failed"), items: [error("usage_limit")] })).toEqual({
      type: "environment_failure",
      failureClass: "usage_limit",
    });
    expect(analyzeRunOutcome({ run: run("failed"), items: [error("unknown")] })).toEqual({
      type: "run_failed",
    });
  });

  it("does not judge runs that are still active or were interrupted", () => {
    expect(analyzeRunOutcome({ run: run("waiting"), items: [] }).type).toBe("active");
    expect(analyzeRunOutcome({ run: run("interrupted"), items: [command("vitest", 1)] }).type).toBe(
      "interrupted",
    );
    expect(analyzeRunOutcome({ run: undefined, items: [] }).type).toBe("none");
  });
});

describe("redactCommand", () => {
  it("keeps only the first line and strips long tokens", () => {
    expect(redactCommand(`curl -H "x" ${"a".repeat(40)}\nsecond line`)).toBe('curl -H "x" …');
  });
});
