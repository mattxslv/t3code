import { describe, expect, it } from "@effect/vitest";

import { copilotOneShotArgs } from "./textGeneration.ts";

describe("copilotOneShotArgs", () => {
  it("runs the prompt with tools, MCP servers and repository instructions turned off", () => {
    const args = copilotOneShotArgs("size this", "gpt-5.6-luna");
    expect(args.slice(0, 2)).toEqual(["-p", "size this"]);
    expect(args).toContain("--available-tools=t3_no_tools");
    expect(args).toContain("--no-custom-instructions");
    expect(args).toContain("--disable-builtin-mcps");
    expect(args).not.toContain("--allow-all-tools");
  });
});
