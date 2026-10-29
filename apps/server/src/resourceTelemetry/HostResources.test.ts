import { describe, expect, it } from "vite-plus/test";

import {
  type MemoryPressureSample,
  nextMemoryPressureLevel,
  psiAvg10,
  roundAgentMemory,
} from "./HostResources.ts";

const quiet: MemoryPressureSample = {
  hostSome: 0,
  hostFull: 0,
  agentsFull: 0,
  darwinLevel: null,
};

describe("memory pressure level", () => {
  it("reads PSI averages", () => {
    const text =
      "some avg10=12.50 avg60=3.10 avg300=0.80 total=1\nfull avg10=4.00 avg60=1.00 avg300=0.10 total=1\n";
    expect(psiAvg10(text, "some")).toBe(12.5);
    expect(psiAvg10(text, "full")).toBe(4);
    expect(psiAvg10("", "full")).toBeNull();
  });

  it("keeps small agents listed while rounding large ones coarsely", () => {
    const MiB = 1024 * 1024;
    expect(roundAgentMemory(27_648_000)).toBe(28 * MiB);
    expect(roundAgentMemory(3_200 * MiB + 1)).toBe(3_328 * MiB);
    expect(roundAgentMemory(0)).toBe(0);
  });

  it.each([
    { name: "a quiet host", previous: "none", sample: quiet, level: "none" },
    {
      name: "throttled agents, as in the 4 h freeze",
      previous: "none",
      sample: { ...quiet, hostSome: 30, hostFull: 3, agentsFull: 85 },
      level: "severe",
    },
    {
      name: "brief host stalls",
      previous: "none",
      sample: { ...quiet, hostSome: 12 },
      level: "elevated",
    },
    {
      name: "severe pressure easing but not gone",
      previous: "severe",
      sample: { ...quiet, hostFull: 5 },
      level: "severe",
    },
    {
      name: "severe pressure easing to stalls",
      previous: "severe",
      sample: { ...quiet, hostFull: 1 },
      level: "elevated",
    },
    {
      name: "elevated pressure fading below its entry threshold",
      previous: "elevated",
      sample: { ...quiet, hostSome: 5 },
      level: "elevated",
    },
    {
      name: "elevated pressure gone",
      previous: "elevated",
      sample: { ...quiet, hostSome: 1 },
      level: "none",
    },
    {
      name: "macOS critical pressure",
      previous: "none",
      sample: { hostSome: null, hostFull: null, agentsFull: null, darwinLevel: 4 },
      level: "severe",
    },
  ] as const)("reads $name as $level", ({ previous, sample, level }) => {
    expect(nextMemoryPressureLevel(previous, sample)).toBe(level);
  });
});
